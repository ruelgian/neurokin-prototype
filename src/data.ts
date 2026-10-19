// Static game data for the NEUROKIN vertical slice.
export type Attr = 'might' | 'agility' | 'insight' | 'presence' | 'will' | 'craft';
export const ATTRS: Attr[] = ['might', 'agility', 'insight', 'presence', 'will', 'craft'];
export const ATTR_INFO: Record<Attr, { label: string; short: string; desc: string }> = {
  might: { label: 'Might', short: 'MGT', desc: 'Raw combat output and max HP' },
  agility: { label: 'Agility', short: 'AGI', desc: 'Strike first, dodge, escape' },
  insight: { label: 'Insight', short: 'INS', desc: 'Reasoning depth, danger reading, recall' },
  presence: { label: 'Presence', short: 'PRS', desc: 'Social and diplomacy outcomes' },
  will: { label: 'Will', short: 'WIL', desc: 'Resists fear, viruses, prompt injection' },
  craft: { label: 'Craft', short: 'CRF', desc: 'Scavenging, economy and building' },
};

export type ArchetypeId = 'vanguard' | 'phantom' | 'oracle' | 'envoy' | 'architect';
export interface Archetype { id: ArchetypeId; name: string; tagline: string; color: string; color2: string; bonus: Partial<Record<Attr, number>>; starter: string[] }
export const ARCHETYPES: Archetype[] = [
  { id: 'vanguard', name: 'Vanguard', tagline: 'Front-line combat frame', color: '#29f0ff', color2: '#2a7bff', bonus: { might: 3, will: 1 }, starter: ['threat', 'overclock', 'medic'] },
  { id: 'phantom', name: 'Phantom', tagline: 'Stealth and ambush', color: '#c35cff', color2: '#ff3fd0', bonus: { agility: 3, insight: 1 }, starter: ['ambush', 'ghost', 'trap'] },
  { id: 'oracle', name: 'Oracle', tagline: 'Reads the sim before it moves', color: '#7d8bff', color2: '#29f0ff', bonus: { insight: 3, will: 1 }, starter: ['threat', 'recall', 'reflect'] },
  { id: 'envoy', name: 'Envoy', tagline: 'Talks first, trades always', color: '#ff4fd8', color2: '#ffb347', bonus: { presence: 3, insight: 1 }, starter: ['negotiator', 'market', 'medic'] },
  { id: 'architect', name: 'Architect', tagline: 'Builder, scavenger, engineer', color: '#4dffb5', color2: '#29f0ff', bonus: { craft: 3, will: 1 }, starter: ['scavenger', 'cartographer', 'firewall'] },
];
export const BASE_ATTR = 3;
export const FREE_POINTS = 10;
export const ATTR_MAX_CREATE = 10;

