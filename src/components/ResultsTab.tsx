import {Fragment, useMemo, useState} from 'react';
import type {MatchupResult, ReplayRequest, ReplayResult} from '../sim/client';
import type {RunMeta, RunRecord} from '../lib/types';
import {METAMON_ENGINE, fmtElapsed, summarize, winRate} from '../lib/run';
import {downloadText, slugify} from '../lib/download';
import SpriteStrip from './SpriteStrip';
import ScoreLine from './ScoreLine';
import {formatReplayLog, type ReplayLine} from './replayFormat';
import {buildReplayHtml} from './replayHtml';

interface ViewData {
  meta: RunMeta;
  refs: {id: string; name: string; archetype: string}[];
  results: MatchupResult[];
}

interface Props {
  current: ViewData | null;
  history: RunRecord[];
  onHistoryChange: (h: RunRecord[]) => void;
  onViewRecord: (r: RunRecord) => void;
  /** paste lookup for reference-team sprite strips (undefined = no strip) */
  getRefPaste: (refId: string) => string | undefined;
  /** fallback lookup of the user's team paste by team name (for old runs) */
  getUserPaste: (teamName: string) => string | undefined;
  /** re-simulate one battle of a matchup; resolves with its protocol log */
  requestReplay: (req: ReplayRequest) => Promise<ReplayResult>;
  /** true while a benchmark run is active (replay shares the worker) */
  runActive: boolean;
}

type SortKey = 'winrate' | 'name' | 'wins';

