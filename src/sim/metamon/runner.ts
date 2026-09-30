/**
 * Async battle runner with the Metamon Kadabra3 pilot on both sides.
 *
 * Mirrors the validated parity-driver pattern: the @pkmn/sim Battle is given
 * a `send` capture; broadcast `update` + per-side `sideupdate` protocol lines
 * are split per side (resolving |split| sections) and fed to each side's
 * BattleTracker; each side's request is decided by the model (argmax over
 * legal actions) and mapped back to a Showdown choice string.
 *
 * SplitMix32-derived battle seeds (never sequential — sequential seeds bias
 * the sim's Gen5 LCG).
 */
import {Battle, Teams} from '@pkmn/sim';
import {MAX_TURNS, hashSeed, type BattleResult, type RunBattleOpts} from '../bot.js';
import {MetamonBattle, type OrtLike, type OrtSessionLike, type Side} from './pilot.js';
import type {ShowdownRequest} from './battle.js';

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/** Sanitize a display name for use in protocol lines (| and newlines are separators). */
function cleanName(name: string | undefined, fallback: string): string {
  const cleaned = (name ?? '').replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return cleaned || fallback;
}

/* ------------------------------------------------------------------ */
/* SplitMix32                                                          */
/* ------------------------------------------------------------------ */

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/* ------------------------------------------------------------------ */
/* Protocol capture (update + sideupdate)                              */
/* ------------------------------------------------------------------ */

interface CaptureState {
  broadcast: string[];
  side: Record<Side, string[]>;
}

function makeCapture() {
  const state: CaptureState = {broadcast: [], side: {p1: [], p2: []}};
  const send = (type: string, data: string | string[]) => {
    const txt = Array.isArray(data) ? data.join('\n') : data;
    if (type === 'update') {
      for (const line of txt.split('\n')) state.broadcast.push(line);
    } else if (type === 'sideupdate') {
      const nl = txt.indexOf('\n');
      const side = txt.slice(0, nl);
      if (side !== 'p1' && side !== 'p2') return;
      for (const line of txt.slice(nl + 1).split('\n')) {
        if (line.startsWith('|request|') || line === side || line === '') continue;
        state.side[side as Side].push(line);
      }
    }
  };
  return {state, send};
}

function takeNewLines(
  state: CaptureState,
  side: Side,
  consumed: {b: Record<Side, number>; s: Record<Side, number>},
): string[] {
  const bNew = state.broadcast.slice(consumed.b[side]);
  const sNew = state.side[side].slice(consumed.s[side]);
  consumed.b[side] = state.broadcast.length;
  consumed.s[side] = state.side[side].length;
  const out: string[] = [];
  for (let i = 0; i < bNew.length; i++) {
    const m = /^\|split\|(p[12])$/.exec(bNew[i]);
    if (m) {
      out.push(m[1] === side ? (bNew[i + 1] ?? '') : (bNew[i + 2] ?? ''));
      i += 2;
    } else {
      out.push(bNew[i]);
    }
  }
  return out.concat(sNew);
}

/** Build the tracker's request view from the sim side (parity-driver shape). */
function buildRequest(battle: Battle, side: Side): ShowdownRequest {
  const s: any = (battle as any)[side];
  const data = s.getRequestData();
  const req: ShowdownRequest = {
    side: {name: data.name, id: data.id, pokemon: data.pokemon},
    rqid: 1,
  } as ShowdownRequest;
  const ar = s.activeRequest;
  if (ar) {
    if (ar.teamPreview) req.teamPreview = true;
    if (ar.wait) req.wait = true;
    if (ar.forceSwitch) req.forceSwitch = ar.forceSwitch;
    if (ar.active) req.active = ar.active;
  }
  return req;
}

/* ------------------------------------------------------------------ */
/* Battle runner                                                       */
/* ------------------------------------------------------------------ */

export interface MetamonRunner {
  ort: OrtLike;
  session: OrtSessionLike;
}

/**
 * Play one battle, both sides piloted by Metamon. Throws CancelledError if
 * isCancelled() becomes true mid-battle.
 */
export async function runBattleMetamon(
  runner: MetamonRunner,
  pasteA: string,
  pasteB: string,
  opts: RunBattleOpts,
  isCancelled: () => boolean,
): Promise<BattleResult> {
  const teamA = Teams.import(pasteA.trim());
  const teamB = Teams.import(pasteB.trim());
  if (!teamA || !teamB) throw new Error('runBattleMetamon: could not parse one of the teams');

  const {state, send} = makeCapture();
  const mix = splitmix32(hashSeed(`${opts.seed}|${opts.matchupIndex}|${opts.battleIndex}`));
  const battleSeeds = [mix(), mix(), mix(), mix()];
  const battle = new Battle({formatid: 'gen9ou', seed: battleSeeds, send} as any);
  const p1Name = cleanName(opts.p1Name, 'P1');
  const p2Name = cleanName(opts.p2Name, 'P2');
  battle.join('p1' as any, p1Name, 1 as any, Teams.pack(teamA));
  battle.join('p2' as any, p2Name, 1 as any, Teams.pack(teamB));
  battle.sendUpdates();

  const mb = new MetamonBattle(runner.ort, runner.session);
  const consumed = {b: {p1: 0, p2: 0} as Record<Side, number>, s: {p1: 0, p2: 0} as Record<Side, number>};

  let rounds = 0;
  while (!battle.ended && rounds < MAX_TURNS) {
    if (isCancelled()) throw new CancelledError();
    for (const side of ['p1', 'p2'] as const) {
      const s: any = (battle as any)[side];
      if (!s.requestState) continue;
      if (s.requestState === 'wait') {
        s.choose('default');
        continue;
      }
      const req = buildRequest(battle, side);
      const lines = takeNewLines(state, side, consumed);
      mb.feedLines(side, lines);
      let choice: string | null = null;
      try {
        choice = await mb.decide(side, req);
      } catch {
        choice = null;
      }
      let ok = false;
      if (choice) ok = s.choose(choice);
      if (!ok) s.autoChoose();
    }
    battle.commitChoices();
    battle.sendUpdates();
    rounds++;
  }

  // Decide the winner from remaining HP (robust to mutual KOs), not battle.winner.
  const p1Alive = battle.sides[0].pokemon.some((m: any) => m.hp > 0);
  const p2Alive = battle.sides[1].pokemon.some((m: any) => m.hp > 0);
  let winner: 'p1' | 'p2' | null = null;
  if (battle.ended || rounds >= MAX_TURNS) {
    if (p1Alive && !p2Alive) winner = 'p1';
    else if (p2Alive && !p1Alive) winner = 'p2';
  }
  // The sim already emits the standard server header (|t:|, |gametype|,
  // |player|, |gen|, |tier|, |rule|..., |clearpoke|, |poke|, |teampreview|,
  // |teamsize|, |start|). Prepend the room-level |j| join lines so the
  // captured log is a complete standard Showdown battle log, usable with
  // replay-converter tools. The pretty formatter skips |j| lines.
  const header = [`|j|☆${p1Name}`, `|j|☆${p2Name}`];
  return {
    winner,
    turns: battle.turn,
    log: opts.captureLog ? header.concat(state.broadcast) : undefined,
  };
}
