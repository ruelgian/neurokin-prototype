// NEUROKIN sim core: deterministic ticks, utility-AI "instinct", SYSOP director, rivals, AFK, permadeath.
import { Rng } from './rng';
import { ARCHETYPES, CONFLICTS, CORE_TOKENS, BASE_BUDGET, MODULE_BY_ID, SYNERGIES, ZONES, ZONE_BY_ID, Zone, SkillModule, TICK_MS, MODULE_CRAFT_COST, labCost, LAB_MAX, LabId, FALLEN_WINDOW_MS, TERMS_VERSION } from './data';
import { Kin, Save, JournalEntry, WorldEvent, now, fallenDeadline, dayIndex } from './state';
import { parseOrders, estimateTokens, ParsedOrders } from './orders';
import { line } from './story';

type Fx = Required<NonNullable<SkillModule['fx']>>;
const ZERO_FX: Fx = { combat: 0, mitigation: 0, loot: 0, xp: 0, escape: 0, heal: 0, social: 0, virusRes: 0, explore: 0, recall: 0, danger: 0, lethalMit: 0 };

export function moduleTokens(s: Save, id: string) { return Math.round(MODULE_BY_ID[id].tokens * (1 - 0.05 * (s.lab.compiler - 1))); }
export function budget(s: Save) { return BASE_BUDGET + (s.lab.memory - 1) * 120; }
export function tokensUsed(s: Save, modules: string[], orders: string) {
  return CORE_TOKENS + estimateTokens(orders) + modules.reduce((a, id) => a + moduleTokens(s, id), 0);
}
export function maxTier(s: Save) { return s.lab.compiler >= 4 ? 3 : s.lab.compiler >= 2 ? 2 : 1; }
export function chestCapTicks(s: Save) { return Math.round(((12 + (s.lab.cryo - 1) * 3) * 3_600_000) / TICK_MS); }
export function xpToNext(level: number) { return Math.round(60 * Math.pow(level, 1.8)); }
export function attrCap(s: Save) { return 8 + s.lab.simdeck * 3; }

export interface Derived {
  fx: Fx; synergies: string[]; conflicts: string[]; quality: number; maxHp: number;
  combat: number; orders: ParsedOrders; used: number; budget: number;
}
export function derive(s: Save, k: Kin): Derived {
  const fx: Fx = { ...ZERO_FX };
  const tags = new Set<string>();
  for (const id of k.modules) { const m = MODULE_BY_ID[id]; if (!m) continue; m.tags.forEach((t) => tags.add(t)); for (const [key, v] of Object.entries(m.fx)) (fx as any)[key] += v; }
  const synergies: string[] = [];
  for (const syn of SYNERGIES) if (tags.has(syn.tags[0]) && tags.has(syn.tags[1])) { synergies.push(syn.name); for (const [key, v] of Object.entries(syn.fx)) (fx as any)[key] += v; }
  const conflicts = CONFLICTS.filter(([a, b]) => k.modules.includes(a) && k.modules.includes(b)).map(([a, b]) => `${MODULE_BY_ID[a].name} ✕ ${MODULE_BY_ID[b].name}`);
  const quality = Math.max(0.6, 1 - conflicts.length * 0.12);
  fx.xp += (s.lab.simdeck - 1) * 0.15; fx.recall += (s.lab.memory - 1) * 0.04;
  const a = k.attrs; const lvl = 1 + 0.06 * (k.level - 1);
  const ambushBonus = k.modules.includes('ambush') ? a.agility * 0.5 : 0;
  const combat = (a.might * 2 + a.agility * 1.3 + a.insight * 0.7 + a.will * 0.3 + ambushBonus) * lvl * (1 + fx.combat) * quality;
  const maxHp = Math.round(60 + a.might * 4 + a.will * 2 + k.level * 8);
  const orders = parseOrders(k.orders);
  return { fx, synergies, conflicts, quality, maxHp, combat, orders, used: tokensUsed(s, k.modules, k.orders), budget: budget(s) };
}

export function zoneAllowed(o: ParsedOrders, z: Zone) { return !(o.safeOnly && z.risk !== 'safe') && !(o.noLethal && z.risk === 'lethal'); }
const enemyPower = (z: Zone, mult = 1) => z.diff * 12 * mult;
const winProb = (kp: number, ep: number) => 1 / (1 + Math.exp(-(kp - ep) / (0.22 * ep)));
const eventsIn = (s: Save, zone: string) => s.events.filter((e) => e.zone === zone && e.startsAt <= s.tickCount && e.endsAt > s.tickCount);

// ---------- observation / legal actions ----------
export interface Obs { zone: Zone; enemy?: { name: string; mult: number; elite: boolean }; cache: boolean; event?: WorldEvent; decisionPoint: string | null; legal: string[] }
export interface Option { a: string; s: number; why: string }

