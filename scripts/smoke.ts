/**
 * Node smoke test for the battle + bot logic (shares src/sim/bot.ts with the web worker).
 * Run: npm run smoke
 *
 * Runs >= 10 battles between two contrasting sample teams (t01 offense vs t20 stall)
 * with the real bot on both sides. Asserts: no crashes, turn cap holds (no infinite
 * loops), results are sane (wins/losses recorded, draws possible).
 */
import {runBattle, validateTeamExport, MAX_TURNS} from '../src/sim/bot';
import teamsData from '../src/data/reference-teams.json';

const teams = (teamsData as any).teams as {id: string; name: string; paste: string}[];
const offense = teams.find(t => t.id === 't01')!;
const stall = teams.find(t => t.id === 't20')!;

console.log(`Offense: ${offense.name.slice(0, 50)}`);
console.log(`Stall:   ${stall.name.slice(0, 50)}`);

// 1. Validation sanity
const v1 = validateTeamExport(offense.paste);
const v2 = validateTeamExport(stall.paste);
console.log(`validate t01: ok=${v1.ok} species=${v1.species.length}`);
console.log(`validate t20: ok=${v2.ok} species=${v2.species.length}`);
const bad = validateTeamExport('Pikachu @ Light Ball\n- Thunderbolt');
console.log(`validate garbage: ok=${bad.ok} problems=${bad.problems.length}`);
if (!v1.ok || !v2.ok) throw new Error('Reference teams failed validation!');
if (bad.ok) throw new Error('Garbage paste should not validate!');

// 2. Battles
const N = 12;
let p1wins = 0, p2wins = 0, draws = 0, maxTurns = 0, totalTurns = 0;
const start = Date.now();
for (let i = 0; i < N; i++) {
  const r = runBattle(offense.paste, stall.paste, {seed: 'smoke-test-seed', matchupIndex: 0, battleIndex: i});
  if (r.winner === 'p1') p1wins++;
  else if (r.winner === 'p2') p2wins++;
  else draws++;
  maxTurns = Math.max(maxTurns, r.turns);
  totalTurns += r.turns;
  console.log(`  battle ${i + 1}: winner=${r.winner ?? 'draw'} turns=${r.turns}`);
}
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// 3. Assertions
if (maxTurns > MAX_TURNS) throw new Error(`Turn cap violated: ${maxTurns} > ${MAX_TURNS}`);
if (p1wins + p2wins + draws !== N) throw new Error('Result count mismatch');
if (p1wins + p2wins === 0) throw new Error('No decisive results at all — suspicious');

console.log(`\nSMOKE OK: ${N} battles, P1(offense) ${p1wins}W / P2(stall) ${p2wins}W / ${draws}D, ` +
  `maxTurns=${maxTurns} (cap ${MAX_TURNS}), avgTurns=${(totalTurns / N).toFixed(1)}, ${elapsed}s`);
