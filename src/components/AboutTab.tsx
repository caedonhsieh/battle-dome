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
        entry hazards are all genuinely simulated. What is <em>not</em> real is the player: both
        sides are piloted by the same simple heuristic bot, described honestly below.
      </p>

      <div className="card">
        <h3>The bot</h3>
        <ul className="explainer">
          <li>
            <strong>Move choice.</strong> Each turn it scores every usable damaging move as{' '}
            <code>base power × type effectiveness × STAB (1.5) × accuracy</code>, plus ±5% random
            jitter to break ties, and picks the highest. Disabled moves are skipped.
          </li>
          <li>
            <strong>Recovery.</strong> If its active Pokémon is below 75% HP, it prefers a recovery
            move (Recover, Roost, …) when it has one.
          </li>
          <li>
            <strong>Setup.</strong> If unboosted and above 60% HP, it prefers a self-targeting
            boosting move (Swords Dance, Dragon Dance, …) when it has one.
          </li>
          <li>
            <strong>Hazards.</strong> It sets each entry hazard (Stealth Rock, Spikes, Toxic
            Spikes, Sticky Web) once if the opposing side doesn't already have it.
          </li>
          <li>
            <strong>Switching.</strong> It <em>only</em> switches when forced to (a faint). It
            then picks the surviving bench Pokémon least vulnerable to the foe's STAB types,
            weighted by remaining HP.
          </li>
          <li>
            <strong>Never Terastallizes.</strong> Tera is a huge part of real gen9 play and this
            bot simply doesn't use it — on either side.
          </li>
          <li>
            <strong>No prediction.</strong> It doesn't anticipate switches, double-switch, or
            play around likely sets. It reacts to the board state, nothing more.
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
            Because both sides use the identical bot, results measure <strong>relative team
            strength under this heuristic</strong> — a team that wins 70% of simulated games is
            better <em>at being piloted by this bot</em> than one that wins 30%.
          </li>
          <li>
            These are <strong>not ladder predictions</strong>. A human would Tera, predict, and
            switch voluntarily; the bot does none of that. Stall, in particular, tends to
            overperform here because the bot never punishes passive play the way a human would.
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