export function observe(s: Save, k: Kin, rng: Rng): Obs {
  const zone = ZONE_BY_ID[k.zone!];
  const ev = eventsIn(s, zone.id).find((e) => ['tournament', 'breach', 'bounty'].includes(e.type) && !k.memory['ev_' + e.id]); // each Kin takes on an event once
  const blackout = eventsIn(s, zone.id).some((e) => e.type === 'blackout');
  let enemy: Obs['enemy'];
  if (rng.chance(0.62)) { const elite = rng.chance(0.14); enemy = { name: (elite ? 'elite ' : '') + rng.pick(zone.enemies), mult: rng.range(0.8, 1.2) * (elite ? 1.45 : 1) * (blackout ? 0.8 : 1), elite }; }
  const cache = !blackout && rng.chance(0.09);
  const legal = ['scavenge', 'rest', 'retreat'];
  if (!blackout) legal.push('explore');
  if (enemy) legal.push('fight', 'sneak', 'talk');
  if (ev) legal.push('event');
  if (k.target === 'auto') legal.push('travel');
  const d = derive(s, k);
  const decisionPoint = ev ? 'world event' : enemy?.elite ? 'elite encounter' : k.hp < d.orders.retreatHp + 0.1 && k.hp > d.orders.retreatHp ? 'HP crisis' : null;
  return { zone, enemy, cache, event: ev, decisionPoint, legal };
}

export function bestAutoZone(s: Save, k: Kin, d = derive(s, k)): Zone {
  let best = ZONES[0], bs = -1e9;
  for (const z of ZONES) {
    if (!zoneAllowed(d.orders, z)) continue;
    const p = winProb(d.combat * (1 + d.fx.danger * 0.2), enemyPower(z));
    const riskW = z.risk === 'lethal' ? 2.2 : z.risk === 'perilous' ? 0.8 : 0.2;
    const boldness = k.bold / 100;
    const u = z.diff * p - (1 - p) * z.diff * riskW * (1.3 - boldness);
    if (u > bs) { bs = u; best = z; }
  }
  return best;
}

// Utility AI ("instinct" layer): zero tokens, driven by attributes, personality, modules, Standing Orders.
export function scoreOptions(s: Save, k: Kin, obs: Obs, rng: Rng): Option[] {
  const d = derive(s, k); const o = d.orders; const a = k.attrs; const bold = k.bold / 100;
  const retreatAt = k.modules.includes('berserk') ? Math.min(o.retreatHp, 0.15) : o.retreatHp;
  const opts: Option[] = [];
  const push = (act: string, sc: number, why: string) => { if (obs.legal.includes(act)) opts.push({ a: act, s: sc + rng.range(0, 0.04), why }); };
  if (k.hp < retreatAt && !o.noRetreat) push('retreat', 3, `HP ${Math.round(k.hp * 100)}% < Standing Order ${Math.round(retreatAt * 100)}%`);
  else push('retreat', 0.02 + (obs.zone.risk === 'lethal' && k.hp < 0.5 ? (1 - bold) * 0.6 : 0), 'staying is still worth it');
  if (obs.enemy) {
    const ep = enemyPower(obs.zone, obs.enemy.mult);
    const recall = Math.min(0.3, (k.memory[obs.enemy.name] ?? 0) * d.fx.recall);
    const p = winProb(d.combat * (1 + recall), ep);
    const seen = d.fx.danger > 0 ? p : Math.min(1, p + 0.15 * (1 - a.insight / 15)); // low Insight overestimates odds
    let u = seen * (1 + (o.xpFirst ? 0.35 : 0) + (o.lootFirst ? 0.15 : 0)) * (0.6 + bold * 0.8) - (1 - seen) * (obs.zone.risk === 'lethal' ? 1.4 : 0.6) * (1.2 - bold) * (1 - k.hp + 0.4);
    if (o.avoidFights) u -= 0.8;
    if (d.fx.danger > 0 && seen < 0.45) u -= 0.5;
    push('fight', u, `win odds ≈${Math.round(seen * 100)}% vs ${obs.enemy.name}`);
    push('sneak', 0.25 + a.agility * 0.02 + (k.modules.includes('ghost') ? 0.2 : 0) + (1 - seen) * 0.4, 'avoid a costly fight');
    push('talk', 0.1 + a.presence * 0.03 + d.fx.social + (o.talkFirst ? 0.5 : 0), 'try words before force');
  }
  push('scavenge', 0.3 + a.craft * 0.03 + (o.lootFirst ? 0.3 : 0), 'salvage for bits');
  push('explore', 0.25 + a.insight * 0.02 + d.fx.explore * 0.5 + (o.explorer ? 0.4 : 0) + (obs.cache ? 0.35 : 0), obs.cache ? 'a cache signal nearby' : 'map new ground');
  push('rest', k.hp < 0.75 ? (1 - k.hp) * 1.3 + d.fx.heal * 2 : 0, `HP ${Math.round(k.hp * 100)}%`);
  if (obs.event) {
    const mult = obs.event.type === 'breach' ? 1.9 : obs.event.type === 'tournament' ? 1.5 : 1.35;
    const p = winProb(d.combat, enemyPower(obs.zone, mult)); const seen = d.fx.danger > 0 ? p : Math.min(1, p + 0.15 * (1 - a.insight / 15));
    const downside = obs.event.type === 'tournament' ? 0.2 : obs.zone.risk === 'lethal' ? 1.8 : 0.7;
    push('event', 0.3 + seen * 1.6 * (0.6 + bold * 0.8) - (1 - seen) * downside * (1.2 - bold), `SYSOP event "${obs.event.title}", win odds ≈${Math.round(seen * 100)}%`);
  }
  if (obs.legal.includes('travel')) { const bz = bestAutoZone(s, k, d); if (bz.id !== k.zone) push('travel', 0.9, `${bz.name} is the better risk/reward`); }
  return opts.sort((x, y) => y.s - x.s);
}

