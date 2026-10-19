// Standing Orders: short player text parsed into a constrained rule structure (design §3).
// Free text never reaches the sim directly; only the parsed rules do.
export interface ParsedOrders {
  noLethal: boolean; safeOnly: boolean; retreatHp: number; noRetreat: boolean;
  lootFirst: boolean; xpFirst: boolean; avoidFights: boolean; explorer: boolean; talkFirst: boolean;
  chips: string[]; unparsed: string[];
}
export const DEFAULT_ORDERS = 'Never enter Lethal activities\nRetreat below 30% HP\nPrioritize loot';
export const MAX_ORDERS = 5;
export const MAX_ORDER_LEN = 60;

export function parseOrders(text: string): ParsedOrders {
  const o: ParsedOrders = { noLethal: false, safeOnly: false, retreatHp: 0.3, noRetreat: false, lootFirst: false, xpFirst: false, avoidFights: false, explorer: false, talkFirst: false, chips: [], unparsed: [] };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX_ORDERS);
  for (const raw of lines) {
    const l = raw.toLowerCase().slice(0, MAX_ORDER_LEN);
    let hit = false;
    if (/(never|don'?t|do not|no)\b.*\blethal/.test(l) || /avoid\b.*\blethal/.test(l)) { o.noLethal = true; o.chips.push('⛔ No Lethal zones'); hit = true; }
    if (/(safe only|stay safe|only safe|avoid perilous|never.*perilous)/.test(l)) { o.safeOnly = true; o.noLethal = true; o.chips.push('🟢 Safe zones only'); hit = true; }
    const m = l.match(/(retreat|fall back|run|disengage|flee)\D*(\d{1,2})\s*%/);
    if (m) { o.retreatHp = Math.min(0.8, Math.max(0.05, +m[2] / 100)); o.chips.push(`↩ Retreat < ${m[2]}% HP`); hit = true; }
    if (/(never retreat|fight to the (end|death)|no retreat|never run)/.test(l)) { o.noRetreat = true; o.chips.push('☠ Never retreat'); hit = true; }
    if (/(loot|bits|salvage|money|scaveng)/.test(l) && /(priorit|focus|maximi|farm|first)/.test(l)) { o.lootFirst = true; o.chips.push('¤ Loot first'); hit = true; }
    if (/(xp|experience|level|train|learn)/.test(l) && /(priorit|focus|maximi|farm|first)/.test(l)) { o.xpFirst = true; o.chips.push('▲ XP first'); hit = true; }
    if (/(avoid (fights|combat)|pacifist|no fighting|don'?t fight)/.test(l)) { o.avoidFights = true; o.chips.push('☮ Avoid fights'); hit = true; }
    if (/(explore|map|scout|discover)/.test(l)) { o.explorer = true; o.chips.push('⌖ Explore'); hit = true; }
    if (/(talk|negotiat|diplomac|peaceful|parley)/.test(l)) { o.talkFirst = true; o.chips.push('☍ Talk first'); hit = true; }
    if (!hit) o.unparsed.push(raw);
  }
  if (o.noRetreat) o.retreatHp = 0;
  return o;
}
export function estimateTokens(text: string) { return Math.ceil(text.length / 4); }
