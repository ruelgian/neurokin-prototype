import './style.css';
import { ARCHETYPES, ATTRS, ATTR_INFO, Attr, ArchetypeId, BASE_ATTR, FREE_POINTS, ATTR_MAX_CREATE, MODULES, MODULE_BY_ID, LAB, LAB_MAX, labCost, MODULE_CRAFT_COST, ZONES, ZONE_BY_ID, TICK_MS, DAY_MS, TERMS_VERSION, CORE_TOKENS, LabId } from './data';
import { Save, load, persist, wipe, freshSave, now, tickMs, newKin, emptyAttrs, fallenDeadline, JournalEntry, dayIndex } from './state';
import * as Sim from './sim';
import { parseOrders, DEFAULT_ORDERS, estimateTokens, MAX_ORDERS, MAX_ORDER_LEN } from './orders';
import { Renderer, Scene, RISK_COLOR } from './render';
import { StubProvider, makeOllamaProvider, buildPrompt, decideWithTimeout, DecisionProvider } from './brain';

// ---------------- state ----------------
let S: Save = load();
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const app = $('#app'), hud = $('#hud'), rail = $('#rail'), panel = $('#panel'), overlay = $('#overlay'), toasts = $('#toasts'), dev = $('#dev');
const R = new Renderer($('#stage') as HTMLCanvasElement, () => S);
type Tab = 'lab' | 'world' | 'kin' | 'log' | 'rank' | 'fallen';
let tab: Tab = 'lab';
let draft = { step: 0, name: '', arch: 'vanguard' as ArchetypeId, alloc: emptyAttrs(), bold: 50, orders: DEFAULT_ORDERS, modules: [] as string[], agree: false, typed: '' };
let ollama = makeOllamaProvider(); let ollamaOk = false;
let pendingDeathFx = false;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (n: number) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.floor(n));
function dur(ms: number) { ms = Math.max(0, ms); const d = Math.floor(ms / DAY_MS), h = Math.floor(ms / 3.6e6) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1000) % 60; return d ? `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`; }
function toast(text: string, cls = '') { const el = document.createElement('div'); el.className = 'toast ' + cls; el.innerHTML = text; toasts.appendChild(el); setTimeout(() => el.remove(), 3100); while (toasts.children.length > 4) toasts.firstChild!.remove(); }
function journal(e: JournalEntry) { S.journal.unshift(e); const cap = 120 + (S.lab.memory - 1) * 40; if (S.journal.length > cap) S.journal.length = cap; }
const io = (): Sim.TickIO => ({ flags: new Set(), log: (e) => journal({ ...e, t: now(S) }) });
function save() { persist(S); }

