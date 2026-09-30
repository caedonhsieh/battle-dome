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
  /** the user's currently selected party (shown as the player side of the VS banner) */
  userTeamName?: string | null;
  userPaste?: string | null;
}

export default function RefsTab({selectedRefIds, onSelectionChange, customRefs, onCustomRefsChange, userTeamName, userPaste}: Props) {
  const [filter, setFilter] = useState<string>('All');
  const [paste, setPaste] = useState('');
  const [name, setName] = useState('');
  const [archetype, setArchetype] = useState('Balance');
  const [validation, setValidation] = useState<{ok: boolean; problems: string[]} | null>(null);

  const visible = useMemo(
    () => (filter === 'All' ? BUNDLED : BUNDLED.filter((t) => t.archetype === filter)),
    [filter],
  );

  const userSets = useMemo(
    () => (userPaste ? parseSets(userPaste).slice(0, 6) : []),
    [userPaste],
  );

  function foeCard(
    id: string,
    name: string,
    archetype: string,
    paste: string,
    sub: React.ReactNode,
    extraActions?: React.ReactNode,
  ) {
    const sets = parseSets(paste).slice(0, 6);
    const sel = selectedRefIds.includes(id);
    return (
      <label key={id} className={`foe-box ${sel ? 'selected' : ''}`}>
        <input
          type="checkbox"
          className="preview-check"
          checked={sel}
          onChange={() => toggle(id)}
        />
        <span className="foe-cursor" aria-hidden="true">{sel ? '▶' : '▷'}</span>
        <span className="foe-main">
          <span className="foe-name-row">
            <span className="foe-name">{name}</span>
            <span className={`badge arch-${archetype.replace(/\s/g, '')}`}>{archetype}</span>
            {extraActions}
          </span>
          <span className="foe-sub">{sub}</span>
          <span className="foe-sprites" aria-hidden="true">
            {sets.map((s, i) => (
              <span key={i} className="foe-slot" title={s.species}>
                {s.iconCss ? (
                  <span className="mini-icon" style={s.iconCss} />
                ) : (
                  <span className="sprite-fallback">{speciesInitials(s.species)}</span>
                )}
              </span>
            ))}
          </span>
          <span className="hp-bar target-meter" aria-hidden="true">
            <span className="hp-fill" style={{width: sel ? '100%' : '0%'}} />
          </span>
        </span>
      </label>
    );
  }

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

      <div className="vs-banner" aria-label="Matchup preview">
        <div className="healthbox enemy">
          <div className="hb-name">{selectedRefIds.length} FOE{selectedRefIds.length === 1 ? '' : 'S'}</div>
          <div className="hb-sub">selected for battle</div>
        </div>
        <div className="vs-burst">VS</div>
        <div className="healthbox player">
          <div className="hb-name">{userTeamName || 'NO PARTY'}</div>
          <div className="hb-sub">
            {userSets.length > 0 ? `${userSets.length} Pokémon` : 'pick a party first'}
          </div>
        </div>
      </div>

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

      <div className="foe-list">
        {visible.map((t) =>
          foeCard(
            t.id,
            t.name,
            t.archetype,
            t.paste,
            <>
              by {t.author} ·{' '}
              <a href={t.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                pokepaste
              </a>
            </>,
          ),
        )}
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
      <div className="foe-list">
        {customRefs.map((r) =>
          foeCard(
            r.id,
            r.name,
            r.archetype,
            r.paste,
            <>custom team · saved {new Date(r.createdAt).toLocaleDateString()}</>,
            <>
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
            </>,
          ),
        )}
      </div>
    </div>
  );
}
