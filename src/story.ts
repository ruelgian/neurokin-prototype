// Journal writer: turns sim outcomes into short readable story beats.
import { Rng } from './rng';
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const T = {
  fightWin: [
    '{name} caught a {enemy} off-guard in {zone} and dismantled it in three clean strikes.',
    'A {enemy} lunged out of the static. {name} read the pattern a frame early and cut it down.',
    '{name} baited a {enemy} into a dead-end alley of {zone} and won the exchange.',
    'Steel-blue sparks: {name} traded blows with a {enemy} and walked away the winner.',
  ],
  fightLose: [
    'A {enemy} out-muscled {name}. It broke off, leaking light from a cracked plate.',
    '{name} misjudged a {enemy}. The fight went badly and it limped clear.',
    'The {enemy} was faster than the numbers said. {name} took the hit and disengaged.',
  ],
  talk: [
    '{name} lowered its guard and talked a {enemy} down. They parted with a trade instead of a fight.',
    'Instead of fighting, {name} offered terms to a {enemy}. It worked, and paid.',
  ],
  sneak: ['{name} ghosted past a {enemy} without a trace.', '{name} judged a {enemy} not worth the risk and slipped around it.'],
  scavenge: ['{name} picked through wrecked drones in {zone} for salvage.', '{name} stripped a burned-out kiosk for parts.', '{name} swept the {zoneflavor} for anything worth keeping.'],
  cache: ['{name} found a sealed data cache hidden in {zone}. Jackpot.', 'Behind a false wall in {zone}, {name} cracked open a forgotten cache.'],
  explore: ['{name} mapped a new sector of {zone}: {zoneflavor}.', '{name} wandered the {zoneflavor}, logging every exit.'],
  rest: ['{name} sealed itself into a quiet node and ran self-repair.', '{name} paused to patch damaged plating.'],
  retreat: ['{name} hit its retreat threshold and pulled out of {zone}, back to the Lab.', 'Low on HP, {name} broke contact and headed home, as ordered.'],
  travel: ['{name} decided {zone} was the better bet and moved out.', 'Re-routing: {name} set course for {zone}.'],
  deploy: ['{name} left the Lab and dropped into {zone}.', 'Uplink open. {name} deployed to {zone}.'],
  ko: ['{name} was knocked out in {zone}. A Safe-zone failsafe dragged it home.', 'Systems dark: {name} got knocked out and auto-recalled to the Lab.'],
};
export type StoryKey = keyof typeof T;
export function line(rng: Rng, key: StoryKey, v: Record<string, string | number>) { return fill(rng.pick(T[key]), v); }
