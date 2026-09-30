import {useMemo, useState, type CSSProperties} from 'react';
import {Teams} from '@pkmn/sim';
import {Icons} from '@pkmn/img';

export interface SetSummary {
  species: string;
  item: string;
  ability: string;
  nature: string;
  evs: string;
  teraType: string;
  moves: string[];
  /** sprite-sheet CSS for the 40x30 pixel-art menu icon, or null for the initials fallback */
  iconCss: CSSProperties | null;
}

const STAT_NAMES: [string, string][] = [
  ['hp', 'HP'],
  ['atk', 'Atk'],
  ['def', 'Def'],
  ['spa', 'SpA'],
  ['spd', 'SpD'],
  ['spe', 'Spe'],
];

function formatEvs(evs: any): string {
  if (!evs) return '';
  const parts: string[] = [];
  for (const [k, label] of STAT_NAMES) {
    const v = Number(evs[k]) || 0;
    if (v > 0) parts.push(`${v} ${label}`);
  }
  return parts.join(' / ');
}

export function parseSets(paste: string): SetSummary[] {
  let team: any[];
  try {
    team = Teams.import(paste.trim()) || [];
  } catch {
    return [];
  }
  return team.map((set) => {
    let iconCss: CSSProperties | null = null;
    try {
      iconCss = Icons.getPokemon(set.species).css as CSSProperties;
    } catch {
      /* fall through to initials fallback */
    }
    return {
      species: set.species || '?',
      item: set.item || '',
      ability: set.ability || '',
      nature: set.nature || '',
      evs: formatEvs(set.evs),
      teraType: set.teraType || (set as any).tera_type || '',
      moves: (set.moves || []).filter(Boolean),
      iconCss,
    };
  });
}

function initials(species: string): string {
  const parts = species.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return (parts.map((w) => w[0]).join('').slice(0, 3) || '?').toUpperCase();
}

interface Props {
  paste: string;
  /** minimum sprite button size in px (icons render at native 40x30) */
  size?: number;
}

export default function SpriteStrip({paste, size = 40}: Props) {
  const sets = useMemo(() => parseSets(paste), [paste]);
  const [open, setOpen] = useState<number | null>(null);

  if (sets.length === 0) return null;

  return (
    <div className="sprite-strip">
      {sets.map((s, i) => {
        const edge = i === 0 ? 'tip-edge-l' : i === sets.length - 1 ? 'tip-edge-r' : '';
        return (
          <div
            key={i}
            className={`sprite-wrap ${open === i ? 'open' : ''}`}
            onMouseEnter={() => setOpen(i)}
            onMouseLeave={() => setOpen(null)}
          >
            <button
              type="button"
              className="sprite-btn"
              style={{minWidth: size, minHeight: 34}}
              onClick={() => setOpen(open === i ? null : i)}
              onFocus={() => setOpen(i)}
              onBlur={() => setOpen(null)}
              aria-label={s.species}
              title={s.species}
            >
              {s.iconCss ? (
                <span className="mini-icon" style={s.iconCss} aria-hidden="true" />
              ) : (
                <span className="sprite-fallback">{initials(s.species)}</span>
              )}
            </button>
            {open === i && (
              <div className={`set-tip ${edge}`} role="tooltip">
                <div className="set-tip-head">
                  <strong>{s.species}</strong>
                  {s.teraType && (
                    <span className={`tera-badge tera-${s.teraType.toLowerCase()}`}>
                      Tera {s.teraType}
                    </span>
                  )}
                </div>
                {s.item && <div className="set-tip-row">@ {s.item}</div>}
                {(s.ability || s.nature) && (
                  <div className="set-tip-row muted">
                    {[s.ability, s.nature ? `${s.nature} Nature` : ''].filter(Boolean).join(' · ')}
                  </div>
                )}
                {s.evs && <div className="set-tip-row tiny">EVs: {s.evs}</div>}
                {s.moves.length > 0 && (
                  <ul className="set-tip-moves">
                    {s.moves.map((m, j) => (
                      <li key={j}>- {m}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
