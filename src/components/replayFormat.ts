/**
 * Turn raw @pkmn/sim protocol lines into human-readable replay lines.
 * Only the public broadcast log is formatted (no hidden side info exists in it).
 */

export interface ReplayLine {
  text: string;
  kind: 'turn' | 'event' | 'info' | 'result';
}

const STAT_NAMES: Record<string, string> = {
  atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed',
  accuracy: 'accuracy', evasion: 'evasiveness',
};

const STATUS_NAMES: Record<string, string> = {
  brn: 'burned', par: 'paralyzed', slp: 'fell asleep', frz: 'was frozen',
  psn: 'was poisoned', tox: 'was badly poisoned',
};

const HAZARD_NAMES: Record<string, string> = {
  'Stealth Rock': 'Pointed stones float in the air',
  Spikes: 'Spikes were scattered',
  'Toxic Spikes': 'Poison spikes were scattered',
  'Sticky Web': 'A sticky web spreads out',
  Reflect: 'Reflect raised its Defense',
  'Light Screen': 'Light Screen raised its Sp. Def',
  'Aurora Veil': 'Aurora Veil protects the team',
  Tailwind: 'A tailwind doubles the team\u2019s Speed',
};

/** "p1a: Nickname" -> {side: 'p1', nick: 'Nickname'} */
function parseSlot(field: string): {side: 'p1' | 'p2'; nick: string} | null {
  const m = /^(p[12])a?:\s*([^|]*)$/.exec(field.trim());
  if (!m) return null;
  return {side: m[1] as 'p1' | 'p2', nick: m[2].trim()};
}

/** Parse "420/420", "64/100", or "0 fnt" into an HP fraction (0..1). */
function parseHPFrac(s: string): number | null {
  const t = (s || '').trim();
  if (/^0\s*fnt/i.test(t)) return 0;
  const m = /^(\d+)\s*\/\s*(\d+)/.exec(t);
  if (!m || Number(m[2]) === 0) return null;
  return Math.max(0, Math.min(1, Number(m[1]) / Number(m[2])));
}

/** Extract the "[from] X" source tag from a protocol line's trailing parts. */
function fromSource(parts: string[]): string | null {
  for (let i = 3; i < parts.length; i++) {
    const m = /^\[from\]\s*(.+?)\s*$/.exec(parts[i]);
    if (m) return m[1];
  }
  return null;
}

/**
 * Human line for residual/hazard/recoil damage sources.
 * Returns null when the generic HP-delta line should be used instead.
 */
function residualLine(label: string, from: string): string | null {
  const f = from.toLowerCase();
  if (f === 'psn' || f === 'tox' || f === 'poison') return `${label} was hurt by poison!`;
  if (f === 'brn' || f === 'burn') return `${label} was hurt by its burn!`;
  if (f === 'sandstorm') return `${label} was buffeted by the sandstorm!`;
  if (f === 'hail' || f === 'snow') return `${label} was buffeted by the hail!`;
  if (f === 'stealth rock') return `${label} was hurt by Stealth Rock!`;
  if (f === 'spikes') return `${label} was hurt by Spikes!`;
  if (f === 'recoil') return `${label} was hurt by recoil!`;
  if (f === 'confusion') return null; // already narrated by the -activate line
  if (f === 'leech seed' || f === 'move: leech seed') return `${label}'s health was sapped by Leech Seed!`;
  const ab = /^ability:\s*(.+)$/i.exec(from);
  if (ab) return `${label} was hurt by ${ab[1]}!`;
  const it = /^item:\s*(.+)$/i.exec(from);
  if (it) return `${label} was hurt by its ${it[1]}!`;
  return null;
}

const SKIP = new Set([
  'init', 'title', 'j', 'player', 'gametype', 'gen', 'tier', 'rated', 'rule',
  'clearpoke', 'poke', 'teamsize', 'start', 'upkeep', 'inactive', 'html',
  'teampreview', 'done', 't:',
]);

/**
 * Resolve |split| blocks (marker + one line per side) to a single canonical
 * line and drop exact-duplicate consecutive lines, so the replay reads as one
 * coherent public log.
 */
function canonicalLines(log: string[]): string[] {
  const out: string[] = [];
  let prev = '';
  for (let i = 0; i < log.length; i++) {
    const raw = log[i];
    if (!raw || raw[0] !== '|') continue;
    if (raw === prev) continue;
    prev = raw;
    const cmd = raw.slice(1).split('|', 1)[0];
    if (cmd === 'split') {
      // marker line, then one line per side — keep the first side's view.
      const line = log[i + 1] ?? '';
      i += 2;
      if (line && line !== prev) {
        prev = line;
        out.push(line);
      }
      continue;
    }
    out.push(raw);
  }
  return out;
}

