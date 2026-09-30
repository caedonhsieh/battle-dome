import {useCallback, useEffect, useRef, useState} from 'react';
import {createBenchmarkWorker, clampWorkerCount, startPoolRun, requestReplay, type BattleScore, type MatchupResult, type ModelProgressMsg, type PoolBattle, type PoolProgressMsg, type ReplayRequest, type ReplayResult, type RunJob} from '../sim/client';
import type {MetamonProvider} from '../sim/metamon/model';

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunState {
  status: RunStatus;
  /** Pool-level progress (battles completed across all workers); null when idle/done. */
  pool: PoolProgressMsg | null;
  modelProgress: ModelProgressMsg | null;
  /** Which ONNX execution provider the workers initialized (null until known). */
  provider: MetamonProvider | null;
  /** Wall-clock ms when the first battle finished (excludes model download/load). */
  startedAt: number | null;
  /** Wall-clock ms when the run finished or was cancelled. */
  endedAt: number | null;
  results: MatchupResult[];
  error: string | null;
}

/** Insert a battle score into its matchup row, keeping battles in battleIndex order. */
function insertBattle(row: MatchupResult, score: BattleScore): MatchupResult {
  const battles = [...(row.battles ?? [])];
  const bi = score.battleIndex ?? battles.length;
  let pos = battles.findIndex((b) => (b.battleIndex ?? 0) > bi);
  if (pos < 0) pos = battles.length;
  battles.splice(pos, 0, score);
  let wins = 0, losses = 0, draws = 0;
  for (const b of battles) {
    if (b.winner === 'p1') wins++;
    else if (b.winner === 'p2') losses++;
    else draws++;
  }
  return {...row, wins, losses, draws, battles};
}

const idleState: RunState = {
  status: 'idle',
  pool: null,
  modelProgress: null,
  provider: null,
  startedAt: null, endedAt: null,
  results: [],
  error: null,
};

/**
 * Owns the Web Worker pool lifecycle for a benchmark run. Battles are dealt
 * round-robin over (matchupIndex, battleIndex) across N workers, each with its
 * own ONNX session. Per-battle seeds derive from (seed, matchupIndex,
 * battleIndex), so results are identical for any worker count.
 * Cancellation is cooperative: a flag checked between battles in each worker.
 */
export function useBenchmarkRun() {
  const workersRef = useRef<Worker[] | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<RunState>(idleState);

  const stopWorkers = useCallback(() => {
    cancelRef.current = null;
    if (workersRef.current) {
      for (const w of workersRef.current) w.terminate();
      workersRef.current = null;
    }
  }, []);

  useEffect(() => stopWorkers, [stopWorkers]);

  const start = useCallback(
    (job: RunJob, workerCount: number) => {
      stopWorkers();
      const battlesPerMatchup = job.battlesPerMatchup;
      const totalBattles = job.refs.length * battlesPerMatchup;
      // Never spawn more workers than battles; always at least one.
      const n = Math.max(1, Math.min(clampWorkerCount(workerCount), Math.max(1, totalBattles)));

      // Round-robin (matchupIndex, battleIndex) pairs across workers.
      const assignments: PoolBattle[][] = Array.from({length: n}, () => []);
      job.refs.forEach((ref, mi) => {
        for (let bi = 0; bi < battlesPerMatchup; bi++) {
          const k = mi * battlesPerMatchup + bi;
          assignments[k % n].push({matchupIndex: mi, battleIndex: bi, ref});
        }
      });

      const workers = assignments.map(() => createBenchmarkWorker());
      workersRef.current = workers;
      const initialResults: MatchupResult[] = job.refs.map((r) => ({
        refId: r.id,
        name: r.name,
        archetype: r.archetype,
        wins: 0,
        losses: 0,
        draws: 0,
        battles: [],
      }));
      setState({
        status: 'running',
        pool: {battlesDone: 0, battlesTotal: totalBattles},
        modelProgress: null,
        provider: null,
        startedAt: null, endedAt: null,
        results: initialResults,
        error: null,
      });

      let finished = 0; // workers that reported pool-done or cancelled
      const active = (s: RunState) => s.status === 'running';

      const cancel = startPoolRun(workers, assignments, {userTeam: job.userTeam, seed: job.seed}, {
        onModelProgress: (modelProgress) =>
          setState((s) => (active(s) ? {...s, modelProgress} : s)),
        onProvider: (provider) =>
          setState((s) => (active(s) && !s.provider ? {...s, provider} : s)),
        onBattle: (m) =>
          setState((s) => {
            if (!active(s)) return s;
            const results = s.results.map((r, i) =>
              i === m.matchupIndex ? insertBattle(r, m.score) : r,
            );
            const battlesDone = (s.pool?.battlesDone ?? 0) + 1;
            return {
              ...s,
              results,
              pool: s.pool ? {...s.pool, battlesDone} : s.pool,
              modelProgress: null,
              startedAt: s.startedAt ?? Date.now(),
            };
          }),
        onWorkerDone: () => {
          finished++;
          if (finished < n) return;
          // Keep worker 0 alive for replays; terminate the rest.
          const [keep, ...rest] = workersRef.current ?? [];
          for (const w of rest) w.terminate();
          workersRef.current = keep ? [keep] : null;
          cancelRef.current = null;
          setState((s) => (active(s)
            ? {...s, status: 'done', pool: null, modelProgress: null, endedAt: Date.now()}
            : s));
        },
        onWorkerCancelled: () => {
          finished++;
          if (finished < n) return;
          const [keep, ...rest] = workersRef.current ?? [];
          for (const w of rest) w.terminate();
          workersRef.current = keep ? [keep] : null;
          cancelRef.current = null;
          setState((s) => (active(s)
            ? {...s, status: 'cancelled', pool: null, modelProgress: null, endedAt: Date.now()}
            : s));
        },
        onError: (_workerIndex, message) => {
          stopWorkers();
          setState((s) => (active(s)
            ? {...s, status: 'error', error: message, pool: null, modelProgress: null}
            : s));
        },
      });
      cancelRef.current = cancel;
    },
    [stopWorkers],
  );

  const cancel = useCallback(() => {
    cancelRef.current?.();
  }, []);

  /**
   * Re-simulate one battle of a matchup and return its protocol log. Reuses
   * the surviving pool worker (model session stays cached) or spawns one.
   * Must not be called while a run is active.
   */
  const replay = useCallback(async (req: ReplayRequest): Promise<ReplayResult> => {
    let worker = workersRef.current?.[0];
    if (!worker) {
      worker = createBenchmarkWorker();
      workersRef.current = [worker];
    }
    return requestReplay(worker, req);
  }, []);

  const reset = useCallback(() => {
    stopWorkers();
    setState(idleState);
  }, [stopWorkers]);

  return {state, start, cancel, reset, replay, running: state.status === 'running'};
}
