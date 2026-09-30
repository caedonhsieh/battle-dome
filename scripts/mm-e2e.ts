/**
 * End-to-end Metamon battle test under Node (onnxruntime-node).
 * Validates: protocol capture -> BattleTracker -> obs pipeline -> fp16
 * inference -> action mapping -> Showdown choice strings, for a full battle
 * with the pilot on BOTH sides.
 *
 * Usage: MODEL=/path/to/kadabra3_fp16_ort_single.onnx npx tsx scripts/mm-e2e.ts
 */
import {runBattleMetamon} from '../src/sim/metamon/runner.js';
import teamsData from '../src/data/reference-teams.json';

const ORT_PATH = '/home/hatch/workspace/spikes/metamon-ts/node_modules/onnxruntime-node/dist/index.js';
const MODEL = '/home/hatch/workspace/spikes/metamon/kadabra3_fp16_ort_single.onnx';
const teams: Array<{name: string; paste: string}> = (teamsData as any).teams;

async function main() {
  const ort: any = await import(/* @vite-ignore */ ORT_PATH);
  console.log('[mm-e2e] loading session...');
  const session = await ort.InferenceSession.create(MODEL, {executionProviders: ['cpu']});
  console.log('[mm-e2e] session loaded');

  // Mirror check: balance vs balance (should not skew), plus one stall matchup.
  const matchups: Array<[number, number]> = [
    [0, 1],
    [4, 5], // stall-ish vs something; just exercise variety
  ];
  let unmappableTotal = 0;
  const t0 = Date.now();
  for (const [a, b] of matchups) {
    const t1 = Date.now();
    const r = await runBattleMetamon({ort, session}, teams[a].paste, teams[b].paste, {
      seed: 'mm-e2e',
      matchupIndex: a * 10 + b,
      battleIndex: 0,
    }, () => false);
    console.log(
      `[mm-e2e] ${teams[a].name} vs ${teams[b].name}: winner=${r.winner} turns=${r.turns} unmappable=${r.unmappable ?? 0} (${((Date.now() - t1) / 1000).toFixed(1)}s`,
    );
    unmappableTotal += r.unmappable ?? 0;
    if (r.turns >= 200) console.log('[mm-e2e] WARNING: hit turn cap');
  }
  // Determinism: same matchup + same seed must give identical results.
  const det: string[] = [];
  for (let k = 0; k < 2; k++) {
    const r = await runBattleMetamon({ort, session}, teams[0].paste, teams[1].paste, {
      seed: 'mm-e2e',
      matchupIndex: 1,
      battleIndex: 0,
    }, () => false);
    det.push(`${r.winner}/${r.turns}`);
    unmappableTotal += r.unmappable ?? 0;
  }
  console.log(`[mm-e2e] determinism check: ${det.join(' vs ')} ${det[0] === det[1] ? 'IDENTICAL' : 'MISMATCH!'}`);

  // Nicknamed team (t04 has "Byakko (Raging Bolt)" etc.) exercises nickname/switch resolution.
  const r4 = await runBattleMetamon({ort, session}, teams[3].paste, teams[2].paste, {
    seed: 'mm-e2e',
    matchupIndex: 32,
    battleIndex: 0,
  }, () => false);
  console.log(`[mm-e2e] nicknamed matchup: winner=${r4.winner} turns=${r4.turns} unmappable=${r4.unmappable ?? 0}`);
  unmappableTotal += r4.unmappable ?? 0;
  console.log(`[mm-e2e] done in ${((Date.now() - t0) / 1000).toFixed(1)}s, unmappable=${unmappableTotal}`);
}

main().catch((e) => {
  console.error('[mm-e2e] FATAL', e);
  throw e;
});
