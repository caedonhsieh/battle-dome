/**
 * Web Worker entry: runs matchups off the main thread, both sides piloted by
 * the Metamon Kadabra3 model (onnxruntime-web, WebGPU with WASM fallback).
 *
 * The model (~95MB) is downloaded once from the public GitHub release and
 * cached in IndexedDB; progress is reported to the UI.
 */
import * as ort from 'onnxruntime-web';
import {loadMetamonSession} from './metamon/model';
import {runBattleMetamon, CancelledError, type MetamonRunner} from './metamon/runner';

export interface RefTeam {
  id: string;
  name: string;
  archetype: string;
  paste: string;
}

export interface RunJob {
  userTeam: {name: string; paste: string};
  refs: RefTeam[];
  battlesPerMatchup: number;
  seed: string;
}

export interface MatchupResult {
  refId: string;
  name: string;
  archetype: string;
  wins: number;
  losses: number;
  draws: number;
}

type Out =
  | {type: 'model-progress'; fraction: number; stage: 'cached' | 'downloading' | 'loading'}
  | {type: 'progress'; matchupIndex: number; matchupName: string; battle: number; battlesPerMatchup: number; matchupsDone: number; matchupsTotal: number}
  | {type: 'matchup'; index: number; result: MatchupResult}
  | {type: 'done'; results: MatchupResult[]}
  | {type: 'cancelled'}
  | {type: 'error'; message: string};

let cancelled = false;
let cachedSession: ort.InferenceSession | null = null;

const w = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: Out) => void;
};

w.onmessage = (e: MessageEvent) => {
  const msg = e.data as {type: string; job?: RunJob};
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type !== 'run' || !msg.job) return;
  cancelled = false;
  const job = msg.job;
  const post = (m: Out) => w.postMessage(m);

  void (async () => {
    try {
      if (!cachedSession) {
        cachedSession = await loadMetamonSession((fraction, stage) =>
          post({type: 'model-progress', fraction, stage}),
        );
      }
      if (cancelled) {
        post({type: 'cancelled'});
        return;
      }
      const runner: MetamonRunner = {ort, session: cachedSession};
      const isCancelled = () => cancelled;

      const results: MatchupResult[] = [];
      const total = job.refs.length;
      for (let mi = 0; mi < total; mi++) {
        const ref = job.refs[mi];
        let wins = 0, losses = 0, draws = 0;
        for (let bi = 0; bi < job.battlesPerMatchup; bi++) {
          if (cancelled) {
            post({type: 'cancelled'});
            return;
          }
          const r = await runBattleMetamon(runner, job.userTeam.paste, ref.paste, {
            seed: job.seed,
            matchupIndex: mi,
            battleIndex: bi,
          }, isCancelled);
          if (r.winner === 'p1') wins++;
          else if (r.winner === 'p2') losses++;
          else draws++;
          post({
            type: 'progress',
            matchupIndex: mi,
            matchupName: ref.name,
            battle: bi + 1,
            battlesPerMatchup: job.battlesPerMatchup,
            matchupsDone: mi,
            matchupsTotal: total,
          });
        }
        const result: MatchupResult = {
          refId: ref.id,
          name: ref.name,
          archetype: ref.archetype,
          wins,
          losses,
          draws,
        };
        results.push(result);
        post({type: 'matchup', index: mi, result});
      }
      post({type: 'done', results});
    } catch (err: any) {
      if (err instanceof CancelledError) {
        post({type: 'cancelled'});
      } else {
        // A failed session is not reusable.
        cachedSession = null;
        post({type: 'error', message: String(err?.message || err)});
      }
    }
  })();
};

export {};
