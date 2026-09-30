/**
 * Build a Showdown replay HTML page from a captured battle log.
 *
 * This mirrors what the `pokemon-showdown-replays` Python package produces
 * with `Download.create_replay`: the raw protocol log is embedded in the
 * page and Showdown's own client renderer
 * (https://play.pokemonshowdown.com/js/replay-embed.js) turns it into the
 * animated battle scene, log panel, and playback controls. No conversion
 * of the log itself happens — the client parses the standard protocol.
 */

const REPLAY_EMBED = 'https://play.pokemonshowdown.com/js/replay-embed.js';

/** Battle-log panel styling, taken from the reference converter template. */
const REPLAY_CSS = `html,body {font-family:Verdana, sans-serif;font-size:10pt;margin:0;padding:0;}body{padding:12px 0;} .battle-log {font-family:Verdana, sans-serif;font-size:10pt;} .battle-log-inline {border:1px solid #AAAAAA;background:#EEF2F5;color:black;max-width:640px;margin:0 auto 80px;padding-bottom:5px;} .battle-log .inner {padding:4px 8px 0px 8px;} .battle-log .inner-preempt {padding:0 8px 4px 8px;} .battle-log .inner-after {margin-top:0.5em;} .battle-log h2 {margin:0.5em -8px;padding:4px 8px;border:1px solid #AAAAAA;background:#E0E7EA;border-left:0;border-right:0;font-family:Verdana, sans-serif;font-size:13pt;} .battle-log .chat {vertical-align:middle;padding:3px 0 3px 0;font-size:8pt;} .battle-log .chat strong {color:#40576A;} .battle-log .chat em {padding:1px 4px 1px 3px;color:#000000;font-style:normal;} .chat.mine {background:rgba(0,0,0,0.05);margin-left:-8px;margin-right:-8px;padding-left:8px;padding-right:8px;} .spoiler {color:#BBBBBB;background:#BBBBBB;padding:0px 3px;} .spoiler:hover, .spoiler:active, .spoiler-shown {color:#000000;background:#E2E2E2;padding:0px 3px;} .spoiler a {color:#BBBBBB;} .spoiler:hover a, .spoiler:active a, .spoiler-shown a {color:#2288CC;} .chat code, .chat .spoiler:hover code, .chat .spoiler:active code, .chat .spoiler-shown code {border:1px solid #C0C0C0;background:#EEEEEE;color:black;padding:0 2px;} .chat .spoiler code {border:1px solid #CCCCCC;background:#CCCCCC;color:#CCCCCC;} .battle-log .rated {padding:3px 4px;} .battle-log .rated strong {color:white;background:#89A;padding:1px 4px;border-radius:4px;} .spacer {margin-top:0.5em;} .message-announce {background:#6688AA;color:white;padding:1px 4px 2px;} .message-announce a, .broadcast-green a, .broadcast-blue a, .broadcast-red a {color:#DDEEFF;} .broadcast-green {background-color:#559955;color:white;padding:2px 4px;} .broadcast-blue {background-color:#6688AA;color:white;padding:2px 4px;} .infobox {border:1px solid #6688AA;padding:2px 4px;} .infobox-limited {max-height:200px;overflow:auto;overflow-x:hidden;} .broadcast-red {background-color:#AA5544;color:white;padding:2px 4px;} .message-learn-canlearn {font-weight:bold;color:#228822;text-decoration:underline;} .message-learn-cannotlearn {font-weight:bold;color:#CC2222;text-decoration:underline;} .message-effect-weak {font-weight:bold;color:#CC2222;} .message-effect-resist {font-weight:bold;color:#6688AA;} .message-effect-immune {font-weight:bold;color:#666666;} .message-learn-list {margin-top:0;margin-bottom:0;} .message-throttle-notice, .message-error {color:#992222;} .message-overflow, .chat small.message-overflow {font-size:0pt;} .message-overflow::before {font-size:9pt;content:'...';} .subtle {color:#3A4A66;}`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve |split| blocks to the shared (spectator) view. The replay client
 * (battle.js / battle-log.js) has no handler for the split command at all —
 * real downloaded replay logs never contain splits; the server resolves them
 * before storing. Each block is:
 *   |split|pX
 *   <secret line, exact HP, for side pX only>
 *   <shared line, the public view>
 * so we drop the marker and the secret line and keep the shared line.
 */
function resolveSplits(log: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < log.length; i++) {
    const line = log[i];
    if (line.startsWith('|split|')) {
      const shared = log[i + 2];
      if (shared !== undefined) out.push(shared);
      i += 2;
      continue;
    }
    out.push(line);
  }
  return out;
}

export function buildReplayHtml(log: string[], p1Name: string, p2Name: string): string {
  const logText = resolveSplits(log).join('\n');
  // Format label for the title, e.g. "[Gen 9] OU" from the |tier| line.
  let format = 'gen9ou';
  const tierIdx = logText.indexOf('|tier|');
  if (tierIdx >= 0) {
    const tier = logText.slice(tierIdx + 6).split('\n')[0].trim();
    if (tier) format = tier;
  }
  // The log sits inside <script type="text/plain">: only a literal
  // "</script" can break out of it, which never occurs in protocol logs,
  // but guard anyway.
  const safeLog = logText.replace(/<\/script/gi, '<\\/script');
  const title = `${format}: ${p1Name} vs. ${p2Name}`;
  const replayId = `battledome-${Date.now().toString(36)}`;
  return `<!DOCTYPE html>
<meta charset="utf-8" />
<!-- generated by Battle Dome; animated by the pokemonshowdown.com client (replay-embed.js) -->
<title>${escapeHtml(title)}</title>
<style>
${REPLAY_CSS}
</style>
<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">
<input type="hidden" name="replayid" value="${escapeHtml(replayId)}" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<script type="text/plain" class="battle-log-data">${safeLog}
</script>
</div>
<script>
let daily = Math.floor(Date.now()/1000/60/60/24);document.write('<script src="${REPLAY_EMBED}?version='+daily+'"></'+'script>');
</script>`;
}
