import {useEffect, useState} from 'react';
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
  /** choice: keep the partial results as a run record, or discard them */
  onCancel: (choice: 'keep' | 'discard') => void;
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

function fmtEta(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return '';
  const s = Math.round(totalSec);
  if (s < 60) return `≈ ${s}s left`;
  const m = Math.floor(s / 60);
  if (m < 60) return `≈ ${m}m ${String(s % 60).padStart(2, '0')}s left`;
  return `≈ ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left`;
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

  // Tick once a second while running so the ETA stays fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const base = summarize(runState.results);
  // In-progress matchup tally, updated after every battle. Guarded so the
  // final tally isn't double-counted once the matchup result lands in results.
  const inProgressRow =
    p && !mp && runState.results.length <= p.matchupIndex
      ? {name: p.matchupName, wins: p.matchupWins, losses: p.matchupLosses, draws: p.matchupDraws}
      : null;
  const liveTotals = {
    wins: base.wins + (inProgressRow?.wins ?? 0),
    losses: base.losses + (inProgressRow?.losses ?? 0),
    draws: base.draws + (inProgressRow?.draws ?? 0),
  };
  const liveGrand = liveTotals.wins + liveTotals.losses + liveTotals.draws;
  const inProgressBattles = inProgressRow
    ? inProgressRow.wins + inProgressRow.losses + inProgressRow.draws
    : 0;
  const hasPartialResults = runState.results.length > 0 || inProgressBattles > 0;
  const [cancelDialog, setCancelDialog] = useState(false);
  let etaText = '';
  if (running && runState.startedAt && doneBattles > 0 && totalBattles > doneBattles) {
    const elapsedSec = Math.max(1, (now - runState.startedAt) / 1000);
    etaText = fmtEta((elapsedSec / doneBattles) * (totalBattles - doneBattles));
  }

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
          <button className="btn danger large" onClick={() => setCancelDialog(true)}>
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
                {etaText && <> · {etaText}</>}
              </p>
            </>
          )}
          {running && p && !mp && (runState.results.length > 0 || inProgressRow) && (
            <div className="live-results">
              <p className="muted tiny">
                Running total:{' '}
                <strong className="win-t">{liveTotals.wins}W</strong> /{' '}
                <strong className="loss-t">{liveTotals.losses}L</strong> / {liveTotals.draws}D
                {liveGrand > 0 && ` (${Math.round((liveTotals.wins / liveGrand) * 100)}%)`}
              </p>
              <ul className="mini-list">
                {inProgressRow && (() => {
                  const t = inProgressRow.wins + inProgressRow.losses + inProgressRow.draws;
                  return (
                    <li key="live" className="live-row">
                      <span>{inProgressRow.name} <span className="badge live-badge">live</span></span>
                      <span className="num">
                        {inProgressRow.wins}W / {inProgressRow.losses}L / {inProgressRow.draws}D
                        {t > 0 && ` (${Math.round((inProgressRow.wins / t) * 100)}%)`}
                      </span>
                    </li>
                  );
                })()}
                {[...runState.results].reverse().map((r) => {
                  const t = r.wins + r.losses + r.draws;
                  return (
                    <li key={r.refId}>
                      <span>{r.name}</span>
                      <span className="num">
                        {r.wins}W / {r.losses}L / {r.draws}D
                        {t > 0 && ` (${Math.round((r.wins / t) * 100)}%)`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {running && !p && !mp && <p className="muted">Starting worker…</p>}
          {runState.status === 'error' && (
            <div className="alert error">{runState.error}</div>
          )}
        </div>
      )}

      {cancelDialog && running && (
        <div className="modal-overlay" onClick={() => setCancelDialog(false)}>
          <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Cancel run?</h3>
              <button className="btn small ghost" onClick={() => setCancelDialog(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="muted">
                {hasPartialResults ? (
                  <>So far: <strong className="win-t">{liveTotals.wins}W</strong> /{' '}
                  <strong className="loss-t">{liveTotals.losses}L</strong> / {liveTotals.draws}D
                  across {runState.results.length + (inProgressBattles > 0 ? 1 : 0)} matchup
                  {runState.results.length + (inProgressBattles > 0 ? 1 : 0) === 1 ? '' : 's'}.</>
                ) : (
                  <>No battles have finished yet.</>
                )}{' '}
                Keep the results so far as a partial run, or discard them?
              </p>
              <div className="dialog-actions">
                <button
                  className="btn primary"
                  disabled={!hasPartialResults}
                  title={hasPartialResults ? 'Save the results so far to run history' : 'Nothing to keep yet'}
                  onClick={() => {
                    setCancelDialog(false);
                    onCancel('keep');
                  }}
                >
                  Keep results
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    setCancelDialog(false);
                    onCancel('discard');
                  }}
                >
                  Discard
                </button>
                <button className="btn ghost" onClick={() => setCancelDialog(false)}>
                  Keep running
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
