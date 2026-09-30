import type {MatchupResult, RunJob} from './worker';
import type {MetamonProvider} from './metamon/model';

export type {MatchupResult, RefTeam, RunJob} from './worker';

export interface ProgressMsg {
  matchupIndex: number;
  matchupName: string;
  battle: number;
  battlesPerMatchup: number;
  matchupsDone: number;
  matchupsTotal: number;
  /** Running W/L/D within the current matchup (after the just-finished battle). */
  matchupWins: number;
  matchupLosses: number;
  matchupDraws: number;
}

export function createBenchmarkWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
}

export interface ModelProgressMsg {
  fraction: number;
  stage: 'cached' | 'downloading' | 'loading';
}

export interface RunCallbacks {
  onModelProgress: (p: ModelProgressMsg) => void;
  onProvider: (provider: MetamonProvider) => void;
  onProgress: (p: ProgressMsg) => void;
  onMatchup: (index: number, result: MatchupResult) => void;
  onDone: (results: MatchupResult[]) => void;
  onCancelled: () => void;
  onError: (message: string) => void;
}

/** Attach handlers to a worker and start a run. Returns a cancel function. */
export function startRun(worker: Worker, job: RunJob, cb: RunCallbacks): () => void {
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as any;
    switch (m.type) {
      case 'model-progress': cb.onModelProgress(m); break;
      case 'provider': cb.onProvider(m.provider); break;
      case 'progress': cb.onProgress(m); break;
      case 'matchup': cb.onMatchup(m.index, m.result); break;
      case 'done': cb.onDone(m.results); break;
      case 'cancelled': cb.onCancelled(); break;
      case 'error': cb.onError(m.message); break;
    }
  };
  worker.onerror = (e) => cb.onError(e.message || 'Worker error');
  worker.postMessage({type: 'run', job});
  return () => worker.postMessage({type: 'cancel'});
}

export interface ReplayRequest {
  userPaste: string;
  refPaste: string;
  seed: string;
  matchupIndex: number;
}

export interface ReplayResult {
  matchupIndex: number;
  winner: 'p1' | 'p2' | null;
  turns: number;
  log: string[];
}

/**
 * Re-simulate battle 0 of a matchup in the worker and resolve with its full
 * protocol log. Battles are deterministic (seed + SplitMix32 + argmax), so
 * this reproduces the exact battle from the original run. Coexists with a
 * startRun-attached onmessage handler; do not call while a run is active.
 */
export function requestReplay(worker: Worker, req: ReplayRequest): Promise<ReplayResult> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as any;
      if (m.matchupIndex !== req.matchupIndex) return;
      if (m.type === 'replay-log') {
        worker.removeEventListener('message', onMsg);
        resolve(m as ReplayResult);
      } else if (m.type === 'replay-error' || m.type === 'error') {
        worker.removeEventListener('message', onMsg);
        reject(new Error(String(m.message || 'Replay failed')));
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({type: 'replay', ...req});
  });
}
