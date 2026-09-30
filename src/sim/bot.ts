/**
 * Shared battle simulation + heuristic bot.
 *
 * The heuristic `runBattle` is now only used by the Node scripts
 * (scripts/smoke.ts, scripts/dbg.ts); the browser worker pilots both sides
 * with the Metamon model (src/sim/metamon/runner.ts). This module must stay
 * free of browser-only APIs so the scripts can import it.
 */
import {Battle, Teams, Dex, TeamValidator} from '@pkmn/sim';

export const MAX_TURNS = 200;
const FORMAT = 'gen9ou';

export interface BattleResult {
  winner: 'p1' | 'p2' | null; // null = draw (turn cap reached or mutual KO)
  turns: number;
  /** Full public protocol log. Only populated when captureLog is requested. */
  log?: string[];
  /** Pokémon still standing per side at battle end (useful per-game detail). */
  p1Left?: number;
  p2Left?: number;
}

export interface RunBattleOpts {
  seed: string;
  matchupIndex: number;
  battleIndex: number;
  /** When true, the runner keeps the full public battle log in result.log. */
  captureLog?: boolean;
  /**
   * Readable player names shown in the log's |player| and |win| lines.
   * Sanitized before use (| and newlines are protocol separators).
   * Defaults to 'P1'/'P2'.
   */
  p1Name?: string;
  p2Name?: string;
}

const HAZARDS = ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'] as const;

/* ------------------------------------------------------------------ */
/* Seeded RNG (mulberry32 over an FNV-1a hash of the run parameters).  */
/* ------------------------------------------------------------------ */

export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Type effectiveness                                                  */
/* ------------------------------------------------------------------ */

/** Damage multiplier of a move type against a list of defender types. */
export function typeMultiplier(moveType: string, targetTypes: string[]): number {
  // NOTE: Dex.getImmunity returns FALSE when the target is immune.
  if (!Dex.getImmunity(moveType, targetTypes as any)) return 0;
  return Math.pow(2, Dex.getEffectiveness(moveType, targetTypes as any));
}

/* ------------------------------------------------------------------ */
/* Team validation                                                     */
/* ------------------------------------------------------------------ */

export interface TeamValidation {
  ok: boolean;
  problems: string[];
  /** Species list for display, empty when unparseable. */
  species: string[];
}

export function validateTeamExport(paste: string): TeamValidation {
  const problems: string[] = [];
  const trimmed = paste.trim();
  if (!trimmed) return {ok: false, problems: ['Paste a team export first.'], species: []};

  const team = Teams.import(trimmed);
  if (!team) {
    return {ok: false, problems: ['Could not parse this Showdown team export.'], species: []};
  }
  const species = team.map(s => s.species).filter(Boolean);
  if (team.length !== 6) {
    problems.push(`Team has ${team.length} Pokémon — gen9 OU needs exactly 6.`);
  }
  for (const set of team) {
    if (!set.species) problems.push('A Pokémon slot is missing its species.');
    if (!set.moves || set.moves.length === 0) {
      problems.push(`${set.species || 'A Pokémon'} has no moves.`);
    }
  }
  try {
    const issues = TeamValidator.get(FORMAT).validateTeam(team);
    if (issues) problems.push(...issues);
  } catch (e: any) {
    problems.push(`Validator error: ${e?.message || e}`);
  }
  return {ok: problems.length === 0, problems, species};
}

