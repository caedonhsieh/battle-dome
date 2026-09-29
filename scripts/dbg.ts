import {Battle, Teams} from '@pkmn/sim';
import teamsData from '../src/data/reference-teams.json';
import {runBattle} from '../src/sim/bot';
const teams = (teamsData as any).teams;
const t01 = teams.find((t: any) => t.id === 't01').paste;
const t20 = teams.find((t: any) => t.id === 't20').paste;
const origChoose = Battle.prototype.choose;
(Battle.prototype as any).choose = function (side: string, choice: string) {
  if (choice !== 'default' && !choice.startsWith('team')) {
    const s: any = (this as any).sides[side === 'p1' ? 0 : 1];
    const active = s.active?.[0];
    const req = s.activeRequest;
    const mv = req?.active?.[0]?.moves?.[parseInt(choice.split(' ')[1]) - 1];
    console.log(`  [${side}] ${active?.name} (${active?.hp}/${active?.maxhp}) -> ${choice} ${mv ? '(' + mv.move + ')' : ''}`);
  }
  return origChoose.call(this, side as any, choice);
};
const r = runBattle(t01, t20, {seed: 'dbg', matchupIndex: 0, battleIndex: 0});
console.log('result:', r.winner, 'turns:', r.turns);
