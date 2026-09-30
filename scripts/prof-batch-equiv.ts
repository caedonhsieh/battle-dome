/**
 * Batch-equivalence test: does running p1+p2 histories as ONE batched
 * session.run([2, T, ...]) produce identical logits to two separate
 * session.run([1, T, ...]) calls? If yes, per-round batching is an exact,
 * behavior-preserving 2x cut in inference calls.
 *
 * Usage: npx tsx scripts/prof-batch-equiv.ts
 */
import {runBattleMetamon} from '../src/sim/metamon/runner.js';
import teamsData from '../src/data/reference-teams.json';

const ORT_PATH = '/home/hatch/workspace/spikes/metamon-ts/node_modules/onnxruntime-node/dist/index.js';
const MODEL = '/home/hatch/workspace/spikes/metamon/kadabra3_fp16_ort_single_noeinsum.onnx';
const teams: Array<{name: string; paste: string}> = (teamsData as any).teams;

interface Feed { T: number; numbers: Float32Array; tokens: BigInt64Array; illegal: Uint8Array; rl2s: Float32Array; timeIdxs: BigInt64Array; logits: number[] }
const feeds: Feed[] = [];

async function main() {
  const ort: any = await import(/* @vite-ignore */ ORT_PATH);
  const session = await ort.InferenceSession.create(MODEL, {executionProviders: ['cpu']});
  const rawRun = session.run.bind(session);
  let wIn = 0, wOut = 0, wErr = 0;
  session.run = async (feedsIn: any) => {
    wIn++;
    try {
      const T = feedsIn.numbers.dims[1];
      const out = await rawRun(feedsIn);
      const data = out['logits'].data as ArrayLike<number>;
      const logits: number[] = [];
      for (let i = 0; i < 13; i++) logits.push(Number(data[(T - 1) * 13 + i]));
      feeds.push({
        T,
        numbers: Float32Array.from(feedsIn.numbers.data),
        tokens: BigInt64Array.from(feedsIn.text_tokens.data),
        illegal: Uint8Array.from(feedsIn.illegal_actions.data),
        rl2s: Float32Array.from(feedsIn.rl2s.data),
        timeIdxs: BigInt64Array.from(feedsIn.time_idxs.data),
        logits,
      });
      wOut++;
      return out;
    } catch (e: any) {
      wErr++;
      console.log('[batcheq] WRAPPER ERROR:', e?.message);
      throw e;
    }
  };

  const rr = await runBattleMetamon({ort, session}, teams[0].paste, teams[1].paste, {
    seed: 'batcheq', matchupIndex: 0, battleIndex: 0,
  }, () => false);
  console.log(`[batcheq] battle done: winner=${rr.winner} turns=${rr.turns}`);
  console.log(`[batcheq] wrapper in=${wIn} out=${wOut} err=${wErr}`);
  console.log(`[batcheq] captured ${feeds.length} inferences`);

  // Restore raw run for the equivalence checks.
  session.run = rawRun;

  // Find pairs with equal T (like p1/p2 of the same round).
  let tested = 0, exactAll = true, maxDiff = 0;
  for (let i = 0; i + 1 < feeds.length && tested < 6; i += 2) {
    const a = feeds[i], b = feeds[i + 1];
    if (a.T !== b.T) continue;
    const T = a.T;
    const cat = <T extends Float32Array | Uint8Array>(x: T, y: T, Ctor: new (n: number) => T): T => {
      const o = new Ctor(x.length + y.length); o.set(x, 0); o.set(y, x.length); return o;
    };
    const catBig = (x: BigInt64Array, y: BigInt64Array) => {
      const o = new BigInt64Array(x.length + y.length); o.set(x, 0); o.set(y, x.length); return o;
    };
    const mk = (type: string, data: any, dims: number[]) => new ort.Tensor(type, data, dims);
    const batchFeeds = {
      numbers: mk('float32', cat(a.numbers, b.numbers, Float32Array), [2, T, 55]),
      text_tokens: mk('int64', catBig(a.tokens, b.tokens), [2, T, 106]),
      illegal_actions: mk('bool', cat(a.illegal, b.illegal, Uint8Array), [2, T, 13]),
      rl2s: mk('float32', cat(a.rl2s, b.rl2s, Float32Array), [2, T, 14]),
      time_idxs: mk('int64', catBig(a.timeIdxs, b.timeIdxs), [2, T, 1]),
    };
    const out = await session.run(batchFeeds);
    const d = out['logits'].data as ArrayLike<number>;
    const get = (bi: number) => { const r: number[] = []; for (let k = 0; k < 13; k++) r.push(Number(d[(bi * T + (T - 1)) * 13 + k])); return r; };
    const la = get(0), lb = get(1);
    let diff = 0, exact = true;
    for (let k = 0; k < 13; k++) {
      diff = Math.max(diff, Math.abs(la[k] - a.logits[k]), Math.abs(lb[k] - b.logits[k]));
      if (la[k] !== a.logits[k] || lb[k] !== b.logits[k]) exact = false;
    }
    maxDiff = Math.max(maxDiff, diff);
    exactAll &&= exact;
    console.log(`[batcheq] T=${T}: batch-vs-single maxAbsDiff=${diff.toExponential(2)} ${exact ? 'BIT-EXACT' : 'approx'}`);
    tested++;
  }
  console.log(`[batcheq] tested=${tested} overallMaxDiff=${maxDiff.toExponential(2)} ${exactAll ? 'ALL BIT-EXACT' : 'NOT all exact'}`);
}

main().catch((e) => { console.error('[batcheq] FATAL', e); throw e; });