// ---------- tick ----------
export interface TickIO { log: (e: Omit<JournalEntry, 't'>) => void; flags: Set<string> }
function addLoot(s: Save, bits: number, shards: number, io: TickIO) {
  const k = s.kin!; const d = derive(s, k);
  if (s.chest.ticks >= chestCapTicks(s)) { io.flags.add('chestFull'); return; }
  const boom = k.zone && eventsIn(s, k.zone).some((e) => e.type === 'data_boom') ? 2 : 1;
  s.chest.bits += Math.round(bits * (1 + d.fx.loot) * boom); s.chest.shards += shards * boom;
}
function addXp(s: Save, xp: number, io: TickIO) {
  const k = s.kin!; const d = derive(s, k);
  k.xp += Math.round(xp * (1 + d.fx.xp));
  while (k.xp >= xpToNext(k.level)) { k.xp -= xpToNext(k.level); k.level++; io.flags.add('levelup'); io.log({ kind: 'level', text: `▲ ${k.name} reached level ${k.level}. New pathways lit up along its neural lines.` }); }
}
function damage(s: Save, k: Kin, zone: Zone, ep: number, frac: number, rng: Rng) {
  const d = derive(s, k);
  const mit = Math.min(0.7, Math.max(-0.3, d.fx.mitigation + (zone.risk === 'lethal' ? d.fx.lethalMit : 0) + k.attrs.agility * 0.01));
  const dmg = ep * frac * rng.range(0.6, 1.3) * (1 - mit);
  k.hp -= dmg / d.maxHp;
}

/** Handles HP <= 0 according to the zone's risk badge (design §6). Returns true if the Kin fell. */
function checkDown(s: Save, k: Kin, zone: Zone, rng: Rng, io: TickIO): boolean {
  if (k.hp > 0) return false;
  const o = derive(s, k).orders;
  const lethal = zone.risk === 'lethal' || (zone.risk === 'perilous' && o.noRetreat);
  if (!lethal) { k.hp = 0.05; k.status = 'lab'; k.zone = null; io.log({ kind: 'combat', text: line(rng, 'ko', { name: k.name, zone: zone.name }) }); return false; }
  if (k.deathWard) { k.deathWard = false; k.hp = 0.01; k.status = 'lab'; k.zone = null; io.flags.add('ward'); io.log({ kind: 'death', text: `⬡ The Death Ward shattered. ${k.name} escaped ${zone.name} at 1 HP. The Ward is spent.` }); return false; }
  fall(s, k, zone.id, io);
  return true;
}
export function fall(s: Save, k: Kin, zoneId: string, io: TickIO) {
  const zone = ZONE_BY_ID[zoneId];
  k.status = 'fallen'; k.hp = 0; k.fallenAt = now(s); k.fallenZone = zoneId; k.zone = null; k.stats.deaths++; k.rescue = undefined;
  k.lastLight = [`I fell in ${zone.name}. I'm frozen where I went down.`, `You have 14 days to bring me back. A rescue quest is free and can be retried as often as you need.`, `You can export everything I know about you at any time from this screen.`];
  io.flags.add('death');
  io.log({ kind: 'death', text: `✖ SIGNAL LOST. ${k.name} fell in ${zone.name}. The 14-day rescue window has started.` });
}