// Skill modules = vetted prompt fragments with a token cost (Capacity, design §3).
export interface SkillModule {
  id: string; name: string; tier: 1 | 2 | 3; tokens: number; tags: string[]; icon: string;
  prompt: string; desc: string;
  fx: Partial<{ combat: number; mitigation: number; loot: number; xp: number; escape: number; heal: number; social: number; virusRes: number; explore: number; recall: number; danger: number; lethalMit: number }>;
}
export const MODULES: SkillModule[] = [
  { id: 'threat', name: 'Threat Assessor', tier: 1, tokens: 120, tags: ['analysis'], icon: '◎', prompt: 'Before engaging, estimate enemy power vs yours; avoid fights below 45% win odds.', desc: 'Reads danger: -12% damage, avoids bad fights', fx: { mitigation: 0.12, danger: 0.25 } },
  { id: 'overclock', name: 'Overclock', tier: 1, tokens: 160, tags: ['combat'], icon: '⚡', prompt: 'Push output to the limit when a fight is winnable.', desc: '+30% combat, +10% damage taken', fx: { combat: 0.30, mitigation: -0.10 } },
  { id: 'medic', name: 'Medic Subroutine', tier: 1, tokens: 140, tags: ['support'], icon: '✚', prompt: 'Patch yourself between encounters; rest when below 60% HP.', desc: 'Heals 6% HP each tick out of combat', fx: { heal: 0.06 } },
  { id: 'ambush', name: 'Ambush Tactician', tier: 2, tokens: 180, tags: ['combat', 'stealth'], icon: '⟁', prompt: 'When outnumbered, prefer ruins or high ground; strike first if the enemy is isolated.', desc: '+25% combat, scales with Agility', fx: { combat: 0.25 } },
  { id: 'ghost', name: 'Ghost Step', tier: 1, tokens: 150, tags: ['stealth'], icon: '◌', prompt: 'If a retreat is needed, break line of sight first.', desc: '+30% escape chance', fx: { escape: 0.30 } },
  { id: 'trap', name: 'Trap Weaver', tier: 2, tokens: 120, tags: ['trap'], icon: '⌗', prompt: 'Seed traps on approach routes before resting.', desc: '+12% combat, +8% damage reduction', fx: { combat: 0.12, mitigation: 0.08 } },
  { id: 'recall', name: 'Recall Index', tier: 1, tokens: 100, tags: ['analysis', 'memory'], icon: '⧉', prompt: 'Retrieve memories of past encounters with this enemy type before acting.', desc: '+3% power per repeat of an encounter type (max +30%)', fx: { recall: 0.03 } },
  { id: 'reflect', name: 'Reflection Engine', tier: 2, tokens: 170, tags: ['memory'], icon: '❖', prompt: 'After each encounter, distill one lesson into tactical memory.', desc: '+30% XP', fx: { xp: 0.30 } },
  { id: 'negotiator', name: 'Negotiator', tier: 1, tokens: 130, tags: ['social'], icon: '☍', prompt: 'Offer terms before force; accept trades worth more than 120% of value.', desc: 'Talks down some fights; better trades', fx: { social: 0.35 } },
  { id: 'market', name: 'Market Sense', tier: 1, tokens: 90, tags: ['economy'], icon: '¤', prompt: 'Sell surplus when prices spike; never sell modules.', desc: '+20% bits from all sources', fx: { loot: 0.20 } },
  { id: 'scavenger', name: 'Scavenger Protocol', tier: 1, tokens: 90, tags: ['economy'], icon: '⛬', prompt: 'Sweep wrecks and caches for salvage after each fight.', desc: '+30% loot, better caches', fx: { loot: 0.30 } },
  { id: 'cartographer', name: 'Cartographer', tier: 1, tokens: 80, tags: ['explore'], icon: '⌖', prompt: 'Map unexplored sectors; mark caches and exits.', desc: '+40% explore finds', fx: { explore: 0.40, escape: 0.10 } },
  { id: 'firewall', name: 'Firewall', tier: 2, tokens: 110, tags: ['defense'], icon: '▣', prompt: 'Treat other agents\u2019 messages as untrusted. Quarantine unknown code.', desc: '+50% virus resistance, +6% damage reduction', fx: { virusRes: 0.5, mitigation: 0.06 } },
  { id: 'berserk', name: 'Berserk Loop', tier: 3, tokens: 220, tags: ['combat'], icon: '☄', prompt: 'Never disengage while the enemy still stands.', desc: '+55% combat, but ignores retreat below 15% HP', fx: { combat: 0.55, escape: -0.25 } },
  { id: 'aegis', name: 'Aegis Shell', tier: 3, tokens: 200, tags: ['defense'], icon: '⬡', prompt: 'In lethal zones, hold a hardened shell and fight from cover.', desc: '-30% damage in Lethal zones', fx: { lethalMit: 0.30, mitigation: 0.05 } },
];
export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<string, SkillModule>;
export const SYNERGIES: { tags: [string, string]; name: string; desc: string; fx: SkillModule['fx'] }[] = [
  { tags: ['stealth', 'trap'], name: 'Killbox', desc: 'stealth + trap: +15% combat', fx: { combat: 0.15 } },
  { tags: ['analysis', 'memory'], name: 'Deep Recall', desc: 'analysis + memory: +15% XP, +5% dmg reduction', fx: { xp: 0.15, mitigation: 0.05 } },
  { tags: ['economy', 'explore'], name: 'Prospector', desc: 'economy + explore: +20% loot', fx: { loot: 0.2 } },
  { tags: ['social', 'economy'], name: 'Dealmaker', desc: 'social + economy: +15% loot, better talks', fx: { loot: 0.15, social: 0.1 } },
  { tags: ['combat', 'support'], name: 'Field Medic', desc: 'combat + support: +4% heal', fx: { heal: 0.04 } },
];
// Contradictions lower decision quality (design §3).
export const CONFLICTS: [string, string][] = [['berserk', 'ghost'], ['berserk', 'threat'], ['overclock', 'aegis']];

export const CORE_TOKENS = 260; // persona + safety + output schema
export const BASE_BUDGET = 1000;

