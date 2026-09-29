import type {MatchupResult, RunJob} from './worker';

export type {MatchupResult, RefTeam, RunJob} from './worker';

export interface ProgressMsg {
  matchupIndex: number;
  matchupName: string;
  battle: number;
  battlesPerMatchup: number;
  matchupsDone: number;
  matchupsTotal: number;
}

export function createBenchmarkWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
}

export interface RunCallbacks {
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