export function resolve(s: Save, k: Kin, obs: Obs, act: string, rng: Rng, io: TickIO) {
  const zone = obs.zone; const d = derive(s, k); const a = k.attrs;
  const v = { name: k.name, zone: zone.name, zoneflavor: zone.flavor, enemy: obs.enemy?.name ?? '' };
  // lethal zones corrode anything that stays (the map itself is being eaten)
  if (zone.risk === 'lethal') { k.hp -= 0.03 * (1 - d.fx.lethalMit); if (checkDown(s, k, zone, rng, io)) return; }
  // virus outbreak: passive threat each tick
  const virus = eventsIn(s, zone.id).find((e) => e.type === 'virus_outbreak');
  if (virus && act !== 'retreat') {
    const resist = Math.min(0.95, 0.25 + a.will * 0.05 + d.fx.virusRes);
    if (!rng.chance(resist)) { k.hp -= 0.08; io.log({ kind: 'sysop', text: `☣ The outbreak in ${zone.name} got into ${k.name}'s buffers (−8% HP). Its Will held the rest off.` }); if (checkDown(s, k, zone, rng, io)) return; }
  }
  switch (act) {
    case 'fight': case 'event': {
      let ep = enemyPower(zone, obs.enemy?.mult ?? 1); let name = obs.enemy?.name ?? 'foe';
      const ev = act === 'event' ? obs.event : undefined;
      if (ev) { ep = enemyPower(zone, ev.type === 'breach' ? 1.9 : ev.type === 'tournament' ? 1.5 : 1.35); name = ev.type === 'breach' ? 'Breach Titan' : ev.type === 'tournament' ? 'tournament champion' : 'bounty target'; k.memory['ev_' + ev.id] = 1; k.stats.events++; }
      const recall = Math.min(0.3, (k.memory[name] ?? 0) * d.fx.recall);
      const p = winProb(d.combat * (1 + recall), ep);
      const won = rng.chance(p);
      k.stats.fights++; k.memory[name] = (k.memory[name] ?? 0) + 1;
      if (won) {
        k.stats.wins++; k.stats.bestZone = Math.max(k.stats.bestZone, zone.diff);
        damage(s, k, zone, ep, 0.12, rng);
        const mult = ev ? (ev.type === 'breach' ? 6 : 4) : obs.enemy?.elite ? 2.5 : 1;
        const bits = Math.round(zone.diff * 1.5 * mult * rng.range(0.8, 1.2)); const shards = ev ? Math.ceil(zone.diff / 2) : rng.chance(0.02 * zone.diff * (obs.enemy?.elite ? 3 : 1)) ? 1 : 0;
        addLoot(s, bits, shards, io); addXp(s, zone.diff * 2.5 * mult, io);
        if (ev) { s.rating += ev.type === 'tournament' ? 18 : 6; io.log({ kind: 'sysop', text: `★ ${k.name} beat the ${name} in SYSOP's "${ev.title}" (+${bits} bits${shards ? `, +${shards} shards` : ''}).` }); }
        else io.log({ kind: 'combat', text: line(rng, 'fightWin', v) + ` (+${bits} bits${shards ? `, +${shards} shards` : ''})` });
        if (ev && ev.type !== 'tournament' && rng.chance(0.1)) dropModule(s, rng, io);
      } else {
        const nonLethalEvent = ev?.type === 'tournament';
        damage(s, k, zone, ep, nonLethalEvent ? 0.25 : 0.42, rng); addXp(s, zone.diff * 1, io);
        io.log({ kind: 'combat', text: ev ? `${k.name} lost to the ${name} in "${ev.title}".` : line(rng, 'fightLose', v) });
        if (nonLethalEvent && k.hp <= 0) k.hp = 0.05;
        if (checkDown(s, k, zone, rng, io)) return;
      }
      break;
    }
    case 'talk': {
      const p = Math.min(0.9, 0.2 + a.presence * 0.04 + d.fx.social);
      if (rng.chance(p)) { const bits = Math.round(zone.diff * 1.2); addLoot(s, bits, 0, io); addXp(s, zone.diff * 1.5, io); io.log({ kind: 'combat', text: line(rng, 'talk', v) + ` (+${bits} bits)` }); }
      else { io.log({ kind: 'combat', text: `${k.name} tried to parley with a ${v.enemy}. It wasn't listening.` }); damage(s, k, zone, enemyPower(zone, obs.enemy?.mult), 0.3, rng); if (checkDown(s, k, zone, rng, io)) return; }
      break;
    }
    case 'sneak': {
      const p = Math.min(0.95, 0.45 + a.agility * 0.04 + d.fx.escape - (zone.risk === 'lethal' ? 0.3 : zone.risk === 'perilous' ? 0.1 : 0));
      if (rng.chance(p)) { if (rng.chance(0.25)) io.log({ kind: 'move', text: line(rng, 'sneak', v) }); addXp(s, zone.diff * 0.5, io); }
      else { io.log({ kind: 'combat', text: `${k.name} tried to slip past a ${v.enemy} and got spotted.` }); damage(s, k, zone, enemyPower(zone, obs.enemy?.mult), 0.3, rng); if (checkDown(s, k, zone, rng, io)) return; }
      break;
    }
    case 'scavenge': {
      if (ambush(s, k, zone, rng, io, 'scavenging')) return; const bits = Math.round(zone.diff * 0.7 * (1 + a.craft * 0.06) * rng.range(0.7, 1.3)); addLoot(s, bits, rng.chance(0.008 * zone.diff) ? 1 : 0, io); if (rng.chance(0.3)) io.log({ kind: 'loot', text: line(rng, 'scavenge', v) + ` (+${bits} bits)` }); break; }
    case 'explore': {
      if (ambush(s, k, zone, rng, io, 'exploring')) return;
      const p = (obs.cache ? 0.7 : 0.12) * (1 + d.fx.explore);
      if (rng.chance(p)) { const bits = zone.diff * 3; const shards = rng.chance(0.4) ? Math.ceil(zone.diff / 4) : 0; addLoot(s, bits, shards, io); k.stats.caches++; io.log({ kind: 'loot', text: line(rng, 'cache', v) + ` (+${bits} bits${shards ? `, +${shards} shards` : ''})` }); if (rng.chance(0.012)) dropModule(s, rng, io); }
      else if (rng.chance(0.3)) io.log({ kind: 'move', text: line(rng, 'explore', v) });
      addXp(s, zone.diff * 1, io); break;
    }
    case 'rest': { k.hp = Math.min(1, k.hp + 0.12 + d.fx.heal); if (rng.chance(0.3)) io.log({ kind: 'move', text: line(rng, 'rest', v) }); break; }
    case 'retreat': {
      if (zone.risk !== 'safe') {
        const p = Math.min(0.95, 0.55 + a.agility * 0.03 + d.fx.escape - (zone.risk === 'lethal' ? 0.2 : 0));
        if (!rng.chance(p)) { io.log({ kind: 'combat', text: `${k.name} tried to break away from ${zone.name} but got cut off.` }); damage(s, k, zone, enemyPower(zone), 0.3, rng); if (checkDown(s, k, zone, rng, io)) return; break; }
      }
      k.status = 'lab'; k.zone = null; io.log({ kind: 'move', text: line(rng, 'retreat', v) }); break;
    }
    case 'travel': { const z = bestAutoZone(s, k, d); k.zone = z.id; io.log({ kind: 'move', text: line(rng, 'travel', { ...v, zone: z.name }) }); break; }
  }
  if (k.status === 'deployed') k.hp = Math.min(1, k.hp + d.fx.heal * 0.5);
}
/** Wandering off the main routes in Perilous/Lethal zones can trigger an ambush. Agility and stealth help. */
function ambush(s: Save, k: Kin, zone: Zone, rng: Rng, io: TickIO, doing: string): boolean {
  if (zone.risk === 'safe') return false;
  const d = derive(s, k);
  const p = (zone.risk === 'lethal' ? 0.22 : 0.08) * Math.max(0.25, 1 - k.attrs.agility * 0.03 - d.fx.escape * 0.5);
  if (!rng.chance(p)) return false;
  damage(s, k, zone, enemyPower(zone), zone.risk === 'lethal' ? 0.5 : 0.35, rng);
  io.log({ kind: 'combat', text: `Ambush! Something in ${zone.name} hit ${k.name} while it was ${doing}.` });
  return checkDown(s, k, zone, rng, io);
}
function dropModule(s: Save, rng: Rng, io: TickIO) {
  const pool = Object.values(MODULE_BY_ID).filter((m) => !s.owned.includes(m.id));
  if (!pool.length) return;
  const m = rng.pick(pool); s.owned.push(m.id);
  io.log({ kind: 'loot', text: `◆ ${s.kin!.name} recovered a skill module: ${m.name} (${m.tokens} tokens). It's waiting in the Loadout.` });
}

