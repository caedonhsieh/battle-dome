import {useCallback, useEffect, useRef, useState} from 'react';
import {createBenchmarkWorker, startRun, requestReplay, type MatchupResult, type ModelProgressMsg, type ProgressMsg, type ReplayRequest, type ReplayResult, type RunJob} from '../sim/client';
import type {MetamonProvider} from '../sim/metamon/model';

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunState {
  status: RunStatus;
  progress: ProgressMsg | null;
  modelProgress: ModelProgressMsg | null;
  /** Which ONNX execution provider the worker initialized (null until known). */
  provider: MetamonProvider | null;
  /** Wall-clock ms when the first battle started (excludes model download/load). */
  startedAt: number | null;
  results: MatchupResult[];
  error: string | null;
}

/**
 * Owns the Web Worker lifecycle for a benchmark run.
 * Cancellation is cooperative: a flag checked between battles in the worker.
 */
export function useBenchmarkRun() {
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<RunState>({
    status: 'idle',
    progress: null,
    modelProgress: null,
    provider: null,
    startedAt: null,
    results: [],
    error: null,
  });

  const stopWorker = useCallback(() => {
    cancelRef.current = null;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  useEffect(() => stopWorker, [stopWorker]);

  const start = useCallback(
    (job: RunJob) => {
      stopWorker();
      const worker = createBenchmarkWorker();
      workerRef.current = worker;
      setState({status: 'running', progress: null, modelProgress: null, provider: null, startedAt: null, results: [], error: null});
      const cancel = startRun(worker, job, {
        onModelProgress: (modelProgress) =>
          setState((s) => ({...s, modelProgress})),
        onProvider: (provider) =>
          setState((s) => ({...s, provider})),
        onProgress: (progress) =>
          setState((s) => ({
            ...s,
            progress,
            modelProgress: null,
            startedAt: s.startedAt ?? Date.now(),
          })),
        onMatchup: (_index, result) =>
          setState((s) => ({...s, results: [...s.results, result]})),
        onDone: (results) => {
          setState((s) => ({...s, status: 'done', results, progress: null, modelProgress: null}));
          cancelRef.current = null;
        },
        onCancelled: () => {
          setState((s) => ({...s, status: 'cancelled', progress: null, modelProgress: null}));
          cancelRef.current = null;
        },
        onError: (message) => {
          setState((s) => ({...s, status: 'error', error: message, progress: null, modelProgress: null}));
          cancelRef.current = null;
        },
      });
      cancelRef.current = cancel;
    },
    [stopWorker],
  );

  const cancel = useCallback(() => {
    cancelRef.current?.();
  }, []);

  /**
   * Re-simulate battle 0 of a matchup and return its protocol log. Reuses the
   * existing worker (model session stays cached) or spawns one. Must not be
   * called while a run is active.
   */
  const replay = useCallback(async (req: ReplayRequest): Promise<ReplayResult> => {
    let worker = workerRef.current;
    if (!worker) {
      worker = createBenchmarkWorker();
      workerRef.current = worker;
    }
    return requestReplay(worker, req);
  }, []);

  const reset = useCallback(() => {
    stopWorker();
    setState({status: 'idle', progress: null, modelProgress: null, provider: null, startedAt: null, results: [], error: null});
  }, [stopWorker]);

  return {state, start, cancel, reset, replay, running: state.status === 'running'};
}