export function formatReplayLog(log: string[], p1Name: string, p2Name: string): ReplayLine[] {
  const out: ReplayLine[] = [];
  const who = (field: string): string => {
    const s = parseSlot(field);
    if (!s) return field;
    const team = s.side === 'p1' ? p1Name : p2Name;
    return `${team}\u2019s ${s.nick}`;
  };
  const info = (text: string) => out.push({text, kind: 'info'});
  const event = (text: string) => out.push({text, kind: 'event'});
  /** Last known HP fraction per side, so damage lines can report deltas. */
  const hp = new Map<string, number>();

  for (const raw of canonicalLines(log)) {
    const parts = raw.slice(1).split('|');
    const cmd = parts[0];
    if (SKIP.has(cmd)) continue;

    switch (cmd) {
      case 'turn':
        out.push({text: `\u2014 Turn ${parts[1]} \u2014`, kind: 'turn'});
        break;
      case 'switch':
      case 'drag': {
        const s = parseSlot(parts[1]);
        const species = (parts[2] || '').split(',')[0].trim();
        const label = s ? `${s.side === 'p1' ? p1Name : p2Name}\u2019s ${s.nick}` : parts[1];
        const extra = s && species && species !== s.nick ? ` (${species})` : '';
        if (s) {
          const f = parseHPFrac(parts[3]);
          hp.set(s.side, f ?? 1);
        }
        event(`${label}${extra} ${cmd === 'drag' ? 'was dragged out' : 'was sent out'}!`);
        break;
      }
      case 'move':
        event(`${who(parts[1])} used ${parts[2]}!`);
        break;
      case 'faint': {
        const s = parseSlot(parts[1]);
        if (s) hp.set(s.side, 0);
        event(`${who(parts[1])} fainted!`);
        break;
      }
      case 'win': {
        // The raw log's |win| line carries the side's display name
        // (battle.join is given the team names), so use it directly.
        out.push({text: `${parts[1]} wins the battle!`, kind: 'result'});
        break;
      }
      case 'tie':
        out.push({text: 'The battle ended in a draw.', kind: 'result'});
        break;
      case '-terastallize':
        event(`${who(parts[1])} terastallized into ${parts[2]}-type!`);
        break;
      case '-mega':
        event(`${who(parts[1])} Mega Evolved!`);
        break;
      case '-status': {
        const s = parseSlot(parts[1]);
        const label = s ? `${s.side === 'p1' ? p1Name : p2Name}\u2019s ${s.nick}` : parts[1];
        event(`${label} ${STATUS_NAMES[parts[2]] ?? `was afflicted (${parts[2]})`}!`);
        break;
      }
      case '-curestatus':
        event(`${who(parts[1])} was cured of its status!`);
        break;
      case 'cant':
        event(`${who(parts[1])} couldn't move!`);
        break;
      case '-miss':
        event(`But it missed ${who(parts[1])}!`);
        break;
      case '-supereffective':
        info("It's super effective!");
        break;
      case '-resisted':
        info("It's not very effective\u2026");
        break;
      case '-crit':
        info('A critical hit!');
        break;
      case '-boost':
      case '-unboost': {
        const amt = Math.abs(Number(parts[3] || 1));
        const dir = cmd === '-boost' ? 'rose' : 'fell';
        const sharp = amt >= 2 ? ' sharply' : '';
        event(`${who(parts[1])}'s ${STAT_NAMES[parts[2]] ?? parts[2]}${sharp} ${dir}!`);
        break;
      }
      case '-weather': {
        const w = parts[1];
        const label =
          w === 'RainDance' ? 'Rain began to fall!' :
          w === 'SunnyDay' ? 'The sunlight turned harsh!' :
          w === 'Sandstorm' ? 'A sandstorm kicked up!' :
          w === 'Snow' ? 'It started to snow!' :
          w === 'none' ? 'The weather cleared.' : `${w} started.`;
        event(label);
        break;
      }
      case '-fieldstart': {
        const move = (parts[1] || '').replace(/^move:\s*/, '');
        event(move === 'Trick Room' ? 'Twisted dimensions! Trick Room was set!' : `${move} was set up!`);
        break;
      }
      case '-fieldend':
        event(`${(parts[1] || '').replace(/^move:\s*/, '')} faded.`);
        break;
      case '-sidestart': {
        const s = parseSlot(parts[1]);
        const team = s ? (s.side === 'p1' ? p1Name : p2Name) : parts[1];
        const move = (parts[2] || '').replace(/^move:\s*/, '');
        event(`${HAZARD_NAMES[move] ?? `${move} was set up`} around ${team}'s team!`);
        break;
      }
      case '-sideend': {
        const s = parseSlot(parts[1]);
        const team = s ? (s.side === 'p1' ? p1Name : p2Name) : parts[1];
        const move = (parts[2] || '').replace(/^move:\s*/, '');
        event(`${move} around ${team}'s team wore off.`);
        break;
      }
      case '-ability':
        event(`${who(parts[1])}'s ${parts[2]} activated!`);
        break;
      case '-start': {
        const what = (parts[2] || '').replace(/^move:\s*/, '');
        if (!what) break;
        if (what === 'confusion') {
          event(`${who(parts[1])} became confused!`);
          break;
        }
        const proto = /^(protosynthesis|quarkdrive)(atk|def|spa|spd|spe)?$/i.exec(what);
        if (proto) {
          const ability = proto[1].toLowerCase() === 'protosynthesis' ? 'Protosynthesis' : 'Quark Drive';
          const stat = proto[2] ? STAT_NAMES[proto[2].toLowerCase()] : null;
          event(stat
            ? `${who(parts[1])}'s ${ability} boosted its ${stat}!`
            : `${who(parts[1])}'s ${ability} activated!`);
          break;
        }
        event(`${who(parts[1])}: ${what}!`);
        break;
      }
      case '-end': {
        const what = (parts[2] || '').replace(/^move:\s*/, '');
        if (!what) break;
        const pretty = what
          .replace(/^protosynthesis/i, 'Protosynthesis')
          .replace(/^quarkdrive/i, 'Quark Drive');
        event(`${who(parts[1])}'s ${pretty} ended.`);
        break;
      }
      case '-activate': {
        const target = who(parts[1]);
        const what = parts.slice(2).join(' ')
          .replace(/\[fromitem\]/gi, '(from its item)')
          .replace(/\[from\]/gi, 'from')
          .trim();
        if (/^confusion\b/i.test(what)) {
          event(`${target} hurt itself in its confusion!`);
        } else if (/^ability:\s*/i.test(what)) {
          const ab = what.replace(/^ability:\s*/i, '').replace(/\s*\(from its item\)\s*/i, '').trim();
          event(`${target}'s ${ab} activated!`);
        } else if (/^move:\s*/i.test(what)) {
          event(`${target} — ${what.replace(/^move:\s*/i, '')}!`);
        } else if (what) {
          event(`${target}: ${what}`);
        }
        break;
      }
      case '-immune':
        event(`It doesn't affect ${who(parts[1])}…`);
        break;
      case '-fail':
        event('But it failed!');
        break;
      case '-enditem':
        event(`${who(parts[1])}'s ${parts[2] || 'item'} was used up!`);
        break;
      case '-damage':
      case '-sethp': {
        const s = parseSlot(parts[1]);
        const key = s ? s.side : parts[1];
        const label = who(parts[1]);
        const cur = parseHPFrac(parts[2]);
        const prev = hp.get(key);
        if (cur !== null) hp.set(key, cur);
        const from = fromSource(parts);
        if (from) {
          const line = residualLine(label, from);
          if (line) {
            event(line);
            break;
          }
          if (/^confusion$/i.test(from)) break; // already narrated by the -activate line
        }
        if (prev !== undefined && cur !== null) {
          const delta = Math.round((prev - cur) * 100);
          if (delta > 0) event(`${label} lost ${delta}% of its health!`);
          else if (delta < 0) event(`${label} regained ${-delta}% of its health!`);
          // delta 0 (e.g. [silent]) means nothing visible happened
        } else if (cur !== null) {
          event(`${label} is at ${Math.round(cur * 100)}% HP.`);
        }
        break;
      }
      case '-heal': {
        const s = parseSlot(parts[1]);
        const key = s ? s.side : parts[1];
        const label = who(parts[1]);
        const cur = parseHPFrac(parts[2]);
        const prev = hp.get(key);
        if (cur !== null) hp.set(key, cur);
        if (prev !== undefined && cur !== null && cur > prev) {
          event(`${label} regained ${Math.round((cur - prev) * 100)}% of its health!`);
        } else {
          event(`${label} restored its health!`);
        }
        break;
      }
      case 'message':
        info(parts.slice(1).join(' '));
        break;
      default: {
        // Anything unrecognized: resolve side slots to team names and strip
        // protocol brackets rather than leaking raw syntax.
        const cleaned = parts
          .map((x, i) => {
            if (i === 0) return x.replace(/^-/, '');
            const t = x.trim();
            return /^p[12]a?:/.test(t) ? who(x) : x;
          })
          .join(' ')
          .replace(/\[fromitem\]/gi, '(from its item)')
          .replace(/\[from\]/gi, 'from')
          .replace(/^\s+/, '');
        if (cleaned) info(cleaned);
        break;
      }
    }
  }
  return out;
}
