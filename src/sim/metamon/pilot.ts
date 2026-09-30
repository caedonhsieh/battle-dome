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

interface Step {
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
  private trackers: Record<Side, BattleTracker> = {
    p1: new BattleTracker(),
    p2: new BattleTracker(),
  };
  private v3 = new V3ObservationSpace();
  private histories: Record<Side, Step[]> = {p1: [], p2: []};
  private lastStates: Record<Side, UniversalState | null> = {p1: null, p2: null};
  private prevActions: Record<Side, number | null> = {p1: null, p2: null};
  private t: Record<Side, number> = {p1: 0, p2: 0};
  /** Decisions that produced no mappable choice (should stay ~0). */
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

    const step: Step = {numbers, tokens, illegal, rl2s, t: this.t[side]};
    const history = [...this.histories[side], step];
    const logits = await this.infer(history);

    let best = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < 13; i++) {
      if (illegal[i]) continue;
      const v = logits[i];
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
    }
    if (best < 0) return null;

    const order = actionIdxToOrder(tr, best);
    const choice = order ? orderToChoice(tr, order) : null;
    if (!choice) {
      this.unmappable++;
      return null;
    }

    this.histories[side] = history;
    this.lastStates[side] = state;
    this.prevActions[side] = best;
    this.t[side]++;
    return choice;
  }

  private async infer(history: Step[]): Promise<number[]> {
    const T = history.length;
    const numbers = new Float32Array(T * 55);
    const tokens = new BigInt64Array(T * 106);
    const illegal = new Uint8Array(T * 13);
    const rl2s = new Float32Array(T * 14);
    const timeIdxs = new BigInt64Array(T);
    history.forEach((s, i) => {
      s.numbers.forEach((v, j) => (numbers[i * 55 + j] = v));
      s.tokens.forEach((v, j) => (tokens[i * 106 + j] = BigInt(v)));
      s.illegal.forEach((v, j) => (illegal[i * 13 + j] = v ? 1 : 0));
      s.rl2s.forEach((v, j) => (rl2s[i * 14 + j] = v));
      timeIdxs[i] = BigInt(s.t);
    });
    const {Tensor} = this.ort;
    const feeds: Record<string, unknown> = {
      numbers: new Tensor('float32', numbers, [1, T, 55]),
      text_tokens: new Tensor('int64', tokens, [1, T, 106]),
      illegal_actions: new Tensor('bool', illegal, [1, T, 13]),
      rl2s: new Tensor('float32', rl2s, [1, T, 14]),
      time_idxs: new Tensor('int64', timeIdxs, [1, T, 1]),
    };
    const out = await this.session.run(feeds);
    const data = out['logits'].data as ArrayLike<number>;
    // logits shape: [1, T, 13] — take the last timestep.
    const last: number[] = [];
    for (let i = 0; i < 13; i++) last.push(Number(data[(T - 1) * 13 + i]));
    return last;
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