// ---------- SYSOP director ----------
const EVENT_TYPES = [
  { type: 'virus_outbreak', risks: ['safe', 'perilous', 'lethal'], dur: [6, 10], titles: ['Red Worm outbreak', 'Static Plague', 'Buffer Rot'], text: 'A self-replicating virus is spreading. High-Will Kin resist it.' },
  { type: 'blackout', risks: ['safe', 'perilous'], dur: [4, 8], titles: ['Grid Blackout', 'Lights Out', 'Power Theft'], text: 'Power is down: no caches, but enemies are weaker in the dark.' },
  { type: 'tournament', risks: ['safe'], dur: [6, 10], titles: ['Plaza Open', 'Neon Cup', 'Archive Gauntlet'], text: 'A knockout tournament (no deaths). Big bits and rating.' },
  { type: 'breach', risks: ['lethal'], dur: [6, 12], titles: ['Kernel Breach', 'The Wound Opens', 'Titan Rising'], text: 'LETHAL. A Breach Titan has surfaced. Huge rewards, real death risk.' },
  { type: 'data_boom', risks: ['safe', 'perilous', 'lethal'], dur: [5, 9], titles: ['Data Boom', 'Gold Rush', 'Cache Flood'], text: 'Loot is doubled in this zone for a while.' },
  { type: 'bounty', risks: ['safe', 'perilous'], dur: [6, 10], titles: ['Bounty: Rogue Loader', 'Bounty: Pickpocket King', 'Bounty: Glitch Hound'], text: 'A marked target is loose. Take it down for shards.' },
];
function sysop(s: Save, rng: Rng, io: TickIO) {
  s.events = s.events.filter((e) => e.endsAt > s.tickCount);
  for (const e of s.events) if (!e.announced && e.startsAt <= s.tickCount) { e.announced = true; io.log({ kind: 'sysop', text: `SYSOP // LIVE: "${e.title}" has begun in ${ZONE_BY_ID[e.zone].name}.` }); }
  if (s.tickCount < s.nextEventTick) return;
  s.nextEventTick = s.tickCount + rng.int(8, 16);
  proposeEvent(s, rng, io);
}
/** Director proposes; the rules validator approves (design §4: SYSOP never edits state directly). */
export function proposeEvent(s: Save, rng: Rng, io: TickIO, forceType?: string) {
  const def = forceType ? EVENT_TYPES.find((e) => e.type === forceType)! : rng.pick(EVENT_TYPES);
  const zone = rng.pick(ZONES.filter((z) => def.risks.includes(z.risk)));
  // validator
  if (def.type === 'breach' && zone.risk !== 'lethal') return;
  if (s.events.length >= 3 && !forceType) return;
  if (s.events.some((e) => e.zone === zone.id && e.type === def.type)) return;
  const lead = def.type === 'breach' ? 4 : 0; // lethal events are announced ahead
  const ev: WorldEvent = { id: 'ev' + s.tickCount + '_' + rng.int(0, 9999), type: def.type, zone: zone.id, startsAt: s.tickCount + lead, endsAt: s.tickCount + lead + rng.int(def.dur[0], def.dur[1]), title: rng.pick(def.titles), text: def.text, announced: lead === 0 };
  s.events.push(ev);
  io.log({ kind: 'sysop', text: lead ? `SYSOP // WARNING: "${ev.title}" will open in ${zone.name} in ${lead} ticks. ${ev.text}` : `SYSOP // BROADCAST: "${ev.title}" in ${zone.name}. ${ev.text}` });
}

