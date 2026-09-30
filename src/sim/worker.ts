/**
 * Web Worker entry: runs matchups off the main thread, both sides piloted by
 * the Metamon Kadabra3 model (onnxruntime-web, WebGPU with WASM fallback).
 *
 * The model (~95MB) is downloaded once, same-origin from the gh-pages branch,
 * and cached in IndexedDB; progress is reported to the UI.
 */
import * as ort from 'onnxruntime-web';
import {loadMetamonSession, type MetamonProvider} from './metamon/model';
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
  | {type: 'provider'; provider: MetamonProvider}
  | {type: 'replay-log'; matchupIndex: number; battleIndex: number; winner: 'p1' | 'p2' | null; turns: number; log: string[]}
  | {type: 'replay-error'; matchupIndex: number; battleIndex: number; message: string}
  | {type: 'progress'; matchupIndex: number; matchupName: string; battle: number; battlesPerMatchup: number; matchupsDone: number; matchupsTotal: number; matchupWins: number; matchupLosses: number; matchupDraws: number}
  | {type: 'matchup'; index: number; result: MatchupResult}
  | {type: 'done'; results: MatchupResult[]}
  | {type: 'cancelled'}
  | {type: 'error'; message: string};

let cancelled = false;
let cachedSession: ort.InferenceSession | null = null;
let cachedProvider: MetamonProvider | null = null;

const w = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: Out) => void;
};

type Post = (m: Out) => void;

/** Load the model session if needed. Posts model-progress on first load. */
async function ensureSession(post: Post): Promise<ort.InferenceSession> {
  let session = cachedSession;
  if (!session) {
    const loaded = await loadMetamonSession((fraction, stage) =>
      post({type: 'model-progress', fraction, stage}),
    );
    session = loaded.session;
    cachedSession = session;
    cachedProvider = loaded.provider;
  }
  return session;
}

w.onmessage = (e: MessageEvent) => {
  const msg = e.data as {type: string; job?: RunJob; userPaste?: string; refPaste?: string; seed?: string; matchupIndex?: number; battleIndex?: number};
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  // On-demand replay: re-simulate one battle of a matchup (deterministic seed,
  // so it is the exact same battle) and return its full protocol log.
  if (msg.type === 'replay') {
    const {userPaste = '', refPaste = '', seed = '', matchupIndex = 0, battleIndex = 0} = msg;
    const post = (m: Out) => w.postMessage(m);
    void (async () => {
      try {
        const session = await ensureSession(post);
        const runner: MetamonRunner = {ort, session};
        const r = await runBattleMetamon(runner, userPaste, refPaste, {
          seed,
          matchupIndex,
          battleIndex,
          captureLog: true,
        }, () => false);
        post({type: 'replay-log', matchupIndex, battleIndex, winner: r.winner, turns: r.turns, log: r.log ?? []});
      } catch (err: any) {
        post({type: 'replay-error', matchupIndex, battleIndex, message: String(err?.message || err)});
      }
    })();
    return;
  }
  if (msg.type !== 'run' || !msg.job) return;
  cancelled = false;
  const job = msg.job;
  const post = (m: Out) => w.postMessage(m);

  void (async () => {
    try {
      const session = await ensureSession(post);
      post({type: 'provider', provider: cachedProvider!});
      if (cancelled) {
        post({type: 'cancelled'});
        return;
      }
      const runner: MetamonRunner = {ort, session};
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
            matchupWins: wins,
            matchupLosses: losses,
            matchupDraws: draws,
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
        cachedProvider = null;
        post({type: 'error', message: String(err?.message || err)});
      }
    }
  })();
};

export {};
