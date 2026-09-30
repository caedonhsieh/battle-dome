/**
 * Metamon Kadabra3 pilot: per-side BattleTrackers fed with privacy-correct
 * Showdown protocol lines, observation pipeline from the parity-verified port
 * (./battle.js, ./obs.js), argmax over legal actions, mapped back to Showdown
 * choice strings.
 *
 * The ort module and session are injected so this file stays runtime-agnostic:
 * the browser passes onnxruntime-web, Node tests can pass onnxruntime-node.
 */
import {BattleTracker, type ShowdownRequest} from './battle.js';
import {
  V3ObservationSpace,
  aggressiveShapedReward,
  definitelyValidActions,
  tokenize,
  universalStateFromTracker,
  actionIdxToOrder,
  type BattleOrderResult,
  type UniversalState,
} from './obs.js';
import {moveName} from './strutil.js';
import vocabJson from './data/vocab.json' with {type: 'json'};

const VOCAB = vocabJson as Record<string, number>;

export interface TensorLike {
  data: any;
}

export interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, TensorLike>>;
}

export interface OrtLike {
  Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
}

export interface Step {
  numbers: number[];
  tokens: number[];
  illegal: boolean[];
  rl2s: number[];
  t: number;
}

export type Side = 'p1' | 'p2';

const SIDES: Side[] = ['p1', 'p2'];

/** Fresh per-battle pilot state for both sides sharing one model session. */
export class MetamonBattle {
  /** Debug hook: fired after each accepted decision (side, step fed, logits, chosen action). */
  onDecision?: (side: Side, step: Step, logits: number[], action: number) => void;
  private trackers: Record<Side, BattleTracker> = {
    p1: new BattleTracker(),
    p2: new BattleTracker(),
  };
  private v3 = new V3ObservationSpace();
  /**
   * Per-side KV-cache state. Each side gets an independent cache so the two
   * players' histories never interleave. Caches are zero-initialized;
   * unused slots are masked by the model via seq_lens.
   * Shape: [6 layers, 1 batch, 200 max seq, 12 heads, 64 head dim].
   */
  private keyCache: Record<Side, Float32Array> = {
    p1: new Float32Array(6 * 1 * 200 * 12 * 64),
    p2: new Float32Array(6 * 1 * 200 * 12 * 64),
  };
  private valCache: Record<Side, Float32Array> = {
    p1: new Float32Array(6 * 1 * 200 * 12 * 64),
    p2: new Float32Array(6 * 1 * 200 * 12 * 64),
  };
  /** Number of steps currently cached per side (= write position = time index). */
  private seqLen: Record<Side, number> = {p1: 0, p2: 0};
  private lastStates: Record<Side, UniversalState | null> = {p1: null, p2: null};
  private prevActions: Record<Side, number | null> = {p1: null, p2: null};
  /** Legal-by-tracker actions that failed to map to a Showdown choice (should stay ~0). */
  unmappable = 0;

  constructor(
    private ort: OrtLike,
    private session: OrtSessionLike,
  ) {}

