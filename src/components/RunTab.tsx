import type {RunConfig, RunMeta, SavedTeam} from '../lib/types';
import {randomSeed} from '../lib/types';
import type {RunState} from '../lib/useBenchmarkRun';
import type {MatchupResult, RefTeam} from '../sim/client';
import SpriteStrip from './SpriteStrip';

interface Props {
  teams: SavedTeam[];
  selectedTeamId: string | null;
  selectedRefs: RefTeam[];
  config: RunConfig;
  onConfigChange: (c: RunConfig) => void;
  runState: RunState;
  onStart: () => void;
  onCancel: () => void;
  onSelectTeam: (id: string | null) => void;
}

export function buildJob(
  teams: SavedTeam[],
  selectedTeamId: string | null,
  selectedRefs: RefTeam[],
  config: RunConfig,
): {job: {userTeam: {name: string; paste: string}; refs: RefTeam[]; battlesPerMatchup: number; seed: string}; meta: RunMeta} | null {
  const team = teams.find((t) => t.id === selectedTeamId);
  if (!team || selectedRefs.length === 0) return null;
  const battlesPerMatchup = Math.max(1, Math.min(200, Math.floor(config.battlesPerMatchup) || 20));
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
      engine: 'metamon-kadabra3',
      userPaste: team.paste,
    },
  };
}

export function summarize(results: MatchupResult[]): {wins: number; losses: number; draws: number} {
  return results.reduce(
    (acc, r) => ({wins: acc.wins + r.wins, losses: acc.losses + r.losses, draws: acc.draws + r.draws}),
    {wins: 0, losses: 0, draws: 0},
  );
}

export default function RunTab({
  teams,
  selectedTeamId,
  selectedRefs,
  config,
  onConfigChange,
  runState,
  onStart,
  onCancel,
  onSelectTeam,
}: Props) {
  const running = runState.status === 'running';
  const p = runState.progress;
  const mp = runState.modelProgress;
  const totalBattles = selectedRefs.length * Math.max(1, Math.min(200, Math.floor(config.battlesPerMatchup) || 20));
  const doneBattles = p ? p.matchupsDone * p.battlesPerMatchup + p.battle : 0;
  const pct = totalBattles > 0 ? Math.min(100, (doneBattles / totalBattles) * 100) : 0;
  const canStart = !running && selectedTeamId && selectedRefs.length > 0;
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  return (
    <div className="panel">
      <h2>Run Benchmark</h2>
      <p className="muted">
        Battles run in a Web Worker in your browser tab — the page stays responsive. Results are
        deterministic for a given seed.
      </p>

      <div className="card">
        <div className="form-grid">
          <label className="field">
            <span>Your team</span>
            <select
              value={selectedTeamId ?? ''}
              onChange={(e) => onSelectTeam(e.target.value || null)}
              disabled={running}
            >
              <option value="">— choose a team —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Battles per matchup (1–200)</span>
            <input
              type="number"
              min={1}
              max={200}
              value={config.battlesPerMatchup}
              onChange={(e) => onConfigChange({...config, battlesPerMatchup: Number(e.target.value)})}
              disabled={running}
            />
          </label>
          <label className="field">
            <span>Seed</span>
            <span className="inline-form">
              <input
                type="text"
                value={config.seed}
                onChange={(e) => onConfigChange({...config, seed: e.target.value})}
                disabled={running}
                maxLength={32}
              />
              <button
                className="btn small ghost"
                disabled={running}
                onClick={() => onConfigChange({...config, seed: randomSeed()})}
                title="Randomize seed"
              >
                🎲
              </button>
            </span>
          </label>
        </div>
        <p className="muted tiny">
          {selectedRefs.length} reference team{selectedRefs.length === 1 ? '' : 's'} selected →{' '}
          {totalBattles} total battles.
        </p>
        {selectedTeam && <SpriteStrip paste={selectedTeam.paste} size={40} />}
        {!running ? (
          <button className="btn primary large" onClick={onStart} disabled={!canStart}>
            ▶ Start benchmark
          </button>
        ) : (
          <button className="btn danger large" onClick={onCancel}>
            ■ Cancel
          </button>
        )}
        {!canStart && !running && (
          <p className="muted tiny">
            {!selectedTeamId ? 'Pick a team on the My Teams tab. ' : ''}
            {selectedRefs.length === 0 ? 'Select at least one reference team on the Reference Teams tab.' : ''}
          </p>
        )}
      </div>

      {(running || runState.status === 'error') && (
        <div className="card">
          <h3>{running ? 'Running…' : 'Run failed'}</h3>
          <p className="muted tiny">
            <span className="badge">
              Metamon Kadabra3{runState.provider ? ` · ${runState.provider === 'webgpu' ? 'WebGPU' : 'WASM'}` : ''}
            </span>{' '}
            piloting both sides
          </p>
          {running && mp && (
            <>
              <div className="progress">
                <div className="progress-bar" style={{width: `${Math.round(mp.fraction * 100)}%`}} />
              </div>
              <p className="muted">
                {mp.stage === 'downloading'
                  ? `Downloading model… ${Math.round(mp.fraction * 100)}% (95MB, one-time)`
                  : mp.stage === 'cached'
                    ? 'Model loaded from cache…'
                    : 'Loading model…'}
              </p>
            </>
          )}
          {running && p && !mp && (
            <>
              <div className="progress">
                <div className="progress-bar" style={{width: `${pct}%`}} />
              </div>
              <p className="muted">
                {p.matchupName} — battle {p.battle}/{p.battlesPerMatchup} · matchup{' '}
                {p.matchupIndex + 1}/{p.matchupsTotal} · {doneBattles}/{totalBattles} battles
              </p>
            </>
          )}
          {running && !p && !mp && <p className="muted">Starting worker…</p>}
          {runState.status === 'error' && (
            <div className="alert error">{runState.error}</div>
          )}
        </div>
      )}

      {runState.status === 'cancelled' && (
        <div className="alert">Run cancelled. Partial results were discarded.</div>
      )}
    </div>
  );
}
