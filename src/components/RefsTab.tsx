import {useMemo, useState} from 'react';
import teamsData from '../data/reference-teams.json';
import {validateTeamExport} from '../sim/bot';
import type {BundledRef, CustomRef} from '../lib/types';
import {uid, SMOGON_THREAD_URL, REFERENCE_SET_LABEL} from '../lib/types';
import {parseSets, speciesInitials} from './SpriteStrip';

const BUNDLED: BundledRef[] = (teamsData as any).teams;
const ARCHETYPES = ['Offense', 'Bulky Offense', 'Balance', 'Stall'];

interface Props {
  selectedRefIds: string[];
  onSelectionChange: (ids: string[]) => void;
  customRefs: CustomRef[];
  onCustomRefsChange: (refs: CustomRef[]) => void;
}

export default function RefsTab({selectedRefIds, onSelectionChange, customRefs, onCustomRefsChange}: Props) {
  const [filter, setFilter] = useState<string>('All');
  const [paste, setPaste] = useState('');
  const [name, setName] = useState('');
  const [archetype, setArchetype] = useState('Balance');
  const [validation, setValidation] = useState<{ok: boolean; problems: string[]} | null>(null);

  const visible = useMemo(
    () => (filter === 'All' ? BUNDLED : BUNDLED.filter((t) => t.archetype === filter)),
    [filter],
  );

  const toggle = (id: string) => {
    onSelectionChange(
      selectedRefIds.includes(id)
        ? selectedRefIds.filter((x) => x !== id)
        : [...selectedRefIds, id],
    );
  };

  const toggleAllVisible = (select: boolean) => {
    const ids = visible.map((t) => t.id);
    onSelectionChange(
      select
        ? Array.from(new Set([...selectedRefIds, ...ids]))
        : selectedRefIds.filter((x) => !ids.includes(x)),
    );
  };

  const handleAddCustom = () => {
    const v = validateTeamExport(paste);
    setValidation({ok: v.ok, problems: v.problems});
    if (!v.ok) return;
    const ref: CustomRef = {
      id: 'custom-' + uid(),
      name: name.trim() || `Custom team ${customRefs.length + 1}`,
      archetype,
      paste: paste.trim(),
      createdAt: Date.now(),
    };
    onCustomRefsChange([...customRefs, ref]);
    onSelectionChange([...selectedRefIds, ref.id]);
    setPaste('');
    setName('');
    setValidation(null);
  };

  const handleDeleteCustom = (id: string) => {
    onCustomRefsChange(customRefs.filter((r) => r.id !== id));
    onSelectionChange(selectedRefIds.filter((x) => x !== id));
  };

  return (
    <div className="panel">
      <h2>Foe Preview</h2>
      <p className="muted">
        Bundled reference set: <strong>{REFERENCE_SET_LABEL}</strong> — 21 sample teams by Smogon
        players.{' '}
        <a href={SMOGON_THREAD_URL} target="_blank" rel="noreferrer">
          Smogon forum thread
        </a>
        . Select the teams your team will face, or add your own.
      </p>

      <div className="filter-row">
        {['All', ...ARCHETYPES].map((a) => (
          <button
            key={a}
            className={`btn small ${filter === a ? 'primary' : 'ghost'}`}
            onClick={() => setFilter(a)}
          >
            {a}
          </button>
        ))}
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => toggleAllVisible(true)}>
          Select shown
        </button>
        <button className="btn small ghost" onClick={() => toggleAllVisible(false)}>
          Deselect shown
        </button>
      </div>

      <div className="preview-list">
        {visible.map((t) => {
          const sets = parseSets(t.paste).slice(0, 6);
          const sel = selectedRefIds.includes(t.id);
          return (
            <label key={t.id} className={`preview-card ${sel ? 'selected' : ''}`}>
              <input
                type="checkbox"
                className="preview-check"
                checked={sel}
                onChange={() => toggle(t.id)}
              />
              <div className="preview-banner">
                <span className="preview-cursor" aria-hidden="true">{sel ? '▶' : '▷'}</span>
                <span className="preview-foe-name">{t.name}</span>
                <span className={`badge arch-${t.archetype.replace(/\s/g, '')}`}>{t.archetype}</span>
              </div>
              <div className="preview-row" aria-hidden="true">
                {sets.map((s, i) => (
                  <span key={i} className="preview-slot" title={s.species}>
                    {s.iconCss ? (
                      <span className="mini-icon" style={s.iconCss} />
                    ) : (
                      <span className="sprite-fallback">{speciesInitials(s.species)}</span>
                    )}
                  </span>
                ))}
              </div>
              <div className="muted tiny preview-sub">
                by {t.author} ·{' '}
                <a href={t.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  pokepaste
                </a>
              </div>
            </label>
          );
        })}
      </div>

      <h3>Custom reference teams ({customRefs.length})</h3>
      <div className="card">
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Friend's sun team" />
          </label>
          <label className="field">
            <span>Archetype</span>
            <select value={archetype} onChange={(e) => setArchetype(e.target.value)}>
              {ARCHETYPES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Showdown export</span>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={8} spellCheck={false} />
        </label>
        {validation && !validation.ok && (
          <div className="alert error">
            <strong>Team didn't validate:</strong>
            <ul>{validation.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
        <button className="btn primary" onClick={handleAddCustom} disabled={!paste.trim()}>
          Validate &amp; add reference
        </button>
      </div>
      <div className="preview-list">
        {customRefs.map((r) => {
          const sets = parseSets(r.paste).slice(0, 6);
          const sel = selectedRefIds.includes(r.id);
          return (
            <label key={r.id} className={`preview-card ${sel ? 'selected' : ''}`}>
              <input
                type="checkbox"
                className="preview-check"
                checked={sel}
                onChange={() => toggle(r.id)}
              />
              <div className="preview-banner">
                <span className="preview-cursor" aria-hidden="true">{sel ? '▶' : '▷'}</span>
                <span className="preview-foe-name">{r.name}</span>
                <span className={`badge arch-${r.archetype.replace(/\s/g, '')}`}>{r.archetype}</span>
                <span className="badge">custom</span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn small danger"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeleteCustom(r.id);
                  }}
                >
                  Delete
                </button>
              </div>
              <div className="preview-row" aria-hidden="true">
                {sets.map((s, i) => (
                  <span key={i} className="preview-slot" title={s.species}>
                    {s.iconCss ? (
                      <span className="mini-icon" style={s.iconCss} />
                    ) : (
                      <span className="sprite-fallback">{speciesInitials(s.species)}</span>
                    )}
                  </span>
                ))}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
