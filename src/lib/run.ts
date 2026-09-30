/**
 * Shared run helpers: job construction, score math, run-record naming, ETA.
 * Lives in lib/ so UI components don't import utilities from each other.
 */
import type {MatchupResult, RefTeam, RunJob} from '../sim/client';
import type {MetamonProvider} from '../sim/metamon/model';
import type {RunConfig, RunMeta, RunRecord, SavedTeam} from './types';
import {randomSeed, uid} from './types';

/** Pilot id for the Metamon Kadabra3 neural pilot (plays both sides). */
export const METAMON_ENGINE = 'metamon-kadabra3' as const;

export interface Wld {
  wins: number;
  losses: number;
  draws: number;
}

export function clampBattlesPerMatchup(n: number): number {
  return Math.max(1, Math.min(200, Math.floor(n) || 20));
}

export function summarize(results: MatchupResult[]): Wld {
  return results.reduce(
    (acc, r) => ({wins: acc.wins + r.wins, losses: acc.losses + r.losses, draws: acc.draws + r.draws}),
    {wins: 0, losses: 0, draws: 0},
  );
}

export function winRate(r: Wld): number {
  const total = r.wins + r.losses + r.draws;
  return total === 0 ? 0 : r.wins / total;
}

/** "12W / 3L / 1D (75%)" — omits the percent when no games were played. */
export function formatWld(r: Wld): string {
  const total = r.wins + r.losses + r.draws;
  const pct = total > 0 ? ` (${Math.round(winRate(r) * 100)}%)` : '';
  return `${r.wins}W / ${r.losses}L / ${r.draws}D${pct}`;
}

export function buildJob(
  teams: SavedTeam[],
  selectedTeamId: string | null,
  selectedRefs: RefTeam[],
  config: RunConfig,
): {job: RunJob; meta: RunMeta} | null {
  const team = teams.find((t) => t.id === selectedTeamId);
  if (!team || selectedRefs.length === 0) return null;
  const battlesPerMatchup = clampBattlesPerMatchup(config.battlesPerMatchup);
  const seed = config.seed.trim() || randomSeed();
  return {
    job: {
      userTeam: {name: team.name, paste: team.paste},
      refs: selectedRefs,
      battlesPerMatchup,
      seed,
    },
    meta: {
      teamName: team.name,
      battlesPerMatchup,
      seed,
      refCount: selectedRefs.length,
      date: Date.now(),
      engine: METAMON_ENGINE,
      userPaste: team.paste,
    },
  };
}

export function fmtElapsed(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return '';
  const s = Math.round(totalSec);
  if (s < 60) return `${s}s elapsed`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s elapsed`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m elapsed`;
}

export interface RefInfo {
  id: string;
  name: string;
  archetype: string;
}

/**
 * Build the history record for a finished (or kept partial) run.
 * The name embeds a readable timestamp; partial runs get a suffix.
 */
export function buildRunRecord(opts: {
  meta: RunMeta;
  refs: RefTeam[];
  results: MatchupResult[];
  provider?: MetamonProvider | null;
  partial?: boolean;
}): RunRecord {
  const {refs, results, provider, partial} = opts;
  const meta: RunMeta = {...opts.meta};
  if (provider) meta.provider = provider;
  if (partial) meta.partial = true;
  const when = new Date(meta.date);
  const stamp = `${when.toLocaleDateString()} ${when.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
  return {
    id: uid(),
    name: `${meta.teamName} — ${stamp}${partial ? ' (partial)' : ''}`,
    date: meta.date,
    meta,
    refs: refs.map((r) => ({id: r.id, name: r.name, archetype: r.archetype})),
    results,
  };
}
