# Battle Dome

**DOME = Data-driven Opponent Matchup Evaluation**

Benchmark your Pokémon team against reference teams — every battle genuinely simulated
in your browser with [@pkmn/sim](https://github.com/smogon/pokemon-showdown). No server,
no database, no uploads: paste a Showdown team export, pick reference teams, and get
win/loss/draw stats per matchup.

Live: https://caedonhsieh.github.io/battle-dome/

## How it works

- **Team import** — paste a Pokémon Showdown export; it's validated with the
  `TeamValidator` (gen9 OU) plus sanity checks (6 Pokémon, species/moves present).
  Named teams are saved to `localStorage`.
- **Reference teams** — 21 bundled **Smogon SV OU Sample Teams** (6 Offense, 6 Bulky
  Offense, 6 Balance, 3 Stall), selectable with archetype filters; you can also add
  your own validated custom references. Credit: [Smogon forum thread](https://www.smogon.com/forums/threads/sv-ou-sample-teams-new-samples-added-post-spl-and-tera-blast-ban.3712513/).
- **Runs** — configurable battles per matchup (1–200, default 20) and a seed text
  input (default random; same seed + same teams = reproducible results). Battles run
  in a Web Worker so the page stays responsive; cancellation is supported between
  battles.
- **Results** — overall W/L/D, a per-matchup table sortable by win rate, subtotals
  grouped by archetype, and run history persisted in `localStorage` (list, rename,
  delete, revisit).

## The bot (read before trusting the numbers)

Both sides are piloted by the same simple heuristic bot (`src/sim/bot.ts`, shared
between the worker and the Node smoke test):

- Scores damaging moves as `base power × type effectiveness × STAB (1.5) × accuracy`,
  plus ±5% seeded jitter; skips disabled moves.
- Prefers recovery moves below 75% HP, setup moves when unboosted above 60% HP, and
  sets each entry hazard once.
- **Never Terastallizes. Never switches voluntarily** (only on forced switches, picking
  the bench mon least vulnerable to the foe's STAB types, weighted by HP). No
  prediction of any kind.
- 200-turn cap → draw.

Results therefore measure **relative team strength under this heuristic**, not ladder
performance — useful for comparing your own teams or spotting bad archetype matchups,
not as a rating. The in-app "How it works" tab documents all of this.

## Develop

```bash
npm install
npm run dev      # vite dev server
npm run build    # tsc + vite build → dist/
npm run smoke    # Node smoke test: 12 real bot-vs-bot battles (t01 offense vs t20 stall)
```

`/tmp` full? Set `TMPDIR=~/workspace/.tmp` (or anywhere writable) for npm/build work.

## Deploy (GitHub Pages)

`dist/` is deployed via the Actions workflow in `.github/workflows/pages.yml`
(official `actions/deploy-pages`). Pushing to `main` rebuilds and publishes to
https://caedonhsieh.github.io/battle-dome/. Vite `base` is `/battle-dome/`.

## Credits

- Reference teams: **Smogon SV OU Sample Teams** —
  [forum thread](https://www.smogon.com/forums/threads/sv-ou-sample-teams-new-samples-added-post-spl-and-tera-blast-ban.3712513/)
- Battle simulation: [@pkmn/sim](https://github.com/smogon/pokemon-showdown) (Pokémon Showdown)
- Fan tool; not affiliated with Smogon, Nintendo, Game Freak, or Pokémon Showdown.
