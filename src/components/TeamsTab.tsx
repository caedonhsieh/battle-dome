import {useState} from 'react';
import {validateTeamExport} from '../sim/bot';
import type {SavedTeam} from '../lib/types';
import {uid} from '../lib/types';
import SpriteStrip, {parseSets, speciesInitials} from './SpriteStrip';

interface Props {
  teams: SavedTeam[];
  onChange: (teams: SavedTeam[]) => void;
  selectedTeamId: string | null;
  onSelect: (id: string | null) => void;
}

export default function TeamsTab({teams, onChange, selectedTeamId, onSelect}: Props) {
  const [paste, setPaste] = useState('');
  const [name, setName] = useState('');
  const [validation, setValidation] = useState<{ok: boolean; problems: string[]} | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleSave = () => {
    const v = validateTeamExport(paste);
    setValidation({ok: v.ok, problems: v.problems});
    if (!v.ok) return;
    const team: SavedTeam = {
      id: uid(),
      name: name.trim() || `Team ${teams.length + 1}`,
      paste: paste.trim(),
      createdAt: Date.now(),
    };
    const next = [...teams, team];
    onChange(next);
    onSelect(team.id);
    setPaste('');
    setName('');
    setValidation(null);
  };

  const handleDelete = (id: string) => {
    onChange(teams.filter((t) => t.id !== id));
    if (selectedTeamId === id) onSelect(teams.find((t) => t.id !== id)?.id ?? null);
  };

  const handleRename = (id: string) => {
    const nextName = renameValue.trim();
    if (nextName) onChange(teams.map((t) => (t.id === id ? {...t, name: nextName} : t)));
    setRenamingId(null);
  };

  return (
    <div className="panel">
      <h2>Your Party</h2>
      <p className="muted">
        Paste a Pokémon Showdown team export. Teams are validated for the gen9 OU format and
        stored in your browser (localStorage) — nothing is uploaded.
      </p>

      <div className="card">
        <h3>Import team</h3>
        <label className="field">
          <span>Team name (optional)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`e.g. Rain Offense`}
            maxLength={60}
          />
        </label>
        <label className="field">
          <span>Showdown export</span>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'Gholdengo @ Choice Specs\nAbility: Good as Gold\nTera Type: Steel\nEVs: ...\n- Make It Rain\n...'}
            rows={10}
            spellCheck={false}
          />
        </label>
        {paste.trim() ? <SpriteStrip paste={paste} size={40} /> : null}
        {validation && !validation.ok && (
          <div className="alert error">
            <strong>Team didn't validate:</strong>
            <ul>{validation.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
        <button className="btn primary" onClick={handleSave} disabled={!paste.trim()}>
          Validate &amp; save team
        </button>
      </div>

      <h3>Saved parties ({teams.length})</h3>
      {teams.length === 0 && <p className="muted">No party yet — import one above.</p>}
      <div className="party-list">
        {teams.map((t) => {
          const sets = parseSets(t.paste).slice(0, 6);
          const [lead, ...rest] = sets;
          const active = selectedTeamId === t.id;
          return (
            <div key={t.id} className={`party-screen ${active ? 'active' : ''}`}>
              <div className="party-title-row">
                {renamingId === t.id ? (
                  <span className="inline-form">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      maxLength={60}
                      autoFocus
                    />
                    <button className="btn small" onClick={() => handleRename(t.id)}>Save</button>
                    <button className="btn small ghost" onClick={() => setRenamingId(null)}>Cancel</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="party-select"
                    onClick={() => onSelect(t.id)}
                    aria-pressed={active}
                    title="Choose this party for the next run"
                  >
                    <span className="party-cursor" aria-hidden="true">{active ? '▶' : '▷'}</span>
                    <span className="party-title">{t.name}</span>
                  </button>
                )}
                <div className="actions">
                  <button
                    className="btn small ghost"
                    onClick={() => {
                      setRenamingId(t.id);
                      setRenameValue(t.name);
                    }}
                  >
                    Rename
                  </button>
                  <button className="btn small danger" onClick={() => handleDelete(t.id)}>
                    Release
                  </button>
                </div>
              </div>
              <div className="party-body">
                {lead && (
                  <div className={`party-lead ${active ? 'active' : ''}`}>
                    {lead.iconCss ? (
                      <span className="mini-icon lead-sprite" style={lead.iconCss} aria-hidden="true" />
                    ) : (
                      <span className="sprite-fallback">{speciesInitials(lead.species)}</span>
                    )}
                    <div className="party-lead-name">{lead.species}</div>
                    <div className="party-lead-lv">Lv{lead.level}</div>
                    <div className="hp-bar" aria-hidden="true"><span className="hp-fill" /></div>
                  </div>
                )}
                <div className="party-bars">
                  {rest.map((s, i) => (
                    <div key={i} className="party-bar">
                      <span className="party-ball" aria-hidden="true">
                        {s.iconCss ? (
                          <span className="mini-icon" style={s.iconCss} />
                        ) : (
                          <span className="sprite-fallback">{speciesInitials(s.species)}</span>
                        )}
                      </span>
                      <span className="party-bar-main">
                        <span className="party-bar-name">{s.species}</span>
                        <span className="hp-bar small" aria-hidden="true"><span className="hp-fill" /></span>
                      </span>
                      <span className="party-bar-side">
                        <span className="party-bar-lv">Lv{s.level}</span>
                        {s.item && <span className="party-bar-item">@ {s.item}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="party-msgbox">Choose a party for the next run.</div>
              <div className="muted tiny party-foot">
                Saved {new Date(t.createdAt).toLocaleDateString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
