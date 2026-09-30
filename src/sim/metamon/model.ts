/**
 * Metamon Kadabra3 model loading for the browser.
 *
 * The 94.8MB fp16 ONNX model is fetched once from the same-origin models/
 * directory, cached in IndexedDB, then loaded into onnxruntime-web. WebGPU is tried first
 * with a warmup probe; any failure falls back to WASM.
 *
 * This module is web-only (imports onnxruntime-web). The pilot in pilot.ts
 * takes the loaded session and a minimal ort interface so it can also be
 * exercised under Node with onnxruntime-node.
 */
import * as ort from 'onnxruntime-web';

/**
 * Same-origin model URL (served from the gh-pages branch, NOT the GitHub
 * release): release-asset downloads redirect to objects.githubusercontent.com,
 * which sends no Access-Control-Allow-Origin header, so browsers block the
 * fetch with a CORS error. Same-origin fetch has no CORS restriction.
 * The file lives at models/ on the gh-pages branch only (kept out of the
 * main repo so clones stay small); the release remains the source of truth.
 */
export const MODEL_URL = `${import.meta.env.BASE_URL}models/kadabra3_fp16_ort_single_noeinsum.onnx`;
export const MODEL_VERSION = 'kadabra3-fp16-v2';
/** onnxruntime-web release matching the installed npm version (for wasm binaries). */
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

const DB_NAME = 'battle-dome-metamon';
const STORE_NAME = 'models';

export type ProgressFn = (fraction: number, stage: 'cached' | 'downloading' | 'loading') => void;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  try {
    const value: ArrayBuffer | undefined = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const rq = tx.objectStore(STORE_NAME).get(key);
      rq.onsuccess = () => resolve(rq.result as ArrayBuffer | undefined);
      rq.onerror = () => reject(rq.error);
    });
    return value ?? null;
  } finally {
    db.close();
  }
}

async function idbPut(key: string, buf: ArrayBuffer): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const rq = tx.objectStore(STORE_NAME).put(buf, key);
      rq.onsuccess = () => resolve();
      rq.onerror = () => reject(rq.error);
    });
  } finally {
    db.close();
  }
}

async function fetchWithProgress(url: string, onProgress: (fraction: number) => void): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`model download failed: HTTP ${resp.status}`);
  const total = Number(resp.headers.get('content-length')) || 0;
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    onProgress(1);
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  onProgress(1);
  return out.buffer;
}

let wasmPathsSet = false;

function configureOrt(): void {
  if (wasmPathsSet) return;
  wasmPathsSet = true;
  ort.env.wasm.wasmPaths = ORT_CDN;
  // Leave numThreads at default (hardwareConcurrency-based).
}

/** Tiny warmup probe: 1 timestep of zeros, just to prove the EP works end-to-end. */
async function warmup(session: ort.InferenceSession): Promise<void> {
  const feeds: Record<string, ort.Tensor> = {
    numbers: new ort.Tensor('float32', new Float32Array(55), [1, 1, 55]),
    text_tokens: new ort.Tensor('int64', new BigInt64Array(106), [1, 1, 106]),
    illegal_actions: new ort.Tensor('bool', new Uint8Array(13), [1, 1, 13]),
    rl2s: new ort.Tensor('float32', new Float32Array(14), [1, 1, 14]),
    time_idxs: new ort.Tensor('int64', new BigInt64Array(1), [1, 1, 1]),
  };
  const out = await session.run(feeds);
  const logits = out['logits'];
  if (!logits) throw new Error('warmup: no logits output');
}

export type MetamonProvider = 'webgpu' | 'wasm';

export interface MetamonSession {
  session: ort.InferenceSession;
  /** Which execution provider actually initialized — surfaced in the UI. */
  provider: MetamonProvider;
}

/**
 * Load (or reuse the cached) Kadabra3 session. WebGPU first with a warmup
 * probe; falls back to WASM on any failure.
 */
export async function loadMetamonSession(onProgress: ProgressFn): Promise<MetamonSession> {
  configureOrt();
  let buf = await idbGet(MODEL_VERSION).catch(() => null);
  if (buf) {
    onProgress(1, 'cached');
  } else {
    buf = await fetchWithProgress(MODEL_URL, (f) => onProgress(f, 'downloading'));
    await idbPut(MODEL_VERSION, buf).catch(() => {
      /* caching is best-effort; the session can still be built */
    });
  }
  onProgress(1, 'loading');
  try {
    const gpu = await ort.InferenceSession.create(buf, {executionProviders: ['webgpu']});
    await warmup(gpu);
    return {session: gpu, provider: 'webgpu'};
  } catch (err) {
    // WebGPU unavailable or rejected the graph — WASM fallback.
    // Log the real reason; otherwise a silent fallback is undebuggable.
    console.warn('[metamon] WebGPU session failed, falling back to WASM:', err);
    const wasm = await ort.InferenceSession.create(buf, {executionProviders: ['wasm']});
    await warmup(wasm);
    return {session: wasm, provider: 'wasm'};
  }
}