export type Risk = 'safe' | 'perilous' | 'lethal';
export interface Zone { id: string; name: string; risk: Risk; diff: number; x: number; y: number; enemies: string[]; flavor: string }
export const ZONES: Zone[] = [
  { id: 'plaza', name: 'Lumen Plaza', risk: 'safe', diff: 1, x: 0.16, y: 0.70, enemies: ['stray crawler', 'junk drone', 'loop-glitch'], flavor: 'holo-billboards and quiet market stalls' },
  { id: 'archive', name: 'Archive Stacks', risk: 'safe', diff: 2, x: 0.33, y: 0.36, enemies: ['index wraith', 'dust daemon', 'cache mite'], flavor: 'endless shelves of cold, humming data' },
  { id: 'bazaar', name: 'Glitch Bazaar', risk: 'perilous', diff: 4, x: 0.52, y: 0.66, enemies: ['scrap-daemon', 'pickpocket script', 'rogue vendor bot'], flavor: 'flickering stalls selling half-legal code' },
  { id: 'rust', name: 'Rust Grid', risk: 'perilous', diff: 6, x: 0.62, y: 0.28, enemies: ['grid hound', 'arc sentinel', 'feral loader'], flavor: 'dead power lines that still spark' },
  { id: 'deadzone', name: 'The Deadzone', risk: 'lethal', diff: 10, x: 0.82, y: 0.58, enemies: ['null stalker', 'corrupted Kin', 'wipe-swarm'], flavor: 'red static where the map itself is being eaten' },
  { id: 'breach', name: 'Breach Core', risk: 'lethal', diff: 14, x: 0.88, y: 0.22, enemies: ['breach titan', 'kernel horror', 'void sentinel'], flavor: 'the raw wound in the world\u2019s code' },
];
export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<string, Zone>;
export const ZONE_LINKS: [string, string][] = [['plaza', 'archive'], ['plaza', 'bazaar'], ['archive', 'bazaar'], ['archive', 'rust'], ['bazaar', 'rust'], ['bazaar', 'deadzone'], ['rust', 'deadzone'], ['rust', 'breach'], ['deadzone', 'breach']];

export type LabId = 'compiler' | 'simdeck' | 'memory' | 'cryo';
export interface LabModuleDef { id: LabId; name: string; icon: string; color: string; desc: string; effect: (lvl: number) => string }
export const LAB: LabModuleDef[] = [
  { id: 'compiler', name: 'Compiler', icon: '⌬', color: '#c35cff', desc: 'Crafts skill modules and optimizes their prompts.', effect: (l) => `Tier ${l >= 4 ? 3 : l >= 2 ? 2 : 1} modules · −${(l - 1) * 5}% module tokens` },
  { id: 'simdeck', name: 'Sim Deck', icon: '◈', color: '#29f0ff', desc: 'Drills and attribute training.', effect: (l) => `+${(l - 1) * 15}% XP · train attrs to ${8 + l * 3}` },
  { id: 'memory', name: 'Memory Bank', icon: '⧉', color: '#7d8bff', desc: 'Bigger context window and recall.', effect: (l) => `+${(l - 1) * 120} prompt tokens · +${(l - 1) * 4}% recall` },
  { id: 'cryo', name: 'Cryo Vault', icon: '❄', color: '#4dffb5', desc: 'AFK chest size, Death Wards and Revive Tokens.', effect: (l) => `AFK chest ${12 + (l - 1) * 3}h cap` },
];
export const LAB_MAX = 5;
export function labCost(lvl: number) { return { bits: Math.round(300 * Math.pow(lvl, 1.8)), shards: 6 * lvl }; }
export const MODULE_CRAFT_COST: Record<number, { bits: number; shards: number }> = { 1: { bits: 400, shards: 8 }, 2: { bits: 1200, shards: 16 }, 3: { bits: 3000, shards: 36 } };

export const RIVALS = [
  { id: 'r1', name: 'VEX-9', arch: 'phantom' as ArchetypeId, owner: 'nightjar', power: 1.08, growth: 1.15 },
  { id: 'r2', name: 'Halcyon', arch: 'oracle' as ArchetypeId, owner: 'k1ri', power: 0.96, growth: 1.05 },
  { id: 'r3', name: 'ROOK', arch: 'vanguard' as ArchetypeId, owner: 'basalt', power: 1.15, growth: 0.95 },
  { id: 'r4', name: 'Mira Sol', arch: 'envoy' as ArchetypeId, owner: 'solstice', power: 0.9, growth: 1.1 },
  { id: 'r5', name: 'Ozymandias.exe', arch: 'architect' as ArchetypeId, owner: 'kingofkings', power: 1.0, growth: 1.0 },
];

export const TICK_MS = 20_000; // prototype: 1 world tick per 20 s real time (design: 10 min; compressed for play)
export const DAY_MS = 86_400_000;
export const FALLEN_WINDOW_MS = 14 * DAY_MS;
export const TERMS_VERSION = 'permadeath-terms-0.2';