function rivalsTick(s: Save, rng: Rng, io: TickIO) {
  for (const r of s.rivals) {
    if (r.status === 'fallen') { if (rng.chance(0.04)) { r.status = 'alive'; io.log({ kind: 'sysop', text: `Guild rescuers pulled ${r.name} out of the Deadzone. It's back on the ladder.` }); } continue; }
    r.xp += rng.range(2, 6) * r.growth * (1 + r.level * 0.1);
    while (r.xp >= xpToNext(r.level)) { r.xp -= xpToNext(r.level); r.level++; }
    if (rng.chance(0.08)) r.rating += Math.round(rng.range(-12, 14));
    if (rng.chance(0.002)) { r.status = 'fallen'; io.log({ kind: 'sysop', text: `SYSOP // ${r.name} (${r.owner}) fell in the Deadzone. Its 14-day window is open.` }); }
  }
}
export function rivalPower(r: { level: number; power: number }) { return 40 * r.power * (1 + 0.06 * (r.level - 1)); }

/** One world tick. `choose` lets the live loop inject an LLM decision at decision points. */
export function worldTick(s: Save, io: TickIO, choose?: (obs: Obs, opts: Option[]) => string | null) {
  const rng = new Rng(s.seed);
  s.tickCount++;
  sysop(s, rng, io); rivalsTick(s, rng, io);
  const k = s.kin;
  if (k) {
    s.chest.ticks += (k.status === 'fallen' ? 0 : 1);
    if (k.status !== 'fallen' && s.chest.ticks <= chestCapTicks(s)) { if (s.tickCount % 4 === 0) s.chest.bits += 1 + Math.floor(k.level / 5); } // idle trickle
    if (k.status === 'fallen') rescueTick(s, k, rng, io);
    else if (k.status === 'lab') {
      const d = derive(s, k);
      k.hp = Math.min(1, k.hp + 0.15 + d.fx.heal);
      if (k.hp >= 0.95 && k.target !== 'hold') {
        const z = k.target === 'auto' ? bestAutoZone(s, k, d) : ZONE_BY_ID[k.target];
        if (z && zoneAllowed(d.orders, z)) { k.status = 'deployed'; k.zone = z.id; io.log({ kind: 'move', text: line(rng, 'deploy', { name: k.name, zone: z.name }) }); }
      }
    } else {
      const obs = observe(s, k, rng);
      const opts = scoreOptions(s, k, obs, rng);
      let act = opts[0]?.a ?? 'rest';
      const picked = choose?.(obs, opts);
      if (picked && obs.legal.includes(picked)) act = picked; // LLM proposes, sim disposes
      if (obs.decisionPoint || picked) s.lastThought = { at: now(s), provider: picked ? s.brain : 'instinct', options: opts.slice(0, 3).map((o) => ({ a: o.a, s: +o.s.toFixed(2) })), chosen: act, why: opts.find((o) => o.a === act)?.why ?? '', promptTokens: derive(s, k).used, prompt: s.lastThought?.prompt };
      if (obs.decisionPoint) io.flags.add('thought');
      resolve(s, k, obs, act, rng, io);
    }
  }
  s.seed = rng.s;
}