export default function ResultsTab({current, history, onHistoryChange, onViewRecord, getRefPaste, getUserPaste, requestReplay, runActive}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('winrate');
  const [sortDesc, setSortDesc] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [replayTitle, setReplayTitle] = useState<string | null>(null);
  const [replayMatchup, setReplayMatchup] = useState<MatchupResult | null>(null);
  const [replayLines, setReplayLines] = useState<ReplayLine[] | null>(null);
  const [replayRawLog, setReplayRawLog] = useState<string[] | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayCopied, setReplayCopied] = useState(false);
  const [expandedRefId, setExpandedRefId] = useState<string | null>(null);

  const closeReplay = () => {
    setReplayTitle(null);
    setReplayMatchup(null);
    setReplayLines(null);
    setReplayRawLog(null);
    setReplayError(null);
    setReplayLoading(false);
    setReplayCopied(false);
  };

  /**
   * Re-simulate one battle of a matchup (deterministic: identical to the
   * run's battle at that index, since the seed mixes in the battle index).
   */
  const runReplay = async (r: MatchupResult, battleIndex: number) => {
    if (!current || runActive || replayLoading) return;
    const matchupIndex = r.matchupIndex ?? current.results.indexOf(r);
    const userPaste = current.meta.userPaste ?? getUserPaste(current.meta.teamName);
    const refPaste = getRefPaste(r.refId);
    if (!userPaste || !refPaste || matchupIndex < 0) return;
    setReplayMatchup(r);
    setReplayTitle(`${current.meta.teamName} vs ${r.name} — battle ${battleIndex + 1} replay`);
    setReplayLines(null);
    setReplayRawLog(null);
    setReplayError(null);
    setReplayLoading(true);
    try {
      const res = await requestReplay({
        userPaste,
        refPaste,
        seed: current.meta.seed,
        matchupIndex,
        battleIndex,
        p1Name: current.meta.teamName,
        p2Name: r.name,
      });
      setReplayRawLog(res.log);
      setReplayLines(formatReplayLog(res.log, current.meta.teamName, r.name));
    } catch (err: any) {
      setReplayError(String(err?.message || err));
    } finally {
      setReplayLoading(false);
    }
  };

  const openReplay = (r: MatchupResult) => {
    void runReplay(r, 0);
  };

  /** Copy the raw standard-format battle log for use with replay converters. */
  const copyReplayLog = async () => {
    if (!replayRawLog) return;
    try {
      await navigator.clipboard.writeText(replayRawLog.join('\n'));
      setReplayCopied(true);
      window.setTimeout(() => setReplayCopied(false), 1500);
    } catch {
      setReplayError('Could not copy the log to the clipboard.');
    }
  };

  /** Download the raw standard-format battle log as a .log file. */
  const downloadReplayLog = () => {
    if (!replayRawLog || !replayTitle) return;
    const slug = slugify(replayTitle);
    downloadText(replayRawLog.join('\n') + '\n', `battle-dome-${slug || 'replay'}.log`, 'text/plain');
  };

  const downloadReplayHtml = () => {
    if (!replayRawLog || !replayTitle || !replayMatchup || !current) return;
    const html = buildReplayHtml(replayRawLog, current.meta.teamName, replayMatchup.name);
    const slug = slugify(replayTitle);
    downloadText(html, `battle-dome-${slug || 'replay'}.html`, 'text/html');
  };

  const canReplay = (r: MatchupResult) =>
    !runActive &&
    current?.meta.engine === METAMON_ENGINE &&
    (current.meta.userPaste ?? getUserPaste(current.meta.teamName)) != null &&
    getRefPaste(r.refId) != null;

  const sorted = useMemo(() => {
    if (!current) return [];
    const arr = [...current.results];
    const dir = sortDesc ? -1 : 1;
    arr.sort((a, b) => {
      if (sortKey === 'winrate') return (winRate(a) - winRate(b)) * dir;
      if (sortKey === 'wins') return (a.wins - b.wins) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
    return arr;
  }, [current, sortKey, sortDesc]);

  const byArchetype = useMemo(() => {
    const map = new Map<string, MatchupResult[]>();
    for (const r of sorted) {
      const list = map.get(r.archetype) ?? [];
      list.push(r);
      map.set(r.archetype, list);
    }
    return [...map.entries()];
  }, [sorted]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else {
      setSortKey(key);
      setSortDesc(key !== 'name');
    }
  };

  const handleDelete = (id: string) => {
    onHistoryChange(history.filter((h) => h.id !== id));
  };

  const handleRename = (id: string) => {
    const v = renameValue.trim();
    if (v) onHistoryChange(history.map((h) => (h.id === id ? {...h, name: v} : h)));
    setRenamingId(null);
  };

  const totals = current ? summarize(current.results) : null;
  const totalGames = totals ? totals.wins + totals.losses + totals.draws : 0;

  return (
    <div className="panel">
      <h2>Results</h2>

      {!current && (
        <p className="muted">
          No results yet. Pick a team and reference teams, then start a run on the{' '}
          <strong>RUN</strong> tab.
        </p>
      )}

      {current && totals && (
        <>
          <div className="card">
            <h3>
              {current.meta.teamName}{' '}
              <span className="badge">
                {current.meta.engine === METAMON_ENGINE
                  ? `Metamon${current.meta.provider ? ` · ${current.meta.provider === 'webgpu' ? 'WebGPU' : 'WASM'}` : ''}`
                  : 'Heuristic'}
              </span>{' '}
              {current.meta.partial && <span className="badge partial-badge">Partial</span>}{' '}
              <span className="muted tiny">
                · {current.meta.battlesPerMatchup} battles/matchup · seed “{current.meta.seed}” ·{' '}
                {new Date(current.meta.date).toLocaleString()}
                {current.meta.durationMs != null && <> · {fmtElapsed(current.meta.durationMs / 1000)}</>}
              </span>
            </h3>
            <div className="stat-row">
              <div className="stat win"><span className="num">{totals.wins}</span><span className="lbl">Wins</span></div>
              <div className="stat loss"><span className="num">{totals.losses}</span><span className="lbl">Losses</span></div>
              <div className="stat"><span className="num">{totals.draws}</span><span className="lbl">Draws</span></div>
              <div className="stat"><span className="num">{totalGames ? Math.round((totals.wins / totalGames) * 100) : 0}%</span><span className="lbl">Win rate</span></div>
            </div>
          </div>

          <div className="card">
            <table className="results-table">
              <thead>
                <tr>
                  <th>
                    <button className="th-btn" onClick={() => toggleSort('name')}>
                      Matchup {sortKey === 'name' ? (sortDesc ? '▼' : '▲') : ''}
                    </button>
                  </th>
                  <th>Archetype</th>
                  <th>
                    <button className="th-btn" onClick={() => toggleSort('wins')}>
                      W {sortKey === 'wins' ? (sortDesc ? '▼' : '▲') : ''}
                    </button>
                  </th>
                  <th>L</th>
                  <th>D</th>
                  <th>
                    <button className="th-btn" onClick={() => toggleSort('winrate')}>
                      Win % {sortKey === 'winrate' ? (sortDesc ? '▼' : '▲') : ''}
                    </button>
                  </th>
                  <th><span className="muted tiny">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {byArchetype.map(([arch, rows]) => {
                  const sub = summarize(rows);
                  return (
                    <Fragment key={arch}>
                      <tr className="group-row">
                        <td colSpan={7}>
                          {arch} — <ScoreLine wins={sub.wins} losses={sub.losses} draws={sub.draws} />
                        </td>
                      </tr>
                      {rows.map((r) => {
                        const t = r.wins + r.losses + r.draws;
                        const paste = getRefPaste(r.refId);
                        const hasBattleScores = canReplay(r) && (r.battles?.length ?? 0) > 0;
                        const expanded = expandedRefId === r.refId;
                        return (
                          <Fragment key={r.refId}>
                          <tr>
                            <td>
                              {r.name}
                              {paste && <SpriteStrip paste={paste} size={32} />}
                            </td>
                            <td><span className={`badge arch-${r.archetype.replace(/\s/g, '')}`}>{r.archetype}</span></td>
                            <td className="num win-t">{r.wins}</td>
                            <td className="num loss-t">{r.losses}</td>
                            <td className="num">{r.draws}</td>
                            <td className="num">{t ? Math.round((r.wins / t) * 100) : 0}%</td>
                            <td className="num">
                              {hasBattleScores ? (
                                <button
                                  className="btn small ghost"
                                  onClick={() => setExpandedRefId(expanded ? null : r.refId)}
                                  title="Expand to see each battle's score"
                                >
                                  {expanded ? '▾ Details' : '▸ Details'}
                                </button>
                              ) : canReplay(r) ? (
                                <button
                                  className="btn small ghost"
                                  onClick={() => void openReplay(r)}
                                  title="Re-simulate one battle of this matchup and show the log"
                                >
                                  ▶ Replay
                                </button>
                              ) : null}
                            </td>
                          </tr>
                          {expanded && r.battles && (
                            <tr className="battle-detail-row">
                              <td colSpan={7}>
                                <div className="battle-detail-list">
                                  <div className="muted tiny battle-detail-note">
                                    Remaining mons shown as your team – theirs.
                                  </div>
                                  {r.battles.map((b, i) => {
                                    const outcome =
                                      b.winner === 'p1' ? {cls: 'win-t', label: 'W', name: current.meta.teamName}
                                      : b.winner === 'p2' ? {cls: 'loss-t', label: 'L', name: r.name}
                                      : {cls: '', label: 'D', name: 'Draw'};
                                    return (
                                      <div key={i} className="battle-detail">
                                        <span className="muted tiny battle-num">#{i + 1}</span>
                                        <span className={`badge ${outcome.cls}`}>{outcome.label}</span>
                                        <span className="battle-winner">{outcome.name}</span>
                                        <span className="muted tiny">{b.turns} turns</span>
                                        <span className="muted tiny">{b.p1Left}–{b.p2Left} left</span>
                                        <button
                                          className="btn small ghost"
                                          onClick={() => void runReplay(r, i)}
                                          title={`Generate the battle log for battle #${i + 1}`}
                                        >
                                          ≣ Log
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3>Run history ({history.length})</h3>
      <p className="muted tiny">Saved in your browser. Rename, revisit, or delete past runs.</p>
      {history.length === 0 && <p className="muted">No saved runs yet — completed runs are saved here automatically.</p>}
      <div className="list">
        {history.map((h) => {
          const t = summarize(h.results);
          return (
            <div key={h.id} className="card row">
              <div className="grow">
                {renamingId === h.id ? (
                  <span className="inline-form">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      maxLength={80}
                      autoFocus
                    />
                    <button className="btn small" onClick={() => handleRename(h.id)}>Save</button>
                    <button className="btn small ghost" onClick={() => setRenamingId(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <strong>{h.name}</strong>{' '}
                    {h.meta.partial && <span className="badge partial-badge">Partial</span>}
                  </>
                )}
                <div className="muted tiny">
                  {h.meta.teamName} · {new Date(h.date).toLocaleString()} ·{' '}
                  <ScoreLine wins={t.wins} losses={t.losses} draws={t.draws} /> ·{' '}
                  {h.meta.battlesPerMatchup}/matchup · seed “{h.meta.seed}” ·{' '}
                  {h.meta.engine === METAMON_ENGINE
                    ? `Metamon${h.meta.provider ? ` · ${h.meta.provider === 'webgpu' ? 'WebGPU' : 'WASM'}` : ''}`
                    : 'heuristic'}
                </div>
              </div>
              <div className="actions">
                <button className="btn small ghost" onClick={() => onViewRecord(h)}>View</button>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    setRenamingId(h.id);
                    setRenameValue(h.name);
                  }}
                >
                  Rename
                </button>
                <button className="btn small danger" onClick={() => handleDelete(h.id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {replayTitle && (
        <div className="modal-overlay" onClick={closeReplay}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{replayTitle}</h3>
              <div className="modal-head-actions">
                {replayRawLog && !replayLoading && (
                  <>
                    <button className="btn small ghost" onClick={() => void copyReplayLog()}>
                      {replayCopied ? '✓ Copied' : '⧉ Copy log'}
                    </button>
                    <button className="btn small ghost" onClick={downloadReplayLog}>⬇ .log</button>
                    <button
                      className="btn small ghost"
                      onClick={downloadReplayHtml}
                      title="Download an animated replay page (rendered by Showdown's client)"
                    >
                      ⬇ .html
                    </button>
                  </>
                )}
                <button className="btn small ghost" onClick={closeReplay}>✕ Close</button>
              </div>
            </div>
            <div className="modal-body">
              {replayRawLog && !replayLoading && (
                <p className="muted tiny" style={{margin: '0 0 8px'}}>
                  Standard Showdown battle log — copy or download the .log for replay
                  converters, or grab the .html for an animated replay page.
                </p>
              )}
              {replayLoading && (
                <div className="replay-loading">
                  <p className="muted">Re-simulating the battle…</p>
                </div>
              )}
              {replayError && <div className="alert error">{replayError}</div>}
              {replayLines && replayLines.map((l, i) => (
                <div key={i} className={
                  l.kind === 'turn' ? 'replay-turn'
                  : l.kind === 'result' ? 'replay-result'
                  : l.kind === 'info' ? 'replay-info'
                  : 'replay-event'
                }>{l.text}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
