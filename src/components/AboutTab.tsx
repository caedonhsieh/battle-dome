import {SMOGON_THREAD_URL, REFERENCE_SET_LABEL, FORMAT_LABEL} from '../lib/types';

export default function AboutTab() {
  return (
    <div className="panel">
      <h2>How battles are decided</h2>
      <p className="muted">
        Every battle is a real Pokémon Showdown simulation (via{' '}
        <a href="https://github.com/smogon/pokemon-showdown" target="_blank" rel="noreferrer">
          @pkmn/sim
        </a>
        ) running entirely in your browser — damage rolls, accuracy, speed ties, status, and
        entry hazards are all genuinely simulated. The players are real too, in a sense: both
        sides are piloted by the same trained neural-network policy, described honestly below.
      </p>

      <div className="card">
        <h3>The pilot: Metamon Kadabra3</h3>
        <ul className="explainer">
          <li>
            <strong>What it is.</strong> Kadabra3 is a 46M-parameter reinforcement-learning
            policy trained on gen9 OU play (<a href="https://github.com/smogon/metamon" target="_blank" rel="noreferrer">Metamon</a>,
            MIT licensed). It reads the battle the way a human does — revealed moves, HP,
            boosts, hazards, Tera availability — and picks from 13 actions (4 moves, 5
            switches, 4 Tera moves) every turn.
          </li>
          <li>
            <strong>It plays like a player.</strong> It Terastallizes, switches voluntarily,
            sets up, recovers, and plays around what it has seen — the old heuristic bot did
            none of that. In a 100-battle head-to-head, Metamon beat that heuristic 90-9-1.
          </li>
          <li>
            <strong>Deterministic.</strong> It always takes its highest-scoring legal action
            (argmax, no sampling), so runs are fully reproducible: same teams + same seed +
            same matchup order = same results. Change the seed to sample different RNG.
          </li>
          <li>
            <strong>Where it runs.</strong> The model (~95MB) downloads once from this
            site's own hosting and is cached in your browser's IndexedDB. Inference runs on-device via{' '}
            <code>onnxruntime-web</code> — WebGPU when available, WASM otherwise (roughly a
            second per decision on WASM). Nothing about your teams leaves your browser.
          </li>
          <li>
            <strong>Draws.</strong> Battles are capped at 200 turns; anything undecided by then
            is a draw.
          </li>
        </ul>
      </div>

      <div className="card">
        <h3>What the numbers mean (and don't)</h3>
        <ul className="explainer">
          <li>
            Because both sides use the identical pilot, results measure <strong>relative team
            strength under Metamon play</strong> — a team that wins 70% of simulated games is
            better <em>at being piloted by this policy</em> than one that wins 30%.
          </li>
          <li>
            These are <strong>not ladder predictions</strong>. Metamon plays at a strong
            human-like level, but it is still one fixed policy with blind spots — it went
            roughly even piloting stall, for example. Treat win rates as matchup signal, not
            a rating.
          </li>
          <li>
            Use win rates to compare <strong>your own teams against each other</strong> or to
            spot bad matchups (e.g. consistently losing to one archetype), not as a rating.
          </li>
          <li>
            Runs are <strong>deterministic per seed</strong>: same teams + same seed + same
            matchup order = same results, so experiments are reproducible. Change the seed to
            sample different RNG.
          </li>
        </ul>
      </div>

      <div className="card">
        <h3>Credits &amp; format</h3>
        <ul className="explainer">
          <li>
            Reference teams: <strong>{REFERENCE_SET_LABEL}</strong> — sample teams by Smogon
            community members. See the{' '}
            <a href={SMOGON_THREAD_URL} target="_blank" rel="noreferrer">
              Smogon forum thread
            </a>{' '}
            for the originals and authors.
          </li>
          <li>Battle format: <strong>{FORMAT_LABEL}</strong> (Pokémon Showdown simulation).</li>
          <li>
            Battle Dome is a fan tool, not affiliated with Smogon, Nintendo, Game Freak, or
            Pokémon Showdown.
          </li>
        </ul>
      </div>
    </div>
  );
}