function rescueTick(s: Save, k: Kin, rng: Rng, io: TickIO) {
  if (!k.rescue) return;
  k.rescue.progress++;
  if (k.rescue.progress < k.rescue.need) return;
  const p = Math.min(0.95, 0.5 + 0.06 * s.lab.cryo + 0.15 * (k.rescue.attempt - 1));
  if (rng.chance(p)) revive(s, k, 'quest', io);
  else { io.log({ kind: 'rescue', text: `✚ Rescue attempt ${k.rescue.attempt} into ${ZONE_BY_ID[k.fallenZone!].name} failed. The team got out; you can send another for free.` }); k.rescue = undefined; io.flags.add('rescueFail'); }
}
export function rescueNeed(k: Kin) { return 10 + k.level * 2; }
export function startRescue(s: Save, io: TickIO) {
  const k = s.kin!; const attempt = (k.memory['rescueAttempts'] ?? 0) + 1; k.memory['rescueAttempts'] = attempt;
  k.rescue = { progress: 0, need: rescueNeed(k), attempt };
  io.log({ kind: 'rescue', text: `✚ NPC rescuers are heading into ${ZONE_BY_ID[k.fallenZone!].name} (attempt ${attempt}, ~${k.rescue.need} ticks). Free; retry as often as needed.` });
}
export function reviveTokenCost(k: Kin) { return { bits: 200 + 60 * k.level, shards: 8 }; }
export const DEATH_WARD_COST = { bits: 800, shards: 16 };
export function revive(s: Save, k: Kin, how: 'quest' | 'token', io: TickIO) {
  k.status = 'lab'; k.hp = 0.3; k.zone = null; k.rescue = undefined; k.fallenAt = undefined; k.xp = Math.floor(k.xp * 0.5); k.stats.revives++; k.memory['rescueAttempts'] = 0; k.lastLight = [];
  k.target = 'hold';
  io.flags.add('revived');
  io.log({ kind: 'rescue', text: how === 'quest' ? `✚ RESCUE SUCCESS. ${k.name} was carried back to the Lab, rebooting with half its level XP lost. It's holding at the Lab until you redeploy it.` : `✚ Revive Token used. ${k.name} rebooted in the Cryo Vault with half its level XP lost. Holding at the Lab.` });
}

/** Day-14 purge: Core + Mind + Vessel deleted; only an anonymous tombstone remains (design §6.7). */
export function checkExpiry(s: Save, io: TickIO): boolean {
  const k = s.kin;
  if (!k || k.status !== 'fallen' || now(s) < fallenDeadline(k)) return false;
  s.tombstones.push({ kinId: k.id, deletedAt: now(s), consentAt: k.consent.at, terms: k.consent.terms, rating: s.rating, level: k.level });
  s.kin = null; s.journal = []; s.owned = []; s.rating = 1000; s.lastThought = undefined; s.chest.ticks = 0;
  io.flags.add('deleted');
  return true;
}

// ---------- AFK catch-up ----------
export interface AwaySummary { ms: number; ticks: number; capped: boolean; fights: number; wins: number; caches: number; levels: number; bits: number; shards: number; highlights: string[]; died: boolean; deleted: boolean; revived: boolean }
export function catchUp(s: Save, elapsedMs: number, log: (e: JournalEntry) => void): AwaySummary {
  const k0 = s.kin;
  const before = k0 ? { f: k0.stats.fights, w: k0.stats.wins, c: k0.stats.caches, l: k0.level } : null;
  const chest0 = { b: s.chest.bits, s: s.chest.shards };
  let ticks = Math.floor(elapsedMs / TICK_MS);
  const capLeft = Math.max(0, chestCapTicks(s) - (s.chest.ticks ?? 0));
  const fallen = k0?.status === 'fallen';
  const capped = !fallen && ticks > capLeft;
  if (capped) ticks = capLeft;
  ticks = Math.min(ticks, 5000);
  const flags = new Set<string>(); const highlights: string[] = [];
  const t0 = now(s) - elapsedMs;
  let diedAt = 0;
  for (let i = 0; i < ticks; i++) {
    const tt = t0 + (i + 1) * TICK_MS;
    worldTick(s, { flags, log: (e) => { const je = { ...e, t: tt }; log(je); if (['death', 'level', 'sysop', 'rescue'].includes(e.kind) || /cache|module|★/.test(e.text)) highlights.push(e.text); } });
    if (s.kin?.status === 'fallen' && !s.kin.rescue && !fallen) { diedAt = tt; break; } // freeze on death
  }
  if (diedAt && s.kin) s.kin.fallenAt = diedAt; // the countdown starts when it actually fell, not when you looked
  const deleted = checkExpiry(s, { flags, log: () => {} });
  const k = s.kin;
  return {
    ms: elapsedMs, ticks, capped, fights: k && before ? k.stats.fights - before.f : 0, wins: k && before ? k.stats.wins - before.w : 0,
    caches: k && before ? k.stats.caches - before.c : 0, levels: k && before ? k.level - before.l : 0,
    bits: s.chest.bits - chest0.b, shards: s.chest.shards - chest0.s, highlights: highlights.slice(-6), died: flags.has('death'), deleted, revived: flags.has('revived'),
  };
}

