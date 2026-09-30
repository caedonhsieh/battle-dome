/**
 * Perf profiler v2: aggregate session.run latency by history length T across
 * several battles, to show how per-turn inference cost grows with T.
 *
 * Usage: npx tsx scripts/prof-perf.ts
 */
import {runBattleMetamon} from '../src/sim/metamon/runner.js';
import {MetamonBattle} from '../src/sim/metamon/pilot.js';
import teamsData from '../src/data/reference-teams.json';

const ORT_PATH = '/home/hatch/workspace/spikes/metamon-ts/node_modules/onnxruntime-node/dist/index.js';
const MODEL = '/home/hatch/workspace/spikes/metamon/kadabra3_fp16_ort_single_noeinsum.onnx';
const teams: Array<{name: string; paste: string}> = (teamsData as any).teams;

interface Agg { sum: number; n: number }

async function main() {
  const ort: any = await import(/* @vite-ignore */ ORT_PATH);
  const session = await ort.InferenceSession.create(MODEL, {executionProviders: ['cpu']});
  console.log('[prof] session loaded');

  const buckets = new Map<number, Agg>();
  let runTotal = 0, inferTotal = 0, decideTotal = 0, infers = 0;
  const rawRun = session.run.bind(session);
  session.run = async (feeds: any) => {
    const T = feeds.numbers.dims[1] as number;
    const t0 = performance.now();
    const out = await rawRun(feeds);
    const ms = performance.now() - t0;
    const b = buckets.get(T) ?? {sum: 0, n: 0};
    b.sum += ms; b.n++;
    buckets.set(T, b);
    runTotal += ms; infers++;
    (session as any).__lastMs = ms;
    return out;
  };

  const proto = MetamonBattle.prototype as any;
  const rawDecide = proto.decide;
  const rawInfer = proto.infer;
  proto.infer = async function (...args: any[]) {
    const t0 = performance.now();
    const out = await rawInfer.apply(this, args);
    inferTotal += performance.now() - t0;
    return out;
  };
  proto.decide = async function (...args: any[]) {
    const t0 = performance.now();
    const out = await rawDecide.apply(this, args);
    decideTotal += performance.now() - t0;
    return out;
  };

  const t0 = performance.now();
  let battles = 0, turns = 0;
  // A few matchups x seeds to cover a spread of battle lengths.
  const jobs: Array<[number, number, string]> = [
    [0, 1, 's1'], [4, 5, 's1'], [2, 7, 's1'], [0, 1, 's2'], [4, 5, 's2'], [2, 7, 's2'],
  ];
  for (const [a, b, s] of jobs) {
    const r = await runBattleMetamon({ort, session}, teams[a].paste, teams[b].paste, {
      seed: s, matchupIndex: a * 10 + b, battleIndex: 0,
    }, () => false);
    battles++; turns += r.turns;
    console.log(`[prof] ${teams[a].name} vs ${teams[b].name} (${s}): turns=${r.turns} winner=${r.winner}`);
  }
  const totalMs = performance.now() - t0;

  console.log(`[prof] ${battles} battles, ${turns} turns, ${infers} inferences, total ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`[prof] session.run ${(runTotal / 1000).toFixed(1)}s (${(100 * runTotal / totalMs).toFixed(1)}%) | ` +
    `infer-tensor-prep ${((inferTotal - runTotal) / 1000).toFixed(2)}s | obs ${((decideTotal - inferTotal) / 1000).toFixed(2)}s | ` +
    `sim+loop ${((totalMs - decideTotal) / 1000).toFixed(2)}s`);
  console.log('[prof] avg session.run ms by history length T:');
  const keys = [...buckets.keys()].sort((x, y) => x - y);
  for (const T of keys) {
    const b = buckets.get(T)!;
    if (b.n >= 3) console.log(`[prof]   T=${String(T).padStart(3)}  ${(b.sum / b.n).toFixed(1).padStart(7)}ms  (n=${b.n})`);
  }
}

main().catch((e) => { console.error('[prof] FATAL', e); throw e; });
