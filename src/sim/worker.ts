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

export interface BattleScore {
  winner: 'p1' | 'p2' | null;
  turns: number;
  p1Left: number;
  p2Left: number;
  /** Model actions that failed to map to a Showdown choice (should stay ~0). */
  unmappable?: number;
  /**
   * 0-based battle within the matchup. Set on pool-mode results so the client
   * can keep per-matchup battles in canonical order when they land out of
   * order. Absent on runs recorded before the worker pool.
   */
  battleIndex?: number;
}

/** One battle assigned to a pool worker. */
export interface PoolBattle {
  matchupIndex: number;
  battleIndex: number;
  ref: RefTeam;
}

/**
 * Pool-mode job: this worker runs `battles` sequentially and reports each
 * battle as it finishes. Battles are pre-assigned by the client (round-robin
 * over (matchupIndex, battleIndex)); per-battle seeds derive from
 * (seed, matchupIndex, battleIndex), so results are identical regardless of
 * worker count or completion order.
 */
export interface PoolJob {
  userTeam: {name: string; paste: string};
  seed: string;
  battles: PoolBattle[];
}

export interface MatchupResult {
  refId: string;
  name: string;
  archetype: string;
  wins: number;
  losses: number;
  draws: number;
  /** Original index in the benchmark's ref list (for deterministic replay seeds). */
  matchupIndex: number;
  /** Per-battle results (winner, turns, mons remaining). Absent on runs recorded before this field existed. */
  battles?: BattleScore[];
}

type Out =
  | {type: 'model-progress'; fraction: number; stage: 'cached' | 'downloading' | 'loading'}
  | {type: 'provider'; provider: MetamonProvider}
  | {type: 'replay-log'; matchupIndex: number; battleIndex: number; winner: 'p1' | 'p2' | null; turns: number; log: string[]}
  | {type: 'replay-error'; matchupIndex: number; battleIndex: number; message: string}
  | {type: 'battle'; matchupIndex: number; battleIndex: number; score: BattleScore}
  | {type: 'pool-done'}
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

/** Messages the worker accepts — the inbound mirror of the `Out` union. */
type In =
  | {type: 'cancel'}
  | {type: 'run-pool'; job: PoolJob}
  | {
      type: 'replay';
      userPaste?: string;
      refPaste?: string;
      seed?: string;
      matchupIndex?: number;
      battleIndex?: number;
      p1Name?: string;
      p2Name?: string;
    };

w.onmessage = (e: MessageEvent) => {
  const msg = e.data as In;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  // On-demand replay: re-simulate one battle of a matchup (deterministic seed,
  // so it is the exact same battle) and return its full protocol log.
  if (msg.type === 'replay') {
    const {userPaste = '', refPaste = '', seed = '', matchupIndex = 0, battleIndex = 0, p1Name = '', p2Name = ''} = msg;
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
          p1Name,
          p2Name,
        }, () => false);
        post({type: 'replay-log', matchupIndex, battleIndex, winner: r.winner, turns: r.turns, log: r.log ?? []});
      } catch (err: any) {
        post({type: 'replay-error', matchupIndex, battleIndex, message: String(err?.message || err)});
      }
    })();
    return;
  }
  if (msg.type !== 'run-pool' || !msg.job) return;
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

      for (const b of job.battles) {
        if (cancelled) {
          post({type: 'cancelled'});
          return;
        }
        const r = await runBattleMetamon(runner, job.userTeam.paste, b.ref.paste, {
          seed: job.seed,
          matchupIndex: b.matchupIndex,
          battleIndex: b.battleIndex,
        }, isCancelled);
        post({
          type: 'battle',
          matchupIndex: b.matchupIndex,
          battleIndex: b.battleIndex,
          score: {
            winner: r.winner,
            turns: r.turns,
            p1Left: r.p1Left ?? 0,
            p2Left: r.p2Left ?? 0,
            unmappable: r.unmappable ?? 0,
            battleIndex: b.battleIndex,
          },
        });
      }
      post({type: 'pool-done'});
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
