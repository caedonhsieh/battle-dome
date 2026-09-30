import {winRate} from '../lib/run';

/**
 * One-line "12W / 3L / 1D (75%)" score with colored W/L, used everywhere a
 * matchup or run total is rendered.
 */
export default function ScoreLine({
  wins,
  losses,
  draws,
  showPct = true,
}: {
  wins: number;
  losses: number;
  draws: number;
  showPct?: boolean;
}) {
  const r = {wins, losses, draws};
  const total = wins + losses + draws;
  return (
    <span>
      <strong className="win-t">{wins}W</strong> / <strong className="loss-t">{losses}L</strong> /{' '}
      {draws}D
      {showPct && total > 0 && ` (${Math.round(winRate(r) * 100)}%)`}
    </span>
  );
}
