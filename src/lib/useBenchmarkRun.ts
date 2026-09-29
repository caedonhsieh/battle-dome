import {useCallback, useEffect, useRef, useState} from 'react';
import {createBenchmarkWorker, startRun, type MatchupResult, type ProgressMsg, type RunJob} from '../sim/client';

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunState {
  status: RunStatus;
  progress: ProgressMsg | null;
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
      setState({status: 'running', progress: null, results: [], error: null});
      const cancel = startRun(worker, job, {
        onProgress: (progress) =>
          setState((s) => ({...s, progress})),
        onMatchup: (_index, result) =>
          setState((s) => ({...s, results: [...s.results, result]})),
        onDone: (results) => {
          setState((s) => ({...s, status: 'done', results, progress: null}));
          cancelRef.current = null;
        },
        onCancelled: () => {
          setState((s) => ({...s, status: 'cancelled', progress: null}));
          cancelRef.current = null;
        },
        onError: (message) => {
          setState((s) => ({...s, status: 'error', error: message, progress: null}));
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

  const reset = useCallback(() => {
    stopWorker();
    setState({status: 'idle', progress: null, results: [], error: null});
  }, [stopWorker]);

  return {state, start, cancel, reset, running: state.status === 'running'};
}
