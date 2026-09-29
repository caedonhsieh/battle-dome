import {Fragment, useMemo, useState} from 'react';
import type {MatchupResult} from '../sim/client';
import type {RunMeta, RunRecord} from '../lib/types';
import {summarize} from './RunTab';

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
}

type SortKey = 'winrate' | 'name' | 'wins';

function winRate(r: MatchupResult): number {
  const total = r.wins + r.losses + r.draws;
  return total === 0 ? 0 : r.wins / total;
}

export default function ResultsTab({current, history, onHistoryChange, onViewRecord}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('winrate');
  const [sortDesc, setSortDesc] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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
          <strong>Run</strong> tab.
        </p>
      )}

      {current && totals && (
        <>
          <div className="card">
            <h3>
              {current.meta.teamName}{' '}
              <span className="muted tiny">
                · {current.meta.battlesPerMatchup} battles/matchup · seed “{current.meta.seed}” ·{' '}
                {new Date(current.meta.date).toLocaleString()}
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
                </tr>
              </thead>
              <tbody>
                {byArchetype.map(([arch, rows]) => {
                  const sub = summarize(rows);
                  const subTotal = sub.wins + sub.losses + sub.draws;
                  return (
                    <Fragment key={arch}>
                      <tr className="group-row">
                        <td colSpan={6}>
                          {arch} — {sub.wins}W / {sub.losses}L / {sub.draws}D
                          {subTotal > 0 && ` (${Math.round((sub.wins / subTotal) * 100)}%)`}
                        </td>
                      </tr>
                      {rows.map((r) => {
                        const t = r.wins + r.losses + r.draws;
                        return (
                          <tr key={r.refId}>
                            <td>{r.name}</td>
                            <td><span className={`badge arch-${r.archetype.replace(/\s/g, '')}`}>{r.archetype}</span></td>
                            <td className="num win-t">{r.wins}</td>
                            <td className="num loss-t">{r.losses}</td>
                            <td className="num">{r.draws}</td>
                            <td className="num">{t ? Math.round((r.wins / t) * 100) : 0}%</td>
                          </tr>
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
          const total = t.wins + t.losses + t.draws;
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
                  <strong>{h.name}</strong>
                )}
                <div className="muted tiny">
                  {h.meta.teamName} · {new Date(h.date).toLocaleString()} ·{' '}
                  {t.wins}W / {t.losses}L / {t.draws}D
                  {total > 0 && ` (${Math.round((t.wins / total) * 100)}%)`} ·{' '}
                  {h.meta.battlesPerMatchup}/matchup · seed “{h.meta.seed}”
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
    </div>
  );
}
