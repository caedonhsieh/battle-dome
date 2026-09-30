import type {BattleScore, MatchupResult, PoolBattle, RefTeam} from './worker';
import type {MetamonProvider} from './metamon/model';

export type {BattleScore, MatchupResult, PoolBattle, RefTeam, RunJob} from './worker';

/** Pool-level progress: battles completed across all workers. */
export interface PoolProgressMsg {
  battlesDone: number;
  battlesTotal: number;
}

/** Clamp to the supported worker range (1–8). */
export function clampWorkerCount(n: number): number {
  return Math.max(1, Math.min(8, Math.floor(n) || 2));
}

export function createBenchmarkWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
}

export interface ModelProgressMsg {
  fraction: number;
  stage: 'cached' | 'downloading' | 'loading';
}

export interface PoolRunCallbacks {
  /** Aggregate model-load progress across workers (mean fraction). */
  onModelProgress: (p: ModelProgressMsg) => void;
  onProvider: (provider: MetamonProvider) => void;
  onBattle: (m: {matchupIndex: number; battleIndex: number; score: BattleScore}) => void;
  onWorkerDone: (workerIndex: number) => void;
  onWorkerCancelled: (workerIndex: number) => void;
  onError: (workerIndex: number, message: string) => void;
}

export interface PoolJobSpec {
  userTeam: {name: string; paste: string};
  seed: string;
}

/**
 * Start a pooled run: each worker gets its pre-assigned battles and reports
 * per-battle results. Model-load progress is aggregated as the mean fraction
 * across workers (a worker that finished loading counts as 1). Returns a
 * cancel function that signals all workers.
 */
export function startPoolRun(
  workers: Worker[],
  assignments: PoolBattle[][],
  spec: PoolJobSpec,
  cb: PoolRunCallbacks,
): () => void {
  const n = workers.length;
  const fractions = new Array<number>(n).fill(0);
  const stages = new Array<ModelProgressMsg['stage']>(n).fill('loading');
  const loaded = new Array<boolean>(n).fill(false);

  const emitAggregate = () => {
    let min = 0;
    for (let i = 1; i < n; i++) if (fractions[i] < fractions[min]) min = i;
    cb.onModelProgress({
      fraction: fractions.reduce((a, b) => a + b, 0) / n,
      stage: stages[min],
    });
  };

  workers.forEach((worker, i) => {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as any;
      switch (m.type) {
        case 'model-progress':
          fractions[i] = m.fraction;
          stages[i] = m.stage;
          emitAggregate();
          break;
        case 'provider':
          // All workers load the same model; first report wins.
          loaded[i] = true;
          fractions[i] = 1;
          cb.onProvider(m.provider);
          break;
        case 'battle':
          cb.onBattle(m);
          break;
        case 'pool-done':
          cb.onWorkerDone(i);
          break;
        case 'cancelled':
          cb.onWorkerCancelled(i);
          break;
        case 'error':
          cb.onError(i, m.message);
          break;
      }
    };
    worker.onerror = (e) => cb.onError(i, e.message || 'Worker error');
    worker.postMessage({type: 'run-pool', job: {userTeam: spec.userTeam, seed: spec.seed, battles: assignments[i]}});
  });
  return () => {
    for (const w of workers) w.postMessage({type: 'cancel'});
  };
}

export interface ReplayRequest {
  userPaste: string;
  refPaste: string;
  seed: string;
  matchupIndex: number;
  /** 0-based battle within the matchup; seed is derived per battle, so any index reproduces exactly */
  battleIndex: number;
  /** Readable player names for the log's |player| and |win| lines (team names) */
  p1Name: string;
  p2Name: string;
}

export interface ReplayResult {
  matchupIndex: number;
  winner: 'p1' | 'p2' | null;
  turns: number;
  log: string[];
}

/**
 * Re-simulate one battle of a matchup in the worker and resolve with its full
 * protocol log. Battles are deterministic (seed + SplitMix32 + argmax), so
 * this reproduces the exact battle from the original run. Coexists with a
 * startPoolRun-attached onmessage handler; do not call while a run is active.
 */
export function requestReplay(worker: Worker, req: ReplayRequest): Promise<ReplayResult> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as any;
      if (m.matchupIndex !== req.matchupIndex) return;
      if (m.battleIndex !== req.battleIndex) return;
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