  /** Feed fresh privacy-correct protocol lines (per-side split already applied). */
  feedLines(side: Side, lines: string[]): void {
    const tr = this.trackers[side];
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      tr.parseMessage(line.split('|'));
    }
  }

  /**
   * Decide a choice for `side` given its request. Returns a Showdown choice
   * string ('move N [terastallize]' / 'switch N' / 'team 123456'), or null
   * when the side should wait / autoChoose.
   */
  async decide(side: Side, request: ShowdownRequest): Promise<string | null> {
    const tr = this.trackers[side];
    tr.parseRequest(request);
    if (request.teamPreview) return 'team 123456';
    if (request.wait) return null;

    const state = universalStateFromTracker(tr, `battle-${side}`);
    const {text, numbers} = this.v3.stateToObs(state);
    const tokens = tokenize(text, VOCAB);
    const legal = definitelyValidActions(state, tr);
    if (legal.size === 0) return null;
    const illegal = Array.from({length: 13}, (_, i) => !legal.has(i));

    const rl2s: number[] = new Array(14).fill(0);
    const last = this.lastStates[side];
    const prev = this.prevActions[side];
    if (last !== null && prev !== null) {
      rl2s[0] = aggressiveShapedReward(last, state);
      rl2s[1 + prev] = 1;
    }

    const step: Step = {numbers, tokens, illegal, rl2s, t: this.seqLen[side]};
    // KV-cache inference: feed only the new step; the model returns updated
    // caches which are committed below iff a choice maps successfully.
    const {logits, newKeyCache, newValCache} = await this.inferStep(side, step);

    // Try legal actions in descending logit order and take the first one that
    // maps to a real Showdown choice. A single unmappable action (e.g. a
    // stale tracker view) must not nuke the whole decision into a silent
    // move-slot-1 autoChoose.
    const ranked: number[] = [];
    for (let i = 0; i < 13; i++) if (!illegal[i]) ranked.push(i);
    ranked.sort((a, b) => logits[b] - logits[a]);
    if (ranked.length === 0) return null;

    for (const a of ranked) {
      const order = actionIdxToOrder(tr, a);
      const choice = order ? orderToChoice(tr, order) : null;
      if (choice) {
        // Commit the KV cache: the step we just fed is now part of history.
        this.keyCache[side] = newKeyCache;
        this.valCache[side] = newValCache;
        this.seqLen[side]++;
        this.lastStates[side] = state;
        this.prevActions[side] = a;
        this.onDecision?.(side, step, logits, a);
        return choice;
      }
      this.unmappable++;
    }
    return null;
  }

  /**
   * Run one KV-cache inference step for `side`. Feeds only the new step's
   * tensors ([1,1,...]) plus the side's current cache; returns the logits and
   * the updated caches (not yet committed — the caller commits on success).
   */
  private async inferStep(side: Side, s: Step): Promise<{
    logits: number[];
    newKeyCache: Float32Array;
    newValCache: Float32Array;
  }> {
    const {Tensor} = this.ort;
    const numbers = new Float32Array(s.numbers);
    const tokens = new BigInt64Array(s.tokens.map(BigInt));
    const illegal = new Uint8Array(s.illegal.map((v) => (v ? 1 : 0)));
    const rl2s = new Float32Array(s.rl2s);
    const timeIdxs = new BigInt64Array([BigInt(s.t)]);
    const seqLens = new Int32Array([this.seqLen[side]]);
    const feeds: Record<string, unknown> = {
      numbers: new Tensor('float32', numbers, [1, 1, 55]),
      text_tokens: new Tensor('int64', tokens, [1, 1, 106]),
      illegal_actions: new Tensor('bool', illegal, [1, 1, 13]),
      rl2s: new Tensor('float32', rl2s, [1, 1, 14]),
      time_idxs: new Tensor('int64', timeIdxs, [1, 1, 1]),
      key_cache: new Tensor('float32', this.keyCache[side], [6, 1, 200, 12, 64]),
      val_cache: new Tensor('float32', this.valCache[side], [6, 1, 200, 12, 64]),
      seq_lens: new Tensor('int32', seqLens, [1]),
    };
    const out = await this.session.run(feeds);
    const data = out['logits'].data as ArrayLike<number>;
    // logits shape: [1,1,13] — consume the 13-value vector robustly.
    const logits: number[] = [];
    for (let i = 0; i < 13; i++) logits.push(Number(data[data.length - 13 + i]));
    return {
      logits,
      newKeyCache: new Float32Array(out['new_key_cache'].data as ArrayLike<number>),
      newValCache: new Float32Array(out['new_val_cache'].data as ArrayLike<number>),
    };
  }
}

/** Map a BattleOrderResult to a Showdown request slot choice string. */
function orderToChoice(tr: BattleTracker, order: Exclude<BattleOrderResult, null>): string | null {
  const req = tr.lastRequest;
  if (!req) return null;
  if (order.kind === 'move') {
    const moves = req.active?.[0]?.moves ?? [];
    const want = order.move.lookupName;
    const idx = moves.findIndex((m) => moveName(m.id) === want);
    if (idx < 0) return null;
    return `move ${idx + 1}${order.tera ? ' terastallize' : ''}`;
  }
  const mons = req.side.pokemon ?? [];
  const wantNick = order.pokemon.nickname;
  const idx = mons.findIndex((p) => identNickname(p.ident) === wantNick);
  if (idx < 0) return null;
  return `switch ${idx + 1}`;
}

function identNickname(ident: string): string {
  const i = ident.indexOf(':');
  return i >= 0 ? ident.slice(i + 1).trim() : ident.trim();
}

export {SIDES};
