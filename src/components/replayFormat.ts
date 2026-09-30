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
        event(`${label}${extra} ${cmd === 'drag' ? 'was dragged out' : 'was sent out'}!`);
        break;
      }
      case 'move':
        event(`${who(parts[1])} used ${parts[2]}!`);
        break;
      case 'faint':
        event(`${who(parts[1])} fainted!`);
        break;
      case 'win': {
        const w = parts[1] === 'P1' ? p1Name : parts[1] === 'P2' ? p2Name : parts[1];
        out.push({text: `${w} wins the battle!`, kind: 'result'});
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
        if (what) event(`${who(parts[1])}: ${what}!`);
        break;
      }
      case '-end':
        if (parts[2]) event(`${who(parts[1])}'s ${(parts[2] || '').replace(/^move:\s*/, '')} ended.`);
        break;
      case '-heal':
      case '-damage':
      case '-sethp':
        // HP churn is noise; faints carry the signal.
        break;
      case 'message':
        info(parts.slice(1).join(' '));
        break;
      default: {
        // Anything unrecognized: show a cleaned-up version rather than dropping it.
        const cleaned = parts.join(' ').replace(/^\s+/, '');
        if (cleaned) info(cleaned);
        break;
      }
    }
  }
  return out;
}
