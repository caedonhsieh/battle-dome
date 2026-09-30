import type {MatchupResult} from '../sim/worker';

export interface SavedTeam {
  id: string;
  name: string;
  paste: string;
  createdAt: number;
}

export interface CustomRef {
  id: string;
  name: string;
  archetype: string;
  paste: string;
  createdAt: number;
}

export interface BundledRef {
  id: string;
  name: string;
  archetype: string;
  author: string;
  url: string;
  paste: string;
}

export interface RunConfig {
  battlesPerMatchup: number;
  seed: string;
  /** Number of parallel benchmark workers (1–8). Absent on configs saved before the worker pool. */
  workerCount?: number;
}

export interface RunMeta {
  teamName: string;
  battlesPerMatchup: number;
  seed: string;
  refCount: number;
  date: number;
  /** Pilot that played both sides. Absent on runs from before engine tracking (heuristic). */
  engine?: 'heuristic' | 'metamon-kadabra3';
  /** ONNX execution provider that ran the Metamon pilot. Absent before provider tracking. */
  provider?: 'webgpu' | 'wasm';
  /** The user's team paste at run time (for replays). Absent on old runs. */
  userPaste?: string;
  /** True when the run was cancelled and only partial results were kept. */
  partial?: boolean;
  /** Wall-clock battle time in ms (excludes model download/load). Absent on old runs. */
  durationMs?: number;
}

export interface RunRecord {
  id: string;
  name: string;
  date: number;
  meta: RunMeta;
  refs: {id: string; name: string; archetype: string}[];
  results: MatchupResult[];
}

export const SMOGON_THREAD_URL =
  'https://www.smogon.com/forums/threads/sv-ou-sample-teams-new-samples-added-post-spl-and-tera-blast-ban.3712513/';
export const FORMAT_LABEL = 'gen9 OU';
export const REFERENCE_SET_LABEL = 'Smogon SV OU Sample Teams';

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
