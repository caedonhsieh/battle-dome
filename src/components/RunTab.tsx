import {useEffect, useState} from 'react';
import type {RunConfig, SavedTeam} from '../lib/types';
import {randomSeed} from '../lib/types';
import {clampBattlesPerMatchup, fmtElapsed, summarize} from '../lib/run';
import {clampWorkerCount} from '../sim/client';
import type {RunState} from '../lib/useBenchmarkRun';
import type {RefTeam} from '../sim/client';
import SpriteStrip from './SpriteStrip';
import ScoreLine from './ScoreLine';

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
  const pool = runState.pool;
  const mp = runState.modelProgress;
  const workerCount = clampWorkerCount(config.workerCount ?? 2);
  const totalBattles = selectedRefs.length * clampBattlesPerMatchup(config.battlesPerMatchup);
  const doneBattles = pool ? pool.battlesDone : 0;
  const pct = totalBattles > 0 ? Math.min(100, (doneBattles / totalBattles) * 100) : 0;
  const canStart = !running && selectedTeamId && selectedRefs.length > 0;
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  // Tick once a second while running so the elapsed timer stays fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Matchup rows update incrementally as battles land (possibly out of order
  // across workers). Rows with finished battles are shown; rows still in
  // flight get the live badge. No single "current matchup" is faked.
  const battlesPerMatchup = clampBattlesPerMatchup(config.battlesPerMatchup);
  const liveRows = runState.results.filter((r) => (r.battles?.length ?? 0) > 0);
  const liveTotals = summarize(runState.results);
  const hasPartialResults = liveRows.length > 0;
  const [cancelDialog, setCancelDialog] = useState(false);
  let elapsedText = '';
  if (running && runState.startedAt) {
    elapsedText = fmtElapsed((now - runState.startedAt) / 1000);
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
          <details className="advanced-settings">
            <summary>Advanced settings</summary>
            <label className="field">
              <span>Workers (1–8)</span>
              <input
                type="number"
                min={1}
                max={8}
                value={workerCount}
                onChange={(e) => onConfigChange({...config, workerCount: Number(e.target.value)})}
                disabled={running}
                title="Parallel battles — each worker loads its own model session"
              />
            </label>
          </details>
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
                    ? `Model loaded from cache on ${workerCount} worker${workerCount === 1 ? '' : 's'}…`
                    : `Loading model on ${workerCount} worker${workerCount === 1 ? '' : 's'}…`}
              </p>
            </>
          )}
          {running && pool && !mp && (
            <>
              <div className="progress">
                <div className="progress-bar" style={{width: `${pct}%`}} />
              </div>
              <p className="muted">
                {doneBattles}/{totalBattles} battles · {workerCount} worker{workerCount === 1 ? '' : 's'}
                {elapsedText && <> · {elapsedText}</>}
              </p>
            </>
          )}
          {running && pool && !mp && liveRows.length > 0 && (
            <div className="live-results">
              <p className="muted tiny">
                Running total:{' '}
                <ScoreLine wins={liveTotals.wins} losses={liveTotals.losses} draws={liveTotals.draws} />
              </p>
              <ul className="mini-list">
                {[...liveRows].reverse().map((r) => {
                  const done = r.battles?.length ?? 0;
                  const live = done < battlesPerMatchup;
                  return (
                    <li key={r.refId} className={live ? 'live-row' : undefined}>
                      <span>{r.name} {live && <span className="badge live-badge">live</span>}</span>
                      <span className="num">
                        <ScoreLine wins={r.wins} losses={r.losses} draws={r.draws} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {running && !pool && !mp && <p className="muted">Starting workers…</p>}
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
                  <>So far: <ScoreLine wins={liveTotals.wins} losses={liveTotals.losses} draws={liveTotals.draws} />{' '}
                  across {liveRows.length} matchup{liveRows.length === 1 ? '' : 's'}.</>
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
