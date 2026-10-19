import { ATTRS, Attr, ArchetypeId, LabId, RIVALS, TICK_MS, FALLEN_WINDOW_MS, DAY_MS } from './data';

export type KinStatus = 'lab' | 'deployed' | 'fallen';
export interface Kin {
  id: string; name: string; arch: ArchetypeId; attrs: Record<Attr, number>;
  bold: number; // 0 careful .. 100 bold
  orders: string; modules: string[]; // equipped
  level: number; xp: number; hp: number;
  status: KinStatus; zone: string | null; target: string; // zone id or 'auto'
  deathWard: boolean; reviveTokens: number;
  fallenAt?: number; fallenZone?: string; rescue?: { progress: number; need: number; attempt: number };
  memory: Record<string, number>; // tactical memory: encounter-type repeats
  stats: { fights: number; wins: number; caches: number; events: number; deaths: number; revives: number; bestZone: number };
  consent: { at: number; terms: string; typedName: string };
  createdAt: number; lastLight: string[];
}
export interface JournalEntry { t: number; text: string; kind: 'combat' | 'loot' | 'sysop' | 'death' | 'level' | 'lab' | 'move' | 'away' | 'rescue' | 'think' }
export interface WorldEvent { id: string; type: string; zone: string; startsAt: number; endsAt: number; title: string; text: string; announced: boolean }
export interface Rival { id: string; name: string; arch: ArchetypeId; owner: string; level: number; rating: number; power: number; growth: number; status: 'alive' | 'fallen'; xp: number }
export interface Tombstone { kinId: string; deletedAt: number; consentAt: number; terms: string; rating: number; level: number }
export interface Save {
  v: number; seed: number;
  debugOffset: number; speed: number; brain: 'instinct' | 'stub' | 'ollama';
  kin: Kin | null; owned: string[];
  lab: Record<LabId, number>;
  wallet: { bits: number; shards: number };
  chest: { bits: number; shards: number; ticks: number };
  fastRewardDay: number;
  journal: JournalEntry[];
  events: WorldEvent[]; nextEventTick: number; tickCount: number;
  lastTickAt: number; rating: number;
  rivals: Rival[]; tombstones: Tombstone[];
  lastThought?: { at: number; provider: string; options: { a: string; s: number }[]; chosen: string; why: string; promptTokens: number; prompt?: string };
}
const KEY = 'neurokin.save.v1';

export function now(s: Save) { return Date.now() + s.debugOffset; }
export function tickMs(s: Save) { return TICK_MS / s.speed; }

export function freshSave(): Save {
  const t = Date.now();
  return {
    v: 1, seed: (t ^ 0x5eed) >>> 0, debugOffset: 0, speed: 1, brain: 'instinct',
    kin: null, owned: [], lab: { compiler: 1, simdeck: 1, memory: 1, cryo: 1 },
    wallet: { bits: 400, shards: 10 }, chest: { bits: 0, shards: 0, ticks: 0 }, fastRewardDay: -1,
    journal: [], events: [], nextEventTick: 6, tickCount: 0, lastTickAt: t, rating: 1000,
    rivals: RIVALS.map((r, i) => ({ id: r.id, name: r.name, arch: r.arch, owner: r.owner, level: 3 + i, rating: 1040 + (4 - i) * 22 + i * 3, power: r.power, growth: r.growth, status: 'alive', xp: 0 })),
    tombstones: [],
  };
}
export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw) as Save; if (s.v === 1) return s; }
  } catch { /* corrupted save -> fresh */ }
  return freshSave();
}
export function persist(s: Save) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('save failed', e); }
}
export function wipe() { localStorage.removeItem(KEY); }

export function newKin(p: { name: string; arch: ArchetypeId; attrs: Record<Attr, number>; bold: number; orders: string; modules: string[]; typedName: string }, t: number): Kin {
  return {
    id: 'kin_' + Math.random().toString(36).slice(2, 10), name: p.name, arch: p.arch, attrs: { ...p.attrs }, bold: p.bold,
    orders: p.orders, modules: [...p.modules], level: 1, xp: 0, hp: 1, status: 'lab', zone: null, target: 'plaza',
    deathWard: false, reviveTokens: 0, memory: {}, stats: { fights: 0, wins: 0, caches: 0, events: 0, deaths: 0, revives: 0, bestZone: 1 },
    consent: { at: t, terms: '', typedName: p.typedName }, createdAt: t, lastLight: [],
  };
}
export const emptyAttrs = () => Object.fromEntries(ATTRS.map((a) => [a, 0])) as Record<Attr, number>;
export function fallenDeadline(k: Kin) { return (k.fallenAt ?? 0) + FALLEN_WINDOW_MS; }
export function dayIndex(t: number) { return Math.floor(t / DAY_MS); }
