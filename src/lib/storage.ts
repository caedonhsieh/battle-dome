import type {CustomRef, RunConfig, RunRecord, SavedTeam} from './types';
import {randomSeed} from './types';

const K = {
  teams: 'battledome.teams.v1',
  customRefs: 'battledome.customRefs.v1',
  config: 'battledome.config.v1',
  history: 'battledome.history.v1',
  selection: 'battledome.selection.v1',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

export const store = {
  getTeams: (): SavedTeam[] => read(K.teams, []),
  setTeams: (t: SavedTeam[]) => write(K.teams, t),
  getCustomRefs: (): CustomRef[] => read(K.customRefs, []),
  setCustomRefs: (r: CustomRef[]) => write(K.customRefs, r),
  getConfig: (): RunConfig => ({
    battlesPerMatchup: 20,
    seed: randomSeed(),
    workerCount: 2,
    ...read<Partial<RunConfig>>(K.config, {}),
  }),
  setConfig: (c: RunConfig) => write(K.config, c),
  getHistory: (): RunRecord[] => read(K.history, []),
  setHistory: (h: RunRecord[]) => write(K.history, h),
  getSelection: (): {teamId: string | null; refIds: string[]} =>
    read(K.selection, {teamId: null, refIds: []}),
  setSelection: (s: {teamId: string | null; refIds: string[]}) => write(K.selection, s),
};
