/**
 * Capture real per-decision model feeds for KV-cache validation.
 *
 * Runs battles with the CURRENT production (full-sequence) model and records
 * every accepted decision per side: the single new step's tensors, the side's
 * time index, and the reference logits. Output is replayed in Python through
 * the KV-cache model to prove identical argmax on genuinely varying
 * observations.
 *
 * Usage: npx tsx scripts/capture-kv-feeds.ts
 */
import {runBattleMetamon} from '../src/sim/metamon/runner.js';
import teamsData from '../src/data/reference-teams.json';
// @ts-ignore — node types not in tsconfig; scripts run under tsx
import {writeFileSync} from 'node:fs';

const ORT_PATH = '/home/hatch/workspace/spikes/metamon-ts/node_modules/onnxruntime-node/dist/index.js';
const MODEL = '/home/hatch/workspace/spikes/metamon/kadabra3_fp16_ort_single_noeinsum.onnx';
const OUT = '/home/hatch/workspace/spikes/metamon/kv_feeds.json';
const teams: Array<{name: string; paste: string}> = (teamsData as any).teams;

interface Decision {
  side: 'p1' | 'p2';
  numbers: number[];
  tokens: string[];
  illegal: boolean[];
  rl2s: number[];
  t: number;
  logits: number[];
  action: number;
}

async function main() {
  const ort: any = await import(/* @vite-ignore */ ORT_PATH);
  const session = await ort.InferenceSession.create(MODEL, {executionProviders: ['cpu']});
  console.log('[capture] session loaded');

  const battles: {seed: string; matchupIndex: number; decisions: Decision[]}[] = [];
  // Two battles, different team pairs, for observation variety.
  const configs = [
    {seed: 'kvfeed1', a: 0, b: 1},
    {seed: 'kvfeed2', a: 2, b: 3},
  ];
  for (const c of configs) {
    const decisions: Decision[] = [];
    const r = await runBattleMetamon({ort, session}, teams[c.a].paste, teams[c.b].paste, {
      seed: c.seed,
      matchupIndex: 0,
      battleIndex: 0,
      onDecision: (side, step, logits, action) => {
        decisions.push({
          side,
          numbers: step.numbers,
          tokens: step.tokens.map(String),
          illegal: step.illegal,
          rl2s: step.rl2s,
          t: step.t,
          logits,
          action,
        });
      },
    }, () => false);
    console.log(`[capture] battle ${c.seed}: winner=${r.winner} turns=${r.turns} decisions=${decisions.length}`);
    battles.push({seed: c.seed, matchupIndex: 0, decisions});
  }
  writeFileSync(OUT, JSON.stringify(battles));
  const n = battles.reduce((s, b) => s + b.decisions.length, 0);
  console.log(`[capture] wrote ${OUT} (${n} decisions)`);
}

main().catch((e) => { console.error('[capture] FATAL', e); throw e; });
