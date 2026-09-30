/**
 * End-to-end test: new KV pilot + KV model, one battle.
 * Usage: npx tsx scripts/test-kv-battle.ts
 */
import {runBattleMetamon} from '../src/sim/metamon/runner.js';
import teamsData from '../src/data/reference-teams.json';

const ORT_PATH = '/home/hatch/workspace/spikes/metamon-ts/node_modules/onnxruntime-node/dist/index.js';
const MODEL = '/home/hatch/workspace/spikes/metamon/kadabra3_kv_fp16_noeinsum.onnx';
const teams: Array<{name: string; paste: string}> = (teamsData as any).teams;

async function main() {
  const ort: any = await import(/* @vite-ignore */ ORT_PATH);
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(MODEL, {executionProviders: ['cpu']});
  console.log(`[kvtest] session loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const t1 = Date.now();
  const r = await runBattleMetamon({ort, session}, teams[0].paste, teams[1].paste, {
    seed: 'kvtest1', matchupIndex: 0, battleIndex: 0,
  }, () => false);
  console.log(`[kvtest] winner=${r.winner} turns=${r.turns} unmappable=${r.unmappable} battleTime=${((Date.now() - t1) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error('[kvtest] FATAL', e); throw e; });
