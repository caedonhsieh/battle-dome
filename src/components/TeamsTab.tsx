import {useState} from 'react';
import {validateTeamExport, teamSpecies} from '../sim/bot';
import type {SavedTeam} from '../lib/types';
import {uid} from '../lib/types';

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

  const previewSpecies = paste.trim() ? teamSpecies(paste) : [];

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
      <h2>My Teams</h2>
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
        {previewSpecies.length > 0 && (
          <div className="species-chips">
            {previewSpecies.map((s) => (
              <span key={s} className="chip">{s}</span>
            ))}
          </div>
        )}
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

      <h3>Saved teams ({teams.length})</h3>
      {teams.length === 0 && <p className="muted">No teams yet — import one above.</p>}
      <div className="list">
        {teams.map((t) => (
          <div key={t.id} className={`card row ${selectedTeamId === t.id ? 'selected' : ''}`}>
            <label className="radio-label">
              <input
                type="radio"
                name="active-team"
                checked={selectedTeamId === t.id}
                onChange={() => onSelect(t.id)}
              />
            </label>
            <div className="grow">
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
                <strong>{t.name}</strong>
              )}
              <div className="species-chips small">
                {teamSpecies(t.paste).map((s) => (
                  <span key={s} className="chip">{s}</span>
                ))}
              </div>
              <div className="muted tiny">
                Saved {new Date(t.createdAt).toLocaleDateString()}
              </div>
            </div>
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
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