/** Quick species summary for display (no validation). */
export function teamSpecies(paste: string): string[] {
  try {
    const team = Teams.import(paste.trim());
    if (!team) return [];
    return team.map(s => s.species).filter(Boolean);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Heuristic bot                                                       */
/* ------------------------------------------------------------------ */

interface MoveSlot {
  id: string;
  disabled: boolean;
  slot: number;
}

/** Pick the active Pokémon's move for this turn. */
function chooseMove(side: any, foeSide: any, rng: () => number): string {
  const req = side.activeRequest;
  const active = side.active?.[0];
  if (!req?.active?.[0] || !active) return 'default';

  const slots: MoveSlot[] = (req.active[0].moves || [])
    .map((m: any, i: number) => ({id: m.id as string, disabled: !!m.disabled, slot: i}))
    .filter((m: MoveSlot) => !m.disabled);
  if (slots.length === 0) return 'default';

  const foeActive = foeSide.active?.[0];
  const foeTypes: string[] = foeActive?.getTypes ? foeActive.getTypes() : [];
  const myTypes: string[] = active.getTypes ? active.getTypes() : [];
  const hpFrac = active.maxhp > 0 ? active.hp / active.maxhp : 0;

  // 1. Set entry hazards once (if the foe's side doesn't have them yet).
  for (const m of slots) {
    const data = Dex.moves.get(m.id);
    if (data.sideCondition && (HAZARDS as readonly string[]).includes(data.sideCondition)) {
      if (!foeSide.getSideCondition(data.sideCondition)) return `move ${m.slot + 1}`;
    }
  }

  // 2. Recover when hurt (below 75% HP).
  if (hpFrac < 0.75 && active.hp < active.maxhp) {
    for (const m of slots) {
      const data = Dex.moves.get(m.id);
      if (data.heal) return `move ${m.slot + 1}`;
    }
  }

  // 3. Set up when unboosted and healthy (above 60% HP).
  const unboosted = Object.values(active.boosts || {}).every(v => (v as number) <= 0);
  if (unboosted && hpFrac > 0.6) {
    for (const m of slots) {
      const data = Dex.moves.get(m.id);
      if (data.boosts && data.target === 'self') return `move ${m.slot + 1}`;
    }
  }

  // 4. Otherwise: best damaging move by expected value + ±5% jitter.
  let best = '';
  let bestScore = -Infinity;
  for (const m of slots) {
    const data = Dex.moves.get(m.id);
    let score: number;
    if (data.category === 'Status' || !data.basePower) {
      score = 10; // utility status fallback (Taunt, Thunder Wave, …)
    } else {
      const eff = typeMultiplier(data.type, foeTypes);
      if (eff === 0) continue; // immune — only as a last resort
      const stab = myTypes.includes(data.type) ? 1.5 : 1;
      const acc = data.accuracy === true ? 1 : (data.accuracy as number) / 100;
      const jitter = 0.95 + rng() * 0.1;
      score = data.basePower * eff * stab * acc * jitter;
    }
    if (score > bestScore) {
      bestScore = score;
      best = `move ${m.slot + 1}`;
    }
  }
  return best || 'default';
}

/** Forced switch: pick the bench mon least vulnerable to the foe's STAB types, weighted by HP. */
function chooseSwitch(side: any, foeSide: any): string {
  const foeActive = foeSide.active?.[0];
  const foeStab: string[] = foeActive?.getTypes ? foeActive.getTypes() : [];
  let bestIdx = -1;
  let bestScore = Infinity;
  for (let i = 0; i < side.pokemon.length; i++) {
    const mon = side.pokemon[i];
    if (mon.hp <= 0) continue; // fainted
    if (side.active?.[0] && mon === side.active[0]) continue; // already active
    const types: string[] = mon.getTypes ? mon.getTypes() : [];
    let vuln = 0;
    for (const t of foeStab) vuln += typeMultiplier(t, types);
    const hpFrac = mon.maxhp > 0 ? mon.hp / mon.maxhp : 0;
    const score = vuln / (0.2 + hpFrac);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return 'default';
  return `switch ${bestIdx + 1}`;
}

function sideChoice(battle: Battle, me: 0 | 1, foe: 0 | 1, rng: () => number): string {
  const side: any = battle.sides[me];
  const foeSide: any = battle.sides[foe];
  const req = side.activeRequest;
  if (!req) return 'default';
  if (req.teamPreview) return 'team 123456'; // lead order 1–6
  if (req.wait) return 'default';
  if (req.forceSwitch) return chooseSwitch(side, foeSide);
  return chooseMove(side, foeSide, rng);
}

/* ------------------------------------------------------------------ */
/* Battle runner                                                       */
/* ------------------------------------------------------------------ */

export function runBattle(pasteA: string, pasteB: string, opts: RunBattleOpts): BattleResult {
  const teamA = Teams.import(pasteA.trim());
  const teamB = Teams.import(pasteB.trim());
  if (!teamA || !teamB) throw new Error('runBattle: could not parse one of the teams');

  const rng = mulberry32(hashSeed(`${opts.seed}|${opts.matchupIndex}|${opts.battleIndex}`));
  const ri = () => Math.floor(rng() * 4294967296);
  // NB: @pkmn/sim's public types are stricter than what the runtime accepts
  // (verified working: formatid 'gen9ou', numeric seed array, 'p1'/'p2' ids).
  const battle = new Battle({formatid: FORMAT, seed: [ri(), ri(), ri(), ri()]} as any);
  battle.join('p1' as any, 'P1', 1 as any, Teams.pack(teamA));
  battle.join('p2' as any, 'P2', 1 as any, Teams.pack(teamB));

  let lastTurn = -1;
  let stallGuard = 0;
  while (!battle.ended && battle.turn < MAX_TURNS) {
    const c1 = sideChoice(battle, 0, 1, rng);
    const c2 = sideChoice(battle, 1, 0, rng);
    battle.choose('p1' as any, c1);
    battle.choose('p2' as any, c2);
    if (battle.turn === lastTurn) {
      if (++stallGuard > 20) break; // pathological: no progress → draw
    } else {
      stallGuard = 0;
      lastTurn = battle.turn;
    }
  }

  // Decide the winner from remaining HP (robust to mutual KOs), not battle.winner.
  const p1Alive = battle.sides[0].pokemon.some((m: any) => m.hp > 0);
  const p2Alive = battle.sides[1].pokemon.some((m: any) => m.hp > 0);
  let winner: 'p1' | 'p2' | null = null;
  if (battle.ended || battle.turn >= MAX_TURNS) {
    if (p1Alive && !p2Alive) winner = 'p1';
    else if (p2Alive && !p1Alive) winner = 'p2';
  }
  return {winner, turns: battle.turn};
}