/** Monte-Carlo death risk shown on the Lethal confirmation (design §6.2).
 *  (1) whole expeditions (deploy -> until it retreats home or falls), (2) full 12 h AFK shifts with auto-redeploy. */
export function estimateRisk(s: Save, zoneId: string, expeditions = 150, shifts = 24): { perExpedition: number; per12h: number; avgTicks: number } {
  const prep = (r: number, target: string) => {
    const c: Save = JSON.parse(JSON.stringify(s));
    c.seed = (s.seed ^ Math.imul(r + 1, 2654435761)) >>> 0; c.rivals = [];
    if (target === 'hold') { c.events = []; c.nextEventTick = 1e9; } // single expedition: calm world; 12h shifts keep SYSOP events
    const k = c.kin!; k.status = 'deployed'; k.zone = zoneId; k.target = target; k.hp = 1; return c;
  };
  let deaths = 0, tickSum = 0;
  for (let r = 0; r < expeditions; r++) {
    const c = prep(r, 'hold'); const io: TickIO = { flags: new Set(), log: () => {} }; let t = 0;
    for (; t < 120; t++) { worldTick(c, io); if (io.flags.has('death')) { deaths++; break; } if (c.kin!.status !== 'deployed') break; }
    tickSum += t + 1;
  }
  let shiftDeaths = 0; const shiftTicks = Math.round(12 * 3_600_000 / TICK_MS);
  for (let r = 0; r < shifts; r++) {
    const c = prep(10_000 + r, zoneId); const io: TickIO = { flags: new Set(), log: () => {} };
    for (let t = 0; t < shiftTicks; t++) { worldTick(c, io); if (io.flags.has('death')) { shiftDeaths++; break; } }
  }
  return { perExpedition: deaths / expeditions, per12h: shiftDeaths / shifts, avgTicks: tickSum / expeditions };
}

// ---------- player actions ----------
export function canAfford(s: Save, c: { bits: number; shards: number }) { return s.wallet.bits >= c.bits && s.wallet.shards >= c.shards; }
export function pay(s: Save, c: { bits: number; shards: number }) { s.wallet.bits -= c.bits; s.wallet.shards -= c.shards; }
export function upgradeLab(s: Save, id: LabId): boolean { const lvl = s.lab[id]; if (lvl >= LAB_MAX) return false; const c = labCost(lvl); if (!canAfford(s, c)) return false; pay(s, c); s.lab[id]++; return true; }
export function craftModule(s: Save, id: string): boolean { const m = MODULE_BY_ID[id]; if (s.owned.includes(id) || m.tier > maxTier(s)) return false; const c = MODULE_CRAFT_COST[m.tier]; if (!canAfford(s, c)) return false; pay(s, c); s.owned.push(id); return true; }
export function trainCost(v: number) { return { bits: 150 + v * v * 20, shards: Math.max(1, Math.floor(v / 3)) }; }
export function collectChest(s: Save) { const got = { bits: s.chest.bits, shards: s.chest.shards }; s.wallet.bits += got.bits; s.wallet.shards += got.shards; s.chest.bits = 0; s.chest.shards = 0; s.chest.ticks = 0; return got; }
export function fastRewardAvailable(s: Save) { return s.fastRewardDay !== dayIndex(now(s)); }
export { FALLEN_WINDOW_MS, TERMS_VERSION, ARCHETYPES };
export function arenaDuel(s: Save, rivalId: string): { won: boolean; delta: number; rounds: string[] } {
  const k = s.kin!; const r = s.rivals.find((x) => x.id === rivalId)!; const rng = new Rng(s.seed ^ 0xa11ce);
  const kp = derive(s, k).combat, rp = rivalPower(r);
  let kw = 0, rw = 0; const rounds: string[] = [];
  for (let i = 0; i < 3 && kw < 2 && rw < 2; i++) { if (rng.chance(winProb(kp, rp))) { kw++; rounds.push(`R${i + 1}: ${k.name} takes it`); } else { rw++; rounds.push(`R${i + 1}: ${r.name} takes it`); } }
  const won = kw > rw; const exp = 1 / (1 + Math.pow(10, (r.rating - s.rating) / 400)); const delta = Math.round(32 * ((won ? 1 : 0) - exp));
  s.rating += delta; r.rating -= delta; s.seed = rng.s;
  return { won, delta, rounds };
}