// ---------------- loop ----------------
let busy = false, last = performance.now(), hudAt = 0, panelDirty = true;
async function pump() {
  if (busy) return;
  const t = now(S); const behind = t - S.lastTickAt;
  if (!S.kin) { S.lastTickAt = t; return; }
  const ex = io(); if (Sim.checkExpiry(S, ex)) { onFlags(ex.flags); save(); return; }
  if (behind > TICK_MS * 4) { away(behind); return; }
  let n = 0;
  while (now(S) - S.lastTickAt >= tickMs(S) && n < 4) { busy = true; try { await liveTick(); } finally { busy = false; } S.lastTickAt += tickMs(S); n++; }
  if (n) { save(); panelDirty = true; }
}
function provider(): DecisionProvider | null { return S.brain === 'stub' ? StubProvider : S.brain === 'ollama' && ollamaOk ? ollama : null; }
async function liveTick() {
  const e = io(); const p = provider(); let choose: ((o: Sim.Obs, opts: Sim.Option[]) => string | null) | undefined; let llm: { prompt: string; why: string } | null = null;
  if (p && S.kin?.status === 'deployed') {
    // Peek the next tick on a clone (deterministic seed => identical observation), ask the LLM only at decision points.
    const clone: Save = JSON.parse(JSON.stringify(S)); let cap: { obs: Sim.Obs; opts: Sim.Option[] } | null = null;
    Sim.worldTick(clone, { flags: new Set(), log: () => {} }, (obs, opts) => { if (obs.decisionPoint) cap = { obs, opts }; return null; });
    if (cap) {
      const c = cap as { obs: Sim.Obs; opts: Sim.Option[] };
      const prompt = buildPrompt(S, S.kin, c.obs, c.opts);
      const dec = await decideWithTimeout(p, { prompt, legal: c.obs.legal, options: c.opts }, S.brain === 'ollama' ? 8000 : 2000);
      if (dec) { choose = () => dec.action; llm = { prompt, why: dec.rationale }; } else llm = { prompt, why: 'timeout/invalid → instinct fallback' };
    }
  }
  Sim.worldTick(S, e, choose);
  if (llm && S.lastThought) { S.lastThought.prompt = llm.prompt; S.lastThought.why = llm.why; if (!choose) S.lastThought.provider = 'instinct (fallback)'; }
  onFlags(e.flags);
}
function onFlags(f: Set<string>) {
  if (f.has('levelup')) toast(`▲ <b>${esc(S.kin?.name ?? '')}</b> reached level <b>${S.kin?.level}</b>`, 'v');
  if (f.has('thought') && S.lastThought) R.thought = { text: `${S.lastThought.provider.toUpperCase()} › ${S.lastThought.chosen.toUpperCase()} · ${S.lastThought.why}`.slice(0, 64), until: R.t + 3.2 };
  if (f.has('chestFull')) { if (!(window as any).__fullToast) { toast('AFK chest is full. Collect it in the Lab.', 'v'); (window as any).__fullToast = 1; } }
  if (f.has('ward')) toast('⬡ Death Ward triggered. Escaped at 1 HP.', 'v');
  if (f.has('revived')) { toast(`✚ <b>${esc(S.kin!.name)}</b> is back online`, 'v'); setTab('lab'); }
  if (f.has('rescueFail')) toast('Rescue failed. You can retry for free.', 'red');
  if (f.has('death')) deathSequence();
  if (f.has('deleted')) showDeleted();
  panelDirty = true;
}
function away(ms: number) {
  const wasFallen = S.kin?.status === 'fallen';
  const sum = Sim.catchUp(S, ms, journal);
  S.lastTickAt = now(S);
  if (sum.deleted) { save(); showDeleted(); return; }
  if (S.kin && sum.ticks > 0 && !wasFallen) journal({ t: now(S), kind: 'away', text: `While you were away (${dur(ms)}): ${S.kin.name} fought ${sum.fights} battles (${sum.wins} won), found ${sum.caches} caches${sum.levels ? `, gained ${sum.levels} level${sum.levels > 1 ? 's' : ''}` : ''} and filled the chest with ${sum.bits} bits${sum.shards ? ` + ${sum.shards} shards` : ''}.${sum.capped ? ' The chest hit its cap, so progress paused.' : ''}` });
  save(); panelDirty = true;
  if (sum.died) { pendingDeathFx = true; }
  welcomeBack(ms, sum, wasFallen);
}
function frame(t: number) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (t - last) / 1000)); last = t; // rAF time can precede performance.now() at boot
  try { R.scene = sceneFor(); R.frame(dt); } catch (e) { console.error('render', e); }
  pump().catch((e) => { busy = false; console.error('tick', e); });
  if (t - hudAt > 250) { hudAt = t; renderHud(); if (panelDirty && !editing()) { renderPanel(); panelDirty = false; } if (tab === 'fallen' && !editing()) renderPanel(); }
}
function editing() { const a = document.activeElement; return !!a && panel.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
function sceneFor(): Scene {
  if (!S.kin) return 'kin';
  if (tab === 'world') return 'world';
  if (tab === 'fallen') return 'fallen';
  if (tab === 'kin') return 'kin';
  return 'lab';
}

// ---------------- HUD + rail ----------------
function renderHud() {
  const k = S.kin;
  if (!k) { hud.innerHTML = `<span class="logo">NEUROKIN</span><span class="muted" style="margin-left:8px">// create your Kin</span><span class="grow"></span><button class="hudbtn ghost" data-act="dev">DEV</button>`; return; }
  const d = Sim.derive(S, k); const A = ARCHETYPES.find((a) => a.id === k.arch)!;
  const st = k.status === 'fallen' ? `<span class="chip warn">✖ FALLEN · ${dur(fallenDeadline(k) - now(S))}</span>` : k.status === 'deployed' ? `<span class="badge ${ZONE_BY_ID[k.zone!].risk}">${ZONE_BY_ID[k.zone!].name}</span>` : `<span class="badge safe">LAB</span>`;
  const chestPct = Math.min(100, (S.chest.ticks / Sim.chestCapTicks(S)) * 100);
  hud.innerHTML = `<span class="logo">NEUROKIN</span>
    <div class="kinchip"><span style="color:${A.color};font-size:15px">◆</span><span class="nm">${esc(k.name)}</span><span class="tiny">LV${k.level}</span>
      <div style="width:56px"><div class="bar hp"><i style="width:${Math.max(0, k.hp) * 100}%"></i></div><div class="bar" style="height:3px;margin-top:2px"><i style="width:${(k.xp / Sim.xpToNext(k.level)) * 100}%"></i></div></div>${st}</div>
    <span class="chip bits">¤ <b class="num">${fmt(S.wallet.bits)}</b></span><span class="chip shards">◆ <b class="num">${fmt(S.wallet.shards)}</b></span>
    <button class="hudbtn ${chestPct >= 100 ? '' : 'ghost'}" data-act="chest" title="AFK chest">▣ ${Math.floor(chestPct)}%</button>
    <button class="hudbtn ghost" data-act="dev">DEV${S.speed > 1 ? ' ×' + S.speed : ''}</button>`;
  void d;
}
function renderRail() {
  const k = S.kin; app.classList.toggle('create', !k);
  if (!k) { rail.innerHTML = ''; return; }
  const items: [Tab, string, string][] = k.status === 'fallen'
    ? [['fallen', '✖', 'FALLEN'], ['lab', '⌬', 'LAB'], ['log', '☰', 'LOG'], ['rank', '♛', 'RANK'], ['kin', '◆', 'KIN']]
    : [['lab', '⌬', 'LAB'], ['world', '⌖', 'WORLD'], ['kin', '◆', 'KIN'], ['log', '☰', 'LOG'], ['rank', '♛', 'RANK']];
  rail.innerHTML = items.map(([id, ic, lb]) => `<button class="rail-btn ${tab === id ? 'on' : ''} ${id === 'fallen' ? 'alert' : ''}" data-act="tab" data-arg="${id}"><span class="ic">${ic}</span>${lb}</button>`).join('');
}
function setTab(t: Tab) { tab = t; if (t !== 'world') R.selectedZone = null; renderRail(); panel.scrollTop = 0; renderPanel(); }

// ---------------- panels ----------------
function renderPanel() {
  const top = panel.scrollTop;
  if (!S.kin) panel.innerHTML = createPanel();
  else if (tab === 'lab') panel.innerHTML = labPanel();
  else if (tab === 'world') panel.innerHTML = worldPanel();
  else if (tab === 'kin') panel.innerHTML = kinPanel();
  else if (tab === 'log') panel.innerHTML = logPanel();
  else if (tab === 'rank') panel.innerHTML = rankPanel();
  else if (tab === 'fallen') panel.innerHTML = fallenPanel();
  panel.scrollTop = top;
}

function budgetBar(modules: string[], orders: string) {
  const b = Sim.budget(S); const ord = estimateTokens(orders); const mods = modules.reduce((a, id) => a + Sim.moduleTokens(S, id), 0); const used = CORE_TOKENS + ord + mods;
  const pc = (v: number) => (v / Math.max(b, used)) * 100;
  return `<div class="row sb tiny"><span>PROMPT BUDGET</span><span class="num" style="color:${used > b ? 'var(--lethal)' : '#fff'}">${used} / ${b} tokens</span></div>
    <div class="budget ${used > b ? 'over' : ''}"><i class="core" style="width:${pc(CORE_TOKENS)}%"></i><i class="ord" style="width:${pc(ord)}%"></i><i class="mods" style="width:${pc(mods)}%"></i></div>
    <div class="tiny" style="margin-top:3px"><span style="color:#8d92c8">■ core ${CORE_TOKENS}</span> · <span style="color:var(--violet)">■ orders ${ord}</span> · <span style="color:var(--cyan)">■ modules ${mods}</span></div>`;
}
function moduleGrid(owned: string[], equipped: string[], act: string) {
  return `<div class="grid2">${owned.map((id) => { const m = MODULE_BY_ID[id]; return `<div class="mod ${equipped.includes(id) ? 'on' : ''}" data-act="${act}" data-arg="${id}">
    <div class="mn"><span class="ic">${m.icon}</span>${m.name}<span class="tk">${Sim.moduleTokens(S, id)}t</span></div>
    <div class="tiny" style="color:#b9c6e8">${m.desc}</div><div>${m.tags.map((t) => `<span class="tag">${t}</span>`).join('')}<span class="tag c">T${m.tier}</span></div></div>`; }).join('')}</div>`;
}
function synergyLine(mods: string[]) {
  const fake = { ...(S.kin ?? newKin({ name: 'x', arch: draft.arch, attrs: emptyAttrs(), bold: 50, orders: '', modules: [], typedName: '' }, 0)), modules: mods };
  const d = Sim.derive(S, fake as any);
  return `${d.synergies.map((s) => `<span class="tag c">✦ ${s}</span>`).join('')}${d.conflicts.map((c) => `<span class="tag bad">⚠ ${c}: −12% decision quality</span>`).join('')}${!d.synergies.length && !d.conflicts.length ? '<span class="tiny">No synergies yet. Try pairing tags (stealth+trap, analysis+memory, economy+explore…)</span>' : ''}`;
}
function ordersChips(text: string) {
  const o = parseOrders(text);
  return `${o.chips.map((c) => `<span class="tag c">${c}</span>`).join('')}${o.unparsed.map((u) => `<span class="tag bad" title="not understood">? ${esc(u.slice(0, 24))}</span>`).join('')}`;
}

// ----- creation wizard -----
const STEPS = ['IDENTITY', 'ATTRIBUTES', 'STANDING ORDERS', 'LOADOUT', 'CONSENT'];
function draftAttrs() { const A = ARCHETYPES.find((a) => a.id === draft.arch)!; const o = {} as Record<Attr, number>; for (const a of ATTRS) o[a] = BASE_ATTR + (A.bonus[a] ?? 0) + draft.alloc[a]; return o; }
function pointsLeft() { return FREE_POINTS - ATTRS.reduce((a, k) => a + draft.alloc[k], 0); }
function createPanel() {
  const steps = `<div class="steps">${STEPS.map((_, i) => `<i class="${i <= draft.step ? 'on' : ''}"></i>`).join('')}</div>`;
  const A = ARCHETYPES.find((a) => a.id === draft.arch)!;
  let body = '';
  const nav = (ok: boolean, label = 'NEXT ›') => `<div class="row" style="margin-top:8px">${draft.step ? '<button class="btn ghost" data-act="cstep" data-arg="-1">‹ BACK</button>' : ''}<span class="grow"></span><button class="btn" data-act="cstep" data-arg="1" ${ok ? '' : 'disabled'}>${label}</button></div>`;
  if (draft.step === 0) {
    body = `<h2>FORGE A KIN <small>step 1/5 · ${STEPS[0]}</small></h2>
      <div class="card"><div class="tiny" style="margin-bottom:4px">DESIGNATION (2-16 chars)</div><input type="text" maxlength="16" data-in="name" value="${esc(draft.name)}" placeholder="e.g. NOVA-7, Echo, Wraith" autocomplete="off" spellcheck="false" /></div>
      <h3>ARCHETYPE</h3><div class="grid3">${ARCHETYPES.map((a) => `<div class="arch ${a.id === draft.arch ? 'on' : ''}" data-act="arch" data-arg="${a.id}"><b style="color:${a.color}">${a.name.toUpperCase()}</b><span>${a.tagline}</span><div class="tiny" style="color:${a.color2}">${Object.entries(a.bonus).map(([k, v]) => `+${v} ${ATTR_INFO[k as Attr].short}`).join(' ')}</div></div>`).join('')}</div>
      ${nav(draft.name.trim().length >= 2)}`;
  } else if (draft.step === 1) {
    const at = draftAttrs();
    body = `<h2>ATTRIBUTES <small>step 2/5 · ${pointsLeft()} points left</small></h2>
      <div class="card">${ATTRS.map((a) => `<div class="attr"><span class="ab">${ATTR_INFO[a].short}</span><div><div class="pip">${Array.from({ length: ATTR_MAX_CREATE }, (_, i) => `<i class="${i < at[a] - draft.alloc[a] ? 'b' : i < at[a] ? 'f' : ''}"></i>`).join('')}</div><div class="tiny">${ATTR_INFO[a].desc}</div></div>
        <button class="pm" data-act="attr" data-arg="${a}:-1">−</button><b class="num" style="text-align:center">${at[a]}</b><button class="pm" data-act="attr" data-arg="${a}:1">+</button></div>`).join('')}</div>
      <div class="card v"><div class="row sb tiny"><span>CAREFUL</span><span>PERSONALITY</span><span>BOLD</span></div><input type="range" min="0" max="100" value="${draft.bold}" data-in="bold" /><div class="tiny">Bold Kin take riskier fights and zones; careful Kin retreat early and live longer.</div></div>
      ${nav(pointsLeft() === 0, 'NEXT ›')}${pointsLeft() ? '<div class="tiny" style="text-align:right">spend all points to continue</div>' : ''}`;
  } else if (draft.step === 2) {
    body = `<h2>STANDING ORDERS <small>step 3/5 · up to ${MAX_ORDERS} lines</small></h2>
      <div class="card v"><textarea rows="5" data-in="orders" maxlength="${MAX_ORDERS * (MAX_ORDER_LEN + 1)}">${esc(draft.orders)}</textarea>
      <div class="tiny" style="margin:4px 0">Plain-language rules your Kin must obey. They're parsed into fixed rules (no prompt hacking) and cost prompt tokens.</div><div id="ochips">${ordersChips(draft.orders)}</div></div>
      <div class="card tiny">Try: <i>Retreat below 50% HP</i> · <i>Prioritize XP</i> · <i>Explore new sectors</i> · <i>Talk before fighting</i> · <i>Stay safe only</i>. New Kin start with <b>Never enter Lethal activities</b>; remove it on purpose to unlock Lethal zones.</div>
      ${nav(true)}`;
  } else if (draft.step === 3) {
    const owned = starterOwned();
    const used = Sim.tokensUsed(S, draft.modules, draft.orders);
    body = `<h2>LOADOUT <small>step 4/5 · equip skill modules</small></h2>
      <div class="card">${budgetBar(draft.modules, draft.orders)}<div style="margin-top:5px">${synergyLine(draft.modules)}</div></div>
      ${moduleGrid(owned, draft.modules, 'cmod')}
      ${nav(used <= Sim.budget(S) && draft.modules.length > 0)}`;
  } else {
    const ok = draft.agree && draft.typed.trim() === draft.name.trim();
    body = `<h2 style="color:var(--lethal);text-shadow:0 0 10px var(--lethal)">PERMADEATH CONSENT <small>step 5/5 · required</small></h2>
      <div class="consent"><b>Read this before ${esc(draft.name)} comes online.</b><br/>If your Kin dies and isn't revived within <b>14 days</b>, it and everything it knows about you, including your chats and memories, will be <b>permanently deleted</b>. Nobody, including us, can restore it.<br/><br/>
      Your Kin can only die in <span class="badge lethal">LETHAL</span> activities (or <span class="badge perilous">PERILOUS</span> ones if you order it never to retreat). <span class="badge safe">SAFE</span> activities can never kill it. You can export your Kin at any time.</div>
      <label class="check"><input type="checkbox" data-in="agree" ${draft.agree ? 'checked' : ''}/> <span>I understand that my Kin can be permanently deleted, and I accept this rule.</span></label>
      <div class="tiny" style="margin-bottom:4px">Type <b style="color:#fff">${esc(draft.name)}</b> to confirm</div><input type="text" data-in="typed" value="${esc(draft.typed)}" autocomplete="off" spellcheck="false" />
      <div class="row" style="margin-top:8px"><button class="btn ghost" data-act="cstep" data-arg="-1">‹ BACK</button><span class="grow"></span><button class="btn v" data-act="createKin" ${ok ? '' : 'disabled'}>BRING ${esc(draft.name.toUpperCase())} ONLINE</button></div>
      <div class="tiny" style="margin-top:6px">Consent record stored: timestamp + terms version <span class="num">${TERMS_VERSION}</span>.</div>`;
  }
  void A;
  return steps + body;
}
function starterOwned() { const A = ARCHETYPES.find((a) => a.id === draft.arch)!; return [...new Set([...A.starter, 'scavenger', 'threat', 'cartographer'])]; }

// ----- LAB -----
function labPanel() {
  const cap = Sim.chestCapTicks(S); const pct = Math.min(100, (S.chest.ticks / cap) * 100); const capH = 12 + (S.lab.cryo - 1) * 3;
  const fr = Sim.fastRewardAvailable(S);
  return `<h2>THE LAB <small>account-level · survives permadeath</small></h2>
    <div class="card v"><div class="row sb"><b style="font:700 11px var(--font-d);letter-spacing:.1em">▣ AFK CHEST</b><span class="tiny">${capH}h cap · ${dur((S.chest.ticks) * TICK_MS)} stored</span></div>
      <div class="bar ${pct >= 100 ? 'full' : ''}" style="margin:6px 0"><i style="width:${pct}%"></i></div>
      <div class="row"><span class="chip bits">¤ <b class="num">${fmt(S.chest.bits)}</b></span><span class="chip shards">◆ <b class="num">${S.chest.shards}</b></span><span class="grow"></span>
      <button class="btn sm ghost" data-act="fast" ${fr && S.kin?.status !== 'fallen' ? '' : 'disabled'} title="Instantly simulate 2h, once per day">⚡ FAST 2H</button><button class="btn sm v" data-act="collect" ${S.chest.bits + S.chest.shards ? '' : 'disabled'}>COLLECT</button></div></div>
    ${LAB.map((l) => { const lvl = S.lab[l.id]; const c = labCost(lvl); const max = lvl >= LAB_MAX; return `<div class="card" style="border-color:${l.color}55">
      <div class="row"><span style="font-size:18px;color:${l.color};text-shadow:0 0 8px ${l.color}">${l.icon}</span><div class="grow"><b style="font:700 11px var(--font-d);letter-spacing:.08em">${l.name.toUpperCase()}</b> <span class="tiny">LV ${lvl}/${LAB_MAX}</span><div class="tiny">${l.effect(lvl)}${max ? '' : ` <span style="color:${l.color}">→ ${l.effect(lvl + 1)}</span>`}</div></div>
      ${max ? '<span class="tiny">MAX</span>' : `<button class="btn sm" data-act="upgrade" data-arg="${l.id}" ${Sim.canAfford(S, c) ? '' : 'disabled'}>▲ ${c.bits}¤ ${c.shards}◆</button>`}</div>
      ${labExtra(l.id)}</div>`; }).join('')}`;
}
function labExtra(id: LabId) {
  const k = S.kin;
  if (id === 'compiler') { const n = MODULES.filter((m) => !S.owned.includes(m.id) && m.tier <= Sim.maxTier(S)).length; return `<div class="row" style="margin-top:5px"><span class="tiny grow">${S.owned.length}/${MODULES.length} modules owned · ${n} craftable now</span><button class="btn sm ghost" data-act="craftMenu" ${k ? '' : 'disabled'}>CRAFT</button></div>`; }
  if (id === 'simdeck') return `<div class="row" style="margin-top:5px"><span class="tiny grow">Train attributes up to ${Sim.attrCap(S)}</span><button class="btn sm ghost" data-act="trainMenu" ${k && k.status !== 'fallen' ? '' : 'disabled'}>TRAIN</button></div>`;
  if (id === 'cryo') { const rc = k ? Sim.reviveTokenCost(k) : { bits: 0, shards: 0 }; return `<div class="row" style="margin-top:5px;flex-wrap:wrap;gap:5px"><span class="tiny grow">Tokens: <b>${k?.reviveTokens ?? 0}</b> · Ward: <b>${k?.deathWard ? 'equipped' : 'none'}</b></span>
      <button class="btn sm ghost" data-act="forgeToken" ${k && Sim.canAfford(S, rc) ? '' : 'disabled'}>REVIVE TOKEN ${rc.bits}¤ ${rc.shards}◆</button>
      <button class="btn sm ghost" data-act="forgeWard" ${k && !k.deathWard && k.status !== 'fallen' && S.lab.cryo >= 2 && Sim.canAfford(S, Sim.DEATH_WARD_COST) ? '' : 'disabled'} title="needs Cryo Vault LV2">DEATH WARD ${Sim.DEATH_WARD_COST.bits}¤ ${Sim.DEATH_WARD_COST.shards}◆</button></div>`; }
  return `<div class="tiny" style="margin-top:4px">Journal keeps ${120 + (S.lab.memory - 1) * 40} entries · Recall Index works better</div>`;
}

// ----- WORLD -----
function worldPanel() {
  const k = S.kin!; const d = Sim.derive(S, k);
  const live = S.events.filter((e) => e.endsAt > S.tickCount);
  const sel = R.selectedZone;
  const zoneRows = [{ id: 'auto', name: 'Auto · Kin chooses', risk: '' }, ...ZONES, { id: 'hold', name: 'Hold at Lab', risk: '' }].map((z: any) => {
    const blocked = z.risk && !Sim.zoneAllowed(d.orders, z);
    return `<div class="zone-opt ${k.target === z.id ? 'on' : ''} ${blocked ? 'blocked' : ''}" data-act="target" data-arg="${z.id}">${z.risk ? `<span class="badge ${z.risk}">${z.risk.toUpperCase()}</span>` : '<span class="badge" style="color:var(--cyan)">AI</span>'}<span class="grow">${z.name}${z.diff ? ` <span class="tiny">· diff ${z.diff}</span>` : ''}</span>${blocked ? '<span class="tiny" style="color:var(--lethal)">⛔ order</span>' : k.target === z.id ? '<span class="tiny" style="color:var(--cyan)">TARGET</span>' : ''}</div>`;
  }).join('');
  const th = S.lastThought;
  return `<h2>DEPLOYMENT <small>tick #${S.tickCount} · ${(tickMs(S) / 1000).toFixed(1)}s/tick</small></h2>
    <div class="card"><div class="row sb"><span>${k.status === 'deployed' ? `Acting autonomously in <b>${ZONE_BY_ID[k.zone!].name}</b>` : k.target === 'hold' ? 'Holding at the Lab' : 'At the Lab, repairing. Redeploys at 95% HP'}</span><span class="tiny num">HP ${Math.round(k.hp * 100)}%</span></div>
      <div class="bar hp" style="margin:5px 0"><i style="width:${k.hp * 100}%"></i></div>
      <div class="row"><span class="tiny grow">Power ${d.combat.toFixed(0)} · Retreat < ${Math.round(d.orders.retreatHp * 100)}% ${k.deathWard ? '· ⬡ Ward' : ''}</span>${k.status === 'deployed' ? '<button class="btn sm red" data-act="recall">RECALL</button>' : ''}</div></div>
    ${sel ? zoneCard(sel) : '<div class="tiny" style="margin:-2px 0 6px">Tap a zone on the map for intel.</div>'}
    <h3>TARGET</h3>${zoneRows}
    <h3>SYSOP // LIVE EVENTS</h3>${live.length ? live.map((e) => `<div class="card v"><div class="row sb"><b style="font-size:11px">${e.startsAt > S.tickCount ? '⏳' : '●'} ${e.title}</b><span class="badge ${ZONE_BY_ID[e.zone].risk}">${ZONE_BY_ID[e.zone].name}</span></div><div class="tiny">${e.text} ${e.startsAt > S.tickCount ? `Opens in ${e.startsAt - S.tickCount} ticks.` : `${e.endsAt - S.tickCount} ticks left.`}</div></div>`).join('') : '<div class="tiny">SYSOP is quiet. Next broadcast soon.</div>'}
    <h3>THOUGHT TRACE</h3>${th ? `<div class="card thought"><div class="row sb"><span style="color:var(--mag)">${th.provider.toUpperCase()}</span><span>→ <b style="color:#fff">${th.chosen.toUpperCase()}</b></span></div>
      ${th.options.map((o) => `<div class="opt"><span style="width:58px">${o.a}</span><div class="bar"><i style="width:${Math.max(4, Math.min(100, o.s * 40))}%"></i></div><span>${o.s}</span></div>`).join('')}
      <div style="color:#b9c6e8;margin-top:3px">${esc(th.why)}</div><div class="tiny">${th.promptTokens} prompt tokens</div>${th.prompt ? `<details><summary class="tiny">prompt sent</summary><pre style="white-space:pre-wrap;font-size:9px;color:#9fb">${esc(th.prompt)}</pre></details>` : ''}</div>` : '<div class="tiny">No decision points yet.</div>'}`;
}
function zoneCard(id: string) {
  const z = ZONE_BY_ID[id]; const k = S.kin!; const d = Sim.derive(S, k); const allowed = Sim.zoneAllowed(d.orders, z);
  return `<div class="card" style="border-color:${RISK_COLOR[z.risk]}88"><div class="row sb"><b style="font:700 11px var(--font-d)">${z.name.toUpperCase()}</b><span class="badge ${z.risk}">${z.risk.toUpperCase()}</span></div>
    <div class="tiny">${z.flavor}. Difficulty ${z.diff}. ${z.risk === 'safe' ? 'Your Kin cannot die here.' : z.risk === 'perilous' ? 'Knock-outs only, unless orders say never retreat.' : 'Your Kin CAN die here.'}</div>
    <div class="row" style="margin-top:5px"><span class="tiny grow">Enemies: ${z.enemies.join(', ')}</span><button class="btn sm ${z.risk === 'lethal' ? 'red' : ''}" data-act="deploy" data-arg="${z.id}" ${allowed || z.risk === 'lethal' ? '' : 'disabled'}>DEPLOY</button></div></div>`;
}

// ----- KIN -----
function kinPanel() {
  const k = S.kin!; const d = Sim.derive(S, k); const A = ARCHETYPES.find((a) => a.id === k.arch)!; const frozen = k.status === 'fallen';
  return `<h2>${esc(k.name.toUpperCase())} <small>${A.name} · LV ${k.level} · ${k.stats.wins}/${k.stats.fights} wins</small></h2>
    ${frozen ? '<div class="card danger tiny">Fallen: Core, Mind and Vessel are frozen until revived.</div>' : ''}
    <div class="card"><div class="grid3" style="gap:4px">${ATTRS.map((a) => `<div class="tiny"><b style="color:var(--cyan)">${ATTR_INFO[a].short}</b> <b class="num" style="color:#fff">${k.attrs[a]}</b></div>`).join('')}</div>
      <div class="tiny" style="margin-top:4px">Power ${d.combat.toFixed(0)} · Max HP ${d.maxHp} · ${k.bold >= 60 ? 'Bold' : k.bold <= 40 ? 'Careful' : 'Balanced'} (${k.bold}) · decision quality ${Math.round(d.quality * 100)}%</div></div>
    <h3>LOADOUT</h3><div class="card">${budgetBar(k.modules, k.orders)}<div style="margin-top:5px">${synergyLine(k.modules)}</div></div>
    ${moduleGrid(S.owned, k.modules, frozen ? 'noop' : 'kmod')}
    <h3>STANDING ORDERS</h3><div class="card v"><textarea rows="4" data-in="korders" ${frozen ? 'disabled' : ''}>${esc(k.orders)}</textarea><div id="kchips" style="margin-top:4px">${ordersChips(k.orders)}</div></div>
    <h3>DATA</h3><div class="card"><div class="row"><span class="tiny grow">Download everything your Kin is (persona, memories, journal, stats) as JSON. A keepsake: it can't be re-imported.</span><button class="btn sm ghost" data-act="export">⇩ EXPORT</button></div>
      <div class="tiny" style="margin-top:4px">Consent: ${new Date(k.consent.at).toLocaleString()} · ${k.consent.terms}</div></div>`;
}

// ----- LOG -----
function logPanel() {
  const fmtT = (t: number) => { const dd = new Date(t); return `${String(dd.getHours()).padStart(2, '0')}:${String(dd.getMinutes()).padStart(2, '0')}`; };
  return `<h2>JOURNAL <small>${S.journal.length} entries</small></h2><div class="journal">${S.journal.slice(0, 80).map((e) => `<p class="${e.kind}"><span class="tm">${fmtT(e.t)}</span>${esc(e.text)}</p>`).join('') || '<div class="tiny">Nothing yet. Deploy your Kin from the WORLD tab.</div>'}</div>`;
}

// ----- RANK -----
function rankPanel() {
  const k = S.kin;
  const rows = [...S.rivals.map((r) => ({ id: r.id, name: r.name, owner: r.owner, lvl: r.level, rating: r.rating, me: false, dead: r.status === 'fallen', arch: r.arch })),
    ...(k ? [{ id: 'me', name: k.name, owner: 'you', lvl: k.level, rating: S.rating, me: true, dead: k.status === 'fallen', arch: k.arch }] : [])].sort((a, b) => b.rating - a.rating);
  return `<h2>SMARTEST KIN · SEASON 0 <small>async arena · knockouts only (Safe)</small></h2>
    <div class="card"><table class="lb">${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''} ${r.dead ? 'dead' : ''}"><td class="rk">${i + 1}</td><td><b style="color:${ARCHETYPES.find((a) => a.id === r.arch)!.color}">◆</b> ${esc(r.name)}${r.dead ? ' ✖' : ''}<div class="tiny">@${r.owner} · LV ${r.lvl}</div></td><td class="num" style="text-align:right">${r.rating}</td><td style="text-align:right">${!r.me && k && k.status !== 'fallen' && !r.dead ? `<button class="btn sm ghost" data-act="duel" data-arg="${r.id}">DUEL</button>` : ''}</td></tr>`).join('')}</table></div>
    ${S.tombstones.length ? `<h3>FALLEN KIN (anonymized)</h3>${S.tombstones.map((t, i) => `<div class="tiny">✖ Fallen Kin #${i + 1} · LV ${t.level} · rating ${t.rating} · deleted ${new Date(t.deletedAt).toLocaleDateString()}</div>`).join('')}` : ''}
    <div class="tiny" style="margin-top:6px">Ranked fairness: every Kin uses the same model and token budget. The best build wins, not the biggest wallet.</div>`;
}

// ----- FALLEN -----
function fallenPanel() {
  const k = S.kin!; if (k.status !== 'fallen') return labPanel();
  const left = fallenDeadline(k) - now(S); const rc = Sim.reviveTokenCost(k);
  return `<h2 style="color:var(--lethal);text-shadow:0 0 10px var(--lethal)">✖ ${esc(k.name.toUpperCase())} HAS FALLEN</h2>
    <div class="card danger"><div class="tiny">PERMANENT DELETION IN</div><div class="countdown num">${dur(left)}</div><div class="tiny">Fell in ${ZONE_BY_ID[k.fallenZone!].name} · ${new Date(k.fallenAt!).toLocaleString()}</div></div>
    <div class="card"><b style="font:700 10px var(--font-d);letter-spacing:.1em;color:var(--safe)">✚ REVIVE QUEST · FREE</b>
      ${k.rescue ? `<div class="bar" style="margin:6px 0"><i style="width:${(k.rescue.progress / k.rescue.need) * 100}%"></i></div><div class="tiny">Attempt ${k.rescue.attempt} in progress · ${k.rescue.progress}/${k.rescue.need} ticks · success ≈${Math.round(Math.min(0.95, 0.5 + 0.06 * S.lab.cryo + 0.15 * (k.rescue.attempt - 1)) * 100)}%</div>`
        : `<div class="tiny" style="margin:4px 0">NPC rescuers go in after it. Takes ~${Sim.rescueNeed(k)} ticks, can fail, retry as often as you like.</div><button class="btn wide" data-act="rescue">SEND RESCUE TEAM</button>`}</div>
    <div class="card v"><div class="row"><div class="grow"><b style="font:700 10px var(--font-d);letter-spacing:.1em">REVIVE TOKEN</b><div class="tiny">Owned: ${k.reviveTokens} · forge at Cryo Vault: ${rc.bits}¤ ${rc.shards}◆ (flat, never rises)</div></div>
      ${k.reviveTokens ? '<button class="btn sm v" data-act="useToken">USE</button>' : `<button class="btn sm ghost" data-act="forgeToken" ${Sim.canAfford(S, rc) ? '' : 'disabled'}>FORGE</button>`}</div></div>
    <div class="card"><div class="tiny" style="color:var(--mag);margin-bottom:3px">LAST LIGHT · companion</div><div class="lastlight">${k.lastLight.map((l) => `<p>“${esc(l)}”</p>`).join('')}</div>
      <div class="row" style="margin-top:6px"><span class="tiny grow">Revived Kin lose half their level XP.</span><button class="btn sm ghost" data-act="export">⇩ EXPORT</button></div></div>`;
}

// ---------------- modals ----------------
function modal(html: string, cls = '') { overlay.innerHTML = `<div class="modal ${cls}">${html}</div>`; overlay.classList.add('show'); }
function closeModal() { overlay.classList.remove('show'); overlay.innerHTML = ''; }
function welcomeBack(ms: number, sum: Sim.AwaySummary, wasFallen: boolean) {
  if (ms < 120_000 || !S.kin) return;
  const k = S.kin;
  if (wasFallen) { modal(`<h1>WELCOME BACK</h1><div class="muted">You were away ${dur(ms)}.</div><div class="consent">${esc(k.name)} is still fallen. ${k.status === 'fallen' ? `Deletion in <b>${dur(fallenDeadline(k) - now(S))}</b>.` : 'It was revived while you were away.'}</div><button class="btn wide" data-act="close">OK</button>`, k.status === 'fallen' ? 'danger' : ''); return; }
  modal(`<h1>WELCOME BACK</h1><div class="muted">You were away <b style="color:#fff">${dur(ms)}</b> · ${sum.ticks} world ticks simulated${sum.capped ? ' (chest cap reached)' : ''}.</div>
    <div class="grid3" style="margin:10px 0"><div class="card"><div class="tiny">BATTLES</div><b class="num">${sum.wins}/${sum.fights}</b></div><div class="card"><div class="tiny">CHEST</div><b class="num" style="color:var(--cyan)">+${sum.bits}¤</b> <b class="num" style="color:var(--violet)">+${sum.shards}◆</b></div><div class="card"><div class="tiny">LEVELS</div><b class="num">+${sum.levels}</b></div></div>
    <h3>HIGHLIGHTS</h3><div class="journal">${sum.highlights.length ? sum.highlights.map((h) => `<p>${esc(h)}</p>`).join('') : '<p>A quiet shift. Steady salvage, no drama.</p>'}</div>
    <div class="row" style="margin-top:8px"><button class="btn ghost" data-act="close">LATER</button><span class="grow"></span><button class="btn v" data-act="collectClose">COLLECT CHEST</button></div>`, sum.died ? 'danger' : '');
}
function deathSequence() {
  pendingDeathFx = false; closeModal();
  const fx = document.createElement('div'); fx.className = 'death-fx'; fx.innerHTML = `<b>SIGNAL LOST</b><span>${esc(S.kin?.name ?? '')} · FALLEN</span>`; document.body.appendChild(fx);
  R.flash = { color: '#ff3b5c', until: R.t + 1.5 };
  setTimeout(() => { fx.remove(); setTab('fallen'); }, 2200);
}
function showDeleted() {
  const t = S.tombstones[S.tombstones.length - 1];
  tab = 'lab'; draft = { step: 0, name: '', arch: 'vanguard', alloc: emptyAttrs(), bold: 50, orders: DEFAULT_ORDERS, modules: [], agree: false, typed: '' }; R.preview = { arch: 'vanguard', name: '' };
  renderRail(); renderPanel();
  modal(`<h1>KIN DELETED</h1><div class="consent">The 14-day window closed. The Kin's Core, Mind and Vessel (persona, memories, modules, journal, level and gear) have been permanently purged, as agreed at creation.</div>
    <div class="tiny">Kept: your Lab buildings, wallet, and an anonymous tombstone (id <span class="num">${t?.kinId}</span>, deleted ${t ? new Date(t.deletedAt).toLocaleString() : ''}, consent ${t?.terms}).</div>
    <button class="btn wide v" style="margin-top:10px" data-act="newKin">FORGE A NEW KIN</button>`, 'danger');
}
function lethalConfirm(zoneId: string) {
  const k = S.kin!; const d = Sim.derive(S, k); const z = ZONE_BY_ID[zoneId];
  if (d.orders.noLethal) {
    modal(`<h1>BLOCKED BY STANDING ORDER</h1><div class="muted">${esc(k.name)} is ordered to <b>never enter Lethal activities</b>. ${z.name} is <span class="badge lethal">LETHAL</span>.</div>
      <div class="consent">Removing this order lets your Kin enter zones where it can die permanently. It's your call.</div>
      <div class="row"><button class="btn ghost" data-act="close">KEEP IT SAFE</button><span class="grow"></span><button class="btn red" data-act="dropNoLethal" data-arg="${zoneId}">REMOVE ORDER</button></div>`, 'danger');
    return;
  }
  modal(`<h1>LETHAL DEPLOYMENT</h1><div class="muted">${z.name}: ${z.flavor}.</div><div class="consent" id="riskbox">Simulating 150 expeditions with the current build…</div>
    <div class="row"><button class="btn ghost" data-act="close">CANCEL</button><span class="grow"></span><button class="btn red" data-act="deployGo" data-arg="${zoneId}" id="riskgo" disabled>DEPLOY ANYWAY</button></div>`, 'danger');
  setTimeout(() => {
    const r = Sim.estimateRisk(S, zoneId, 150); const box = document.getElementById('riskbox'); const go = document.getElementById('riskgo') as HTMLButtonElement | null;
    const pc = (x: number) => x > 0 && x < 0.01 ? '<1' : String(Math.round(x * 100));
    if (box) box.innerHTML = `Sim-estimated death risk for this build:<br/><b style="font-size:16px">≈${pc(r.perExpedition)}% per expedition</b> (avg ${Math.round(r.avgTicks)} ticks) · <b style="font-size:16px">≈${pc(r.per12h)}% over a 12h AFK shift</b><br/>If ${esc(k.name)} dies, you have 14 days to revive it, or it is deleted forever. ${k.deathWard ? '<br/>⬡ Its Death Ward will absorb one lethal blow.' : ''}`;
    if (go) go.disabled = false;
  }, 30);
}
function craftMenu() {
  const rows = MODULES.map((m) => { const own = S.owned.includes(m.id); const locked = m.tier > Sim.maxTier(S); const c = MODULE_CRAFT_COST[m.tier];
    return `<div class="mod ${locked ? 'locked' : ''}" style="margin-bottom:4px"><div class="mn"><span class="ic">${m.icon}</span>${m.name}<span class="tk">${Sim.moduleTokens(S, m.id)}t · T${m.tier}</span></div><div class="row"><span class="tiny grow">${m.desc}</span>${own ? '<span class="tiny" style="color:var(--safe)">OWNED</span>' : locked ? `<span class="tiny">Compiler LV${m.tier === 2 ? 2 : 4}</span>` : `<button class="btn sm" data-act="craft" data-arg="${m.id}" ${Sim.canAfford(S, c) ? '' : 'disabled'}>${c.bits}¤ ${c.shards}◆</button>`}</div></div>`; }).join('');
  modal(`<div class="row sb"><h1>COMPILER</h1><button class="btn sm ghost" data-act="close">✕</button></div><div class="tiny" style="margin-bottom:6px">Craft vetted skill modules (prompt templates). Higher Compiler levels unlock higher tiers and shrink token costs.</div><div class="grid2">${rows}</div>`);
}
function trainMenu() {
  const k = S.kin!; const cap = Sim.attrCap(S);
  modal(`<div class="row sb"><h1>SIM DECK</h1><button class="btn sm ghost" data-act="close">✕</button></div><div class="tiny" style="margin-bottom:6px">Drill one attribute against recorded opponents. Cap ${cap} (raise with Sim Deck level).</div>
    ${ATTRS.map((a) => { const v = k.attrs[a]; const c = Sim.trainCost(v); return `<div class="row" style="margin:4px 0"><b style="width:38px;color:var(--cyan);font:800 10px var(--font-d)">${ATTR_INFO[a].short}</b><span class="num" style="width:22px">${v}</span><span class="tiny grow">${ATTR_INFO[a].desc}</span>${v >= cap ? '<span class="tiny">CAP</span>' : `<button class="btn sm" data-act="train" data-arg="${a}" ${Sim.canAfford(S, c) ? '' : 'disabled'}>+1 · ${c.bits}¤ ${c.shards}◆</button>`}</div>`; }).join('')}`);
}
function exportKin() {
  const k = S.kin; if (!k) return;
  const data = { format: 'neurokin-export/0.1', exportedAt: new Date(now(S)).toISOString(), note: 'Keepsake copy. It cannot be re-imported to restore a Kin.', kin: k, journal: S.journal, rating: S.rating };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `neurokin-${k.name.replace(/\W+/g, '_')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('⇩ Kin exported as JSON');
}

// ---------------- dev panel ----------------
function renderDev() {
  dev.innerHTML = `<div class="row sb"><h2>DEV PANEL</h2><button class="btn sm" data-act="dev">✕</button></div>
    <div class="tiny">SIM SPEED (live ticks)</div>${[1, 10, 60, 300].map((v) => `<button class="btn sm ${S.speed === v ? 'on' : ''}" data-act="speed" data-arg="${v}">×${v}</button>`).join('')}
    <div class="tiny" style="margin-top:6px">TIME SKIP (runs AFK catch-up / countdown)</div>${[['1h', 3.6e6], ['12h', 43.2e6], ['1d', DAY_MS], ['7d', 7 * DAY_MS], ['14d', 14 * DAY_MS]].map(([l, v]) => `<button class="btn sm" data-act="skip" data-arg="${v}">+${l}</button>`).join('')}
    <div class="tiny" style="margin-top:6px">CHEATS</div><button class="btn sm" data-act="rich">+1000¤ +60◆</button><button class="btn sm" data-act="heal">Full HP</button><button class="btn sm" data-act="lvl">+3 LV</button><button class="btn sm" data-act="kill" ${S.kin && S.kin.status !== 'fallen' ? '' : 'disabled'}>Force lethal death</button>
    <div class="tiny" style="margin-top:6px">SYSOP</div>${['virus_outbreak', 'blackout', 'tournament', 'breach', 'data_boom', 'bounty'].map((t) => `<button class="btn sm" data-act="event" data-arg="${t}">${t}</button>`).join('')}
    <div class="tiny" style="margin-top:6px">DECISION PROVIDER (decision points only)</div>
    <button class="btn sm ${S.brain === 'instinct' ? 'on' : ''}" data-act="brain" data-arg="instinct">Instinct</button><button class="btn sm ${S.brain === 'stub' ? 'on' : ''}" data-act="brain" data-arg="stub">LLM stub</button><button class="btn sm ${S.brain === 'ollama' ? 'on' : ''}" data-act="brain" data-arg="ollama">Ollama ${ollamaOk ? '✓ ' + esc(ollama.model ?? '') : '(not found)'}</button>
    <div class="tiny" style="margin-top:6px">Clock offset: ${dur(S.debugOffset)} · tick #${S.tickCount}</div>
    <button class="btn sm red" style="margin-top:6px" data-act="reset">Wipe save</button>`;
}

// ---------------- actions ----------------
const actions: Record<string, (arg: string, el: HTMLElement) => void> = {
  tab: (a) => setTab(a as Tab),
  noop: () => {},
  close: () => { closeModal(); if (pendingDeathFx) deathSequence(); },
  dev: () => { dev.classList.toggle('show'); renderDev(); },
  arch: (a) => { draft.arch = a as ArchetypeId; draft.modules = []; R.preview = { arch: draft.arch, name: draft.name }; renderPanel(); },
  attr: (a) => { const [k, d] = a.split(':'); const at = k as Attr; const v = draft.alloc[at] + +d; const total = draftAttrs()[at] + +d; if (v < 0 || total > ATTR_MAX_CREATE || (+d > 0 && pointsLeft() <= 0)) return; draft.alloc[at] = v; renderPanel(); },
  cstep: (a) => { draft.step = Math.max(0, Math.min(4, draft.step + +a)); if (draft.step === 3 && !draft.modules.length) autoLoadout(); renderPanel(); },
  cmod: (a) => { toggleMod(draft.modules, a, draft.orders); renderPanel(); },
  createKin: () => {
    const k = newKin({ name: draft.name.trim(), arch: draft.arch, attrs: draftAttrs(), bold: draft.bold, orders: draft.orders, modules: draft.modules, typedName: draft.typed.trim() }, now(S));
    k.consent.terms = TERMS_VERSION; S.kin = k; S.owned = starterOwned(); S.lastTickAt = now(S); S.chest.ticks = 0; R.preview = null;
    journal({ t: now(S), kind: 'level', text: `◆ ${k.name} came online in the Lab. Neural lines stable. Standing Orders loaded: ${parseOrders(k.orders).chips.join(', ') || 'none'}.` });
    save(); setTab('world'); renderHud(); toast(`◆ <b>${esc(k.name)}</b> is online. Pick a zone and deploy.`, 'v');
  },
  newKin: () => { closeModal(); draft = { step: 0, name: '', arch: 'vanguard', alloc: emptyAttrs(), bold: 50, orders: DEFAULT_ORDERS, modules: [], agree: false, typed: '' }; R.preview = { arch: 'vanguard', name: '' }; renderRail(); renderPanel(); },
  collect: () => { const g = Sim.collectChest(S); (window as any).__fullToast = 0; toast(`▣ Collected <b>${g.bits}¤</b> and <b>${g.shards}◆</b>`); save(); renderPanel(); },
  collectClose: () => { actions.collect('', null as any); closeModal(); if (pendingDeathFx) deathSequence(); },
  chest: () => { setTab('lab'); },
  fast: () => { if (!Sim.fastRewardAvailable(S)) return; S.fastRewardDay = dayIndex(now(S)); const sum = Sim.catchUp(S, 2 * 3.6e6, journal); toast(`⚡ Fast reward: 2h simulated · +${sum.bits}¤ ${sum.shards}◆`, 'v'); save(); if (sum.died) deathSequence(); renderPanel(); },
  upgrade: (a) => { if (Sim.upgradeLab(S, a as LabId)) { const l = LAB.find((x) => x.id === a)!; toast(`▲ ${l.name} upgraded to LV ${S.lab[a as LabId]}`, 'v'); journal({ t: now(S), kind: 'lab', text: `⌬ The ${l.name} was upgraded to level ${S.lab[a as LabId]}.` }); save(); renderPanel(); } },
  craftMenu: () => craftMenu(), trainMenu: () => trainMenu(),
  craft: (a) => { if (Sim.craftModule(S, a)) { toast(`⌬ Compiled <b>${MODULE_BY_ID[a].name}</b>`, 'v'); save(); craftMenu(); panelDirty = true; } },
  train: (a) => { const k = S.kin!; const v = k.attrs[a as Attr]; const c = Sim.trainCost(v); if (v >= Sim.attrCap(S) || !Sim.canAfford(S, c)) return; Sim.pay(S, c); k.attrs[a as Attr]++; toast(`◈ ${ATTR_INFO[a as Attr].label} → ${k.attrs[a as Attr]}`); save(); trainMenu(); panelDirty = true; },
  forgeToken: () => { const k = S.kin!; const c = Sim.reviveTokenCost(k); if (!Sim.canAfford(S, c)) return; Sim.pay(S, c); k.reviveTokens++; toast('❄ Revive Token forged', 'v'); save(); renderPanel(); },
  forgeWard: () => { const k = S.kin!; if (k.deathWard || !Sim.canAfford(S, Sim.DEATH_WARD_COST)) return; Sim.pay(S, Sim.DEATH_WARD_COST); k.deathWard = true; toast('⬡ Death Ward equipped', 'v'); save(); renderPanel(); },
  target: (a) => { const k = S.kin!; if (a !== 'auto' && a !== 'hold') { const z = ZONE_BY_ID[a]; if (z.risk === 'lethal') return lethalConfirm(a); if (!Sim.zoneAllowed(Sim.derive(S, k).orders, z)) { toast('⛔ Blocked by your Standing Orders', 'red'); return; } } if (ZONE_BY_ID[a] && k.status === 'deployed' && k.zone !== a) return deployTo(a); // re-route immediately
    k.target = a; R.selectedZone = ZONE_BY_ID[a] ? a : R.selectedZone; save(); renderPanel(); },
  deploy: (a) => { const z = ZONE_BY_ID[a]; if (z.risk === 'lethal') return lethalConfirm(a); deployTo(a); },
  deployGo: (a) => { closeModal(); deployTo(a); },
  dropNoLethal: (a) => { const k = S.kin!; k.orders = k.orders.split('\n').filter((l) => !/lethal/i.test(l)).join('\n'); journal({ t: now(S), kind: 'lab', text: `You removed the "Never enter Lethal activities" order. ${k.name} can now be sent where it can die.` }); save(); lethalConfirm(a); },
  recall: () => { const k = S.kin!; k.target = 'hold'; if (k.status === 'deployed') { k.status = 'lab'; k.zone = null; journal({ t: now(S), kind: 'move', text: `You recalled ${k.name} to the Lab.` }); } save(); renderPanel(); },
  kmod: (a) => { const k = S.kin!; toggleMod(k.modules, a, k.orders); save(); renderPanel(); },
  export: () => exportKin(),
  duel: (a) => { const r = S.rivals.find((x) => x.id === a)!; const res = Sim.arenaDuel(S, a); journal({ t: now(S), kind: 'combat', text: `⚔ Arena: ${S.kin!.name} ${res.won ? 'beat' : 'lost to'} ${r.name} (${res.rounds.join(', ')}). Rating ${res.delta >= 0 ? '+' : ''}${res.delta}.` }); toast(`⚔ ${res.won ? 'Victory' : 'Defeat'} vs ${esc(r.name)} · ${res.delta >= 0 ? '+' : ''}${res.delta}`, res.won ? 'v' : 'red'); save(); renderPanel(); },
  rescue: () => { const e = io(); Sim.startRescue(S, e); save(); renderPanel(); },
  useToken: () => { const k = S.kin!; if (!k.reviveTokens) return; k.reviveTokens--; const e = io(); Sim.revive(S, k, 'token', e); onFlags(e.flags); save(); },
  speed: (a) => { S.speed = +a; S.lastTickAt = now(S); save(); renderDev(); },
  skip: (a) => { S.debugOffset += +a; save(); renderDev(); toast(`⏩ Skipped ${dur(+a)}`); },
  rich: () => { S.wallet.bits += 1000; S.wallet.shards += 60; save(); panelDirty = true; },
  heal: () => { if (S.kin) S.kin.hp = 1; panelDirty = true; },
  lvl: () => { if (S.kin) S.kin.level += 3; save(); panelDirty = true; },
  kill: () => { const k = S.kin; if (!k || k.status === 'fallen') return; const e = io(); Sim.fall(S, k, k.zone ?? 'deadzone', e); onFlags(e.flags); save(); renderDev(); },
  event: (a) => { const e = io(); Sim.proposeEvent(S, new (class { s = 0; next() { return Math.random(); } range(x: number, y: number) { return x + (y - x) * Math.random(); } int(x: number, y: number) { return Math.floor(this.range(x, y + 1)); } pick<T>(arr: readonly T[]) { return arr[Math.floor(Math.random() * arr.length)]; } chance(p: number) { return Math.random() < p; } })() as any, e, a); onFlags(e.flags); save(); toast(`SYSOP // ${a} proposed`); },
  brain: async (a) => { if (a === 'ollama') { ollamaOk = await ollama.available(); if (!ollamaOk) { toast('Ollama not running on this device. Staying on current provider.', 'red'); renderDev(); return; } } S.brain = a as Save['brain']; save(); renderDev(); },
  reset: () => { if (!confirm('Wipe the whole save?')) return; wipe(); S = freshSave(); tab = 'lab'; actions.newKin('', null as any); renderDev(); },
};
function autoLoadout() { draft.modules = []; for (const id of ARCHETYPES.find((a) => a.id === draft.arch)!.starter) if (Sim.tokensUsed(S, [...draft.modules, id], draft.orders) <= Sim.budget(S)) draft.modules.push(id); }
function toggleMod(list: string[], id: string, orders: string) {
  const i = list.indexOf(id);
  if (i >= 0) { list.splice(i, 1); return; }
  if (Sim.tokensUsed(S, [...list, id], orders) > Sim.budget(S)) { toast(`Over prompt budget. Unequip something or upgrade the Memory Bank.`, 'red'); document.querySelector('.budget')?.classList.add('over'); return; }
  list.push(id);
}
function deployTo(zoneId: string) {
  const k = S.kin!; const z = ZONE_BY_ID[zoneId];
  k.target = zoneId; R.selectedZone = zoneId;
  if (k.status === 'deployed') { k.zone = zoneId; journal({ t: now(S), kind: 'move', text: `New orders: ${k.name} is re-routing to ${z.name}.` }); }
  else if (k.hp >= 0.5) { k.status = 'deployed'; k.zone = zoneId; journal({ t: now(S), kind: 'move', text: `Uplink open. ${k.name} deployed to ${z.name}.` }); }
  else toast(`${esc(k.name)} will deploy after repairs (HP ${Math.round(k.hp * 100)}%)`);
  if (tab !== 'world') setTab('world');
  save(); renderPanel();
}

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (el && !(el as HTMLButtonElement).disabled) { const f = actions[el.dataset.act!]; if (f) { f(el.dataset.arg ?? '', el); renderHud(); renderRail(); } return; }
  if (ev.target === overlay && !overlay.querySelector('.danger')) closeModal();
});
document.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement; const k = el.dataset.in; if (!k) return;
  if (k === 'name') { draft.name = el.value.replace(/[^\w .\-]/g, '').slice(0, 16); R.preview = { arch: draft.arch, name: draft.name }; const nb = panel.querySelector('[data-act=cstep][data-arg="1"]') as HTMLButtonElement; if (nb) nb.disabled = draft.name.trim().length < 2; }
  else if (k === 'bold') draft.bold = +el.value;
  else if (k === 'orders') { draft.orders = clampOrders(el.value); const c = document.getElementById('ochips'); if (c) c.innerHTML = ordersChips(draft.orders); }
  else if (k === 'agree') { draft.agree = el.checked; renderPanel(); }
  else if (k === 'typed') { draft.typed = el.value; const b = panel.querySelector('[data-act=createKin]') as HTMLButtonElement; if (b) b.disabled = !(draft.agree && draft.typed.trim() === draft.name.trim()); }
  else if (k === 'korders' && S.kin) {
    const next = clampOrders(el.value);
    if (Sim.tokensUsed(S, S.kin.modules, next) > Sim.budget(S)) { el.style.borderColor = 'var(--lethal)'; return; }
    el.style.borderColor = ''; S.kin.orders = next; const c = document.getElementById('kchips'); if (c) c.innerHTML = ordersChips(next); save();
  }
});
function clampOrders(v: string) { return v.split('\n').slice(0, MAX_ORDERS).map((l) => l.slice(0, MAX_ORDER_LEN)).join('\n'); }
$('#stage').addEventListener('click', (ev) => {
  const r = (ev.target as HTMLCanvasElement).getBoundingClientRect(); const id = R.hitTest(ev.clientX - r.left, ev.clientY - r.top);
  if (!id || !S.kin) return;
  const [kind, v] = id.split(':');
  if (kind === 'zone') { R.selectedZone = v; renderPanel(); }
  if (kind === 'lab') { if (v === 'compiler') craftMenu(); else if (v === 'simdeck' && S.kin.status !== 'fallen') trainMenu(); else toast(LAB.find((l) => l.id === v)!.desc); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

// ---------------- boot ----------------
(async () => { ollamaOk = false; if (S.brain === 'ollama') { ollamaOk = await ollama.available(); if (!ollamaOk) S.brain = 'instinct'; } })();
if (!S.kin) R.preview = { arch: draft.arch, name: '' };
else if (S.kin.status === 'fallen') tab = 'fallen';
renderRail(); renderHud(); renderPanel();
(window as any).__nk = { get S() { return S; }, Sim, actions };
requestAnimationFrame(frame);
