// Procedural neon canvas renderer: Lab diorama, world map, Kin hologram. No external art assets.
import { ARCHETYPES, LAB, ZONES, ZONE_LINKS, ZONE_BY_ID, LabId, ArchetypeId, Risk } from './data';
import { Save } from './state';

export type Scene = 'lab' | 'world' | 'kin' | 'fallen' | 'void';
export const RISK_COLOR: Record<Risk, string> = { safe: '#4dffb5', perilous: '#ffb347', lethal: '#ff3b5c' };
interface Hit { x: number; y: number; r: number; id: string }

export class Renderer {
  ctx: CanvasRenderingContext2D; w = 0; h = 0; dpr = 1; t = 0;
  scene: Scene = 'void'; hits: Hit[] = [];
  kinPos = { x: 0, y: 0, init: false };
  thought: { text: string; until: number } | null = null;
  flash: { color: string; until: number } | null = null;
  preview: { arch: ArchetypeId; name: string } | null = null;
  selectedZone: string | null = null;
  private sky?: HTMLCanvasElement;
  private stars: { x: number; y: number; z: number }[] = [];
  constructor(public canvas: HTMLCanvasElement, public getSave: () => Save) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 70; i++) this.stars.push({ x: Math.random(), y: Math.random(), z: Math.random() });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.sky = this.buildSky();
  }
  hitTest(px: number, py: number): string | null {
    for (const h of this.hits) if ((px - h.x) ** 2 + (py - h.y) ** 2 <= h.r * h.r) return h.id;
    return null;
  }
  private buildSky(): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext('2d')!; g.scale(this.dpr, this.dpr);
    const { w, h } = this;
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#05030f'); bg.addColorStop(0.55, '#0b0626'); bg.addColorStop(1, '#03020a');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // skyline silhouettes with lit windows
    const rand = mulberry(42);
    for (let layer = 0; layer < 2; layer++) {
      const base = h * (0.58 + layer * 0.06); let x = -10;
      g.fillStyle = layer ? '#090718' : '#0d0a24';
      while (x < w + 20) {
        const bw = 14 + rand() * 34, bh = h * (0.12 + rand() * (layer ? 0.22 : 0.34));
        g.fillRect(x, base - bh, bw, bh + h);
        if (rand() > 0.5) { g.fillRect(x + bw / 2 - 1, base - bh - 10 - rand() * 14, 2, 24); }
        for (let wy = base - bh + 6; wy < base; wy += 7) for (let wx = x + 3; wx < x + bw - 3; wx += 5) if (rand() > 0.86) { g.fillStyle = rand() > 0.5 ? 'rgba(41,240,255,0.55)' : 'rgba(195,92,255,0.5)'; g.fillRect(wx, wy, 2, 2); g.fillStyle = layer ? '#090718' : '#0d0a24'; }
        x += bw + rand() * 4;
      }
    }
    const haze = g.createLinearGradient(0, h * 0.4, 0, h * 0.7); haze.addColorStop(0, 'rgba(120,40,255,0)'); haze.addColorStop(1, 'rgba(120,40,255,0.16)');
    g.fillStyle = haze; g.fillRect(0, 0, w, h);
    return c;
  }
  frame(dt: number) {
    this.t += dt;
    const g = this.ctx; g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.sky) g.drawImage(this.sky, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hits = [];
    this.drawGrid(this.scene === 'fallen' ? '255,59,92' : '41,240,255');
    this.drawStars();
    const s = this.getSave();
    if (this.scene === 'lab') this.drawLab(s);
    else if (this.scene === 'world') this.drawWorld(s);
    else if (this.scene === 'kin' || this.scene === 'void') { const p = this.preview ?? (s.kin ? { arch: s.kin.arch, name: s.kin.name } : null); if (p) this.drawKin(this.w / 2, this.h * 0.88, Math.min(this.h * 0.0034, this.w * 0.004), p.arch, 1); }
    else if (this.scene === 'fallen') this.drawFallen(s);
    if (this.flash && this.t < this.flash.until) { g.fillStyle = this.flash.color; g.globalAlpha = (this.flash.until - this.t) * 0.6; g.fillRect(0, 0, this.w, this.h); g.globalAlpha = 1; }
    this.scanlines();
  }
  private drawGrid(rgb: string) {
    const g = this.ctx, { w, h } = this, hy = h * 0.62;
    g.save(); g.beginPath(); g.rect(0, hy, w, h - hy); g.clip();
    const fl = g.createLinearGradient(0, hy, 0, h); fl.addColorStop(0, `rgba(${rgb},0)`); fl.addColorStop(1, `rgba(${rgb},0.10)`); g.fillStyle = fl; g.fillRect(0, hy, w, h - hy);
    g.strokeStyle = `rgba(${rgb},0.22)`; g.lineWidth = 1; g.beginPath();
    for (let i = -14; i <= 14; i++) { g.moveTo(w / 2 + i * 6, hy); g.lineTo(w / 2 + i * w * 0.16, h); }
    const off = (this.t * 0.35) % 1;
    for (let j = 0; j < 12; j++) { const p = (j + off) / 12; const y = hy + (h - hy) * p * p; g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke(); g.restore();
  }
  private drawStars() {
    const g = this.ctx; g.fillStyle = 'rgba(160,200,255,0.7)';
    for (const st of this.stars) { const y = (st.y * this.h * 0.55 + this.t * 4 * st.z) % (this.h * 0.55); const a = 0.3 + 0.7 * Math.abs(Math.sin(this.t * (0.5 + st.z) + st.x * 10)); g.globalAlpha = a * 0.6; g.fillRect(st.x * this.w, y, 1.2, 1.2); }
    g.globalAlpha = 1;
  }
  private scanlines() {
    const g = this.ctx; g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = (this.t * 20) % 3; y < this.h; y += 3) g.fillRect(0, y, this.w, 1);
  }
  glowStroke(path: () => void, color: string, width: number, glow = 10) {
    const g = this.ctx; g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalAlpha = 0.18; g.lineWidth = width + glow; g.beginPath(); path(); g.stroke();
    g.globalAlpha = 0.35; g.lineWidth = width + glow * 0.4; g.beginPath(); path(); g.stroke();
    g.globalAlpha = 1; g.lineWidth = width; g.beginPath(); path(); g.stroke(); g.restore();
  }
  private radial(x: number, y: number, r: number, color: string, a = 0.5) {
    const g = this.ctx; const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, hexA(color, a)); gr.addColorStop(1, hexA(color, 0));
    g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
  }

  // ---------- Kin hologram ----------
  drawKin(cx: number, footY: number, sc: number, arch: ArchetypeId, alpha = 1, broken = false) {
    const g = this.ctx; const A = ARCHETYPES.find((a) => a.id === arch)!; const c1 = broken ? '#ff3b5c' : A.color, c2 = broken ? '#7a1020' : A.color2;
    const bob = broken ? 0 : Math.sin(this.t * 2) * 3 * sc; const y0 = footY + bob; const S = sc * 1.0;
    g.save(); g.globalAlpha = alpha;
    // pedestal rings
    for (let i = 0; i < 3; i++) { const rr = (40 + i * 16 + ((this.t * 18) % 16)) * S; g.strokeStyle = hexA(c1, 0.5 - i * 0.14); g.lineWidth = 1.5; g.beginPath(); g.ellipse(cx, footY, rr, rr * 0.22, 0, 0, Math.PI * 2); g.stroke(); }
    this.radial(cx, footY, 70 * S, c1, 0.35);
    const P = (x: number, y: number): [number, number] => [cx + x * S, y0 - y * S];
    const body = () => {
      const pts: [number, number][] = [[-9, 0], [-12, 60], [-16, 100], [-22, 150], [-14, 160], [-9, 168], [9, 168], [14, 160], [22, 150], [16, 100], [12, 60], [9, 0]];
      g.moveTo(...P(pts[0][0], pts[0][1])); for (const p of pts.slice(1)) g.lineTo(...P(p[0], p[1]));
    };
    // silhouette fill
    g.save(); g.beginPath(); body(); g.closePath();
    const fill = g.createLinearGradient(cx, y0 - 190 * S, cx, y0); fill.addColorStop(0, '#1b1640'); fill.addColorStop(1, '#07061a'); g.fillStyle = fill; g.fill(); g.restore();
    // limbs
    const limb = (pts: number[][]) => () => { g.moveTo(...P(pts[0][0], pts[0][1])); for (const p of pts.slice(1)) g.lineTo(...P(p[0], p[1])); };
    const sway = broken ? 0 : Math.sin(this.t * 1.6) * 3;
    const armL = limb([[-22, 150], [-34 - sway, 110], [-38 - sway, 72]]), armR = limb([[22, 150], [34 + sway, 110], [38 + sway, 72]]);
    const legL = limb([[-8, 96], [-14, 48], [-16, 2]]), legR = limb([[8, 96], [14, 48], [16, 2]]);
    for (const l of [armL, armR, legL, legR]) { g.save(); g.strokeStyle = '#141034'; g.lineWidth = 9 * S; g.lineCap = 'round'; g.beginPath(); l(); g.stroke(); g.restore(); this.glowStroke(l, c2, 1.4, 6); }
    this.glowStroke(() => { body(); g.closePath(); }, c1, 1.6, 8);
    // head
    const [hx, hy] = P(0, 186);
    g.fillStyle = '#120e2e'; g.beginPath(); g.ellipse(hx, hy, 11 * S, 14 * S, 0, 0, Math.PI * 2); g.fill();
    this.glowStroke(() => g.ellipse(hx, hy, 11 * S, 14 * S, 0, 0, Math.PI * 2), c1, 1.4, 6);
    this.glowStroke(() => { g.moveTo(hx - 8 * S, hy - 1 * S); g.quadraticCurveTo(hx, hy + 3 * S, hx + 8 * S, hy - 1 * S); }, broken ? '#ff3b5c' : '#e8fbff', 2, 8);
    // neural lines with travelling pulses
    const lines = [[[0, 150], [-6, 120], [-10, 70], [-12, 20]], [[0, 150], [6, 120], [10, 70], [12, 20]], [[0, 150], [-18, 140], [-32, 108]], [[0, 150], [18, 140], [32, 108]]];
    for (const ln of lines) this.glowStroke(limb(ln), c2, 0.9, 4);
    if (!broken) for (let i = 0; i < lines.length; i++) { const ln = lines[i]; const u = (((this.t * 0.7 + i * 0.25) % 1) + 1) % 1; const seg = Math.min(ln.length - 2, Math.floor(u * (ln.length - 1))); const f = u * (ln.length - 1) - seg; const [x, y] = P(ln[seg][0] + (ln[seg + 1][0] - ln[seg][0]) * f, ln[seg][1] + (ln[seg + 1][1] - ln[seg][1]) * f); this.radial(x, y, 7 * S, '#ffffff', 0.9); }
    // core
    const [kx, ky] = P(0, 140); const pulse = broken ? 0.3 : 0.75 + 0.25 * Math.sin(this.t * 4);
    this.radial(kx, ky, 26 * S * pulse, broken ? '#ff3b5c' : '#ff4fd8', 0.8);
    g.fillStyle = broken ? '#5a0c18' : '#ffd6fa'; g.beginPath(); g.moveTo(kx, ky - 7 * S); g.lineTo(kx + 6 * S, ky); g.lineTo(kx, ky + 8 * S); g.lineTo(kx - 6 * S, ky); g.closePath(); g.fill();
    g.restore();
    if (broken) { // glitch slices
      for (let i = 0; i < 5; i++) { const yy = y0 - Math.random() * 190 * S; g.fillStyle = 'rgba(255,59,92,0.25)'; g.fillRect(cx - 50 * S + (Math.random() - 0.5) * 20, yy, 100 * S, 2 + Math.random() * 4); }
    }
  }

  // ---------- Lab ----------
  private drawLab(s: Save) {
    const g = this.ctx, { w, h } = this; const cx = w / 2, cy = this.topInset + (h - this.topInset) * 0.56; const R = Math.min(w * 0.4, (h - this.topInset) * 0.66);
    // platform (iso diamond, layered)
    const dia = (r: number, dy = 0) => () => { g.moveTo(cx, cy - r * 0.5 + dy); g.lineTo(cx + r, cy + dy); g.lineTo(cx, cy + r * 0.5 + dy); g.lineTo(cx - r, cy + dy); g.closePath(); };
    g.fillStyle = '#07061a'; g.beginPath(); dia(R, 12)(); g.fill();
    g.fillStyle = '#100c2c'; g.beginPath(); dia(R)(); g.fill();
    this.glowStroke(dia(R), '#29f0ff', 1.2, 8); this.glowStroke(dia(R * 0.62), '#c35cff', 0.8, 5);
    // circuit traces
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(41,240,255,0.25)'; g.lineWidth = 1;
    for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(cx + i * R * 0.11 - R * 0.45, cy - R * 0.225 + i * R * 0.055); g.lineTo(cx + i * R * 0.11 + R * 0.45, cy + R * 0.225 + i * R * 0.055); g.stroke(); }
    g.restore();
    const flowU = (this.t * 0.4) % 1;
    const pods: { id: LabId; x: number; y: number }[] = [
      { id: 'compiler', x: cx - R * 0.62, y: cy - R * 0.02 }, { id: 'simdeck', x: cx, y: cy - R * 0.33 },
      { id: 'memory', x: cx + R * 0.62, y: cy - R * 0.02 }, { id: 'cryo', x: cx, y: cy + R * 0.3 },
    ];
    for (const p of pods) { // data flow from pods to core
      const x = p.x + (cx - p.x) * flowU, y = p.y + (cy - p.y) * flowU; const def = LAB.find((l) => l.id === p.id)!;
      this.glowStroke(() => { g.moveTo(p.x, p.y); g.lineTo(cx, cy); }, hexA(def.color, 0.4), 0.6, 3); this.radial(x, y, 6, def.color, 0.9);
    }
    const order = [...pods].sort((a, b) => a.y - b.y);
    for (const p of order) {
      const def = LAB.find((l) => l.id === p.id)!; const lvl = s.lab[p.id]; const ph = R * (0.2 + lvl * 0.04); const pr = R * 0.16;
      g.fillStyle = '#0c0a24'; g.beginPath(); g.ellipse(p.x, p.y, pr, pr * 0.45, 0, 0, Math.PI * 2); g.fill();
      this.glowStroke(() => g.ellipse(p.x, p.y, pr, pr * 0.45, 0, 0, Math.PI * 2), def.color, 1.2, 6);
      // holo column
      const col = g.createLinearGradient(0, p.y - ph, 0, p.y); col.addColorStop(0, hexA(def.color, 0)); col.addColorStop(1, hexA(def.color, 0.35));
      g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = col; g.beginPath(); g.moveTo(p.x - pr * 0.7, p.y); g.lineTo(p.x - pr * 0.45, p.y - ph); g.lineTo(p.x + pr * 0.45, p.y - ph); g.lineTo(p.x + pr * 0.7, p.y); g.closePath(); g.fill(); g.restore();
      // floating icon
      const iy = p.y - ph * 0.7 + Math.sin(this.t * 2 + p.x) * 3;
      g.save(); g.font = `${Math.round(pr * 1.0)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#eafcff'; g.shadowColor = def.color; g.shadowBlur = 12; g.fillText(def.icon, p.x, iy); g.restore();
      // label
      g.font = `600 ${Math.max(9, Math.round(R * 0.045))}px "Orbitron", system-ui`; g.textAlign = 'center'; g.fillStyle = def.color; g.fillText(def.name.toUpperCase(), p.x, p.y + pr * 0.45 + 12);
      for (let i = 0; i < 5; i++) { g.fillStyle = i < lvl ? def.color : 'rgba(255,255,255,0.15)'; g.fillRect(p.x - 14 + i * 6, p.y + pr * 0.45 + 16, 4, 3); }
      this.hits.push({ x: p.x, y: p.y - ph * 0.4, r: pr * 1.3, id: 'lab:' + p.id });
    }
    // core / kin
    const k = s.kin;
    if (k && k.status === 'lab') this.drawKin(cx, cy + 6, R * 0.0042, k.arch);
    else if (k && k.status === 'deployed') {
      const bw = 6 + Math.sin(this.t * 6) * 2; const beam = g.createLinearGradient(0, 0, 0, cy); beam.addColorStop(0, 'rgba(41,240,255,0)'); beam.addColorStop(1, 'rgba(41,240,255,0.5)');
      g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = beam; g.fillRect(cx - bw / 2, 0, bw, cy); g.restore(); this.radial(cx, cy, 30, '#29f0ff', 0.6);
      g.font = '600 10px "Orbitron", system-ui'; g.textAlign = 'center'; g.fillStyle = '#9ff8ff'; g.fillText(`UPLINK → ${ZONE_BY_ID[k.zone!]?.name.toUpperCase() ?? ''}`, cx, cy + 24);
    }
  }

  // ---------- World ----------
  topInset = 40;
  zonePos(id: string) { const z = ZONE_BY_ID[id]; const pad = 26; const top = this.topInset + 34; return { x: pad + z.x * (this.w - pad * 2), y: top + z.y * (this.h - top - 30) }; }
  private drawWorld(s: Save) {
    const g = this.ctx, { w, h } = this;
    // deadzone corruption on the right
    const dz = this.zonePos('deadzone');
    for (let i = 0; i < 40; i++) { const a = (i * 137.5) % 360 * Math.PI / 180; const r = (i % 7) * 12 + 20 + Math.sin(this.t * 3 + i) * 6; g.fillStyle = `rgba(255,40,70,${0.06 + (i % 3) * 0.03})`; g.fillRect(dz.x + Math.cos(a) * r * 1.6, dz.y + Math.sin(a) * r, 8 + (i % 5) * 4, 2 + (i % 3)); }
    this.radial(dz.x + 30, dz.y - 30, Math.min(w, h) * 0.45, '#ff2846', 0.16);
    // SYSOP eye
    const ex = w * 0.5, ey = this.topInset + 16; const active = s.events.some((e) => e.startsAt <= s.tickCount);
    this.radial(ex, ey, 60, '#29f0ff', active ? 0.35 : 0.15);
    this.glowStroke(() => { g.moveTo(ex - 26, ey); g.quadraticCurveTo(ex, ey - 16, ex + 26, ey); g.quadraticCurveTo(ex, ey + 16, ex - 26, ey); }, '#29f0ff', 1.2, 6);
    const look = Math.sin(this.t * 0.7) * 6; this.radial(ex + look, ey, 9, '#c35cff', 0.9); g.fillStyle = '#e9fdff'; g.beginPath(); g.arc(ex + look, ey, 2.5, 0, Math.PI * 2); g.fill();
    g.font = '600 8px "Orbitron", system-ui'; g.textAlign = 'center'; g.fillStyle = 'rgba(160,240,255,0.7)'; g.fillText('SYSOP', ex, ey + 22);
    // links with flowing packets
    for (const [a, b] of ZONE_LINKS) {
      const p = this.zonePos(a), q = this.zonePos(b); const lethal = ZONE_BY_ID[b].risk === 'lethal' || ZONE_BY_ID[a].risk === 'lethal';
      this.glowStroke(() => { g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); }, lethal ? 'rgba(255,59,92,0.5)' : 'rgba(41,240,255,0.35)', 0.8, 4);
      const u = (this.t * 0.25 + (p.x + q.y) * 0.001) % 1; this.radial(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u, 5, lethal ? '#ff3b5c' : '#29f0ff', 0.9);
    }
    // zones
    const R = Math.max(14, Math.min(w, h) * 0.065);
    for (const z of ZONES) {
      const p = this.zonePos(z.id); const col = RISK_COLOR[z.risk]; const sel = this.selectedZone === z.id;
      const hex = (r: number) => () => { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; const fn = i ? g.lineTo.bind(g) : g.moveTo.bind(g); fn(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.8); } g.closePath(); };
      g.fillStyle = 'rgba(10,8,30,0.85)'; g.beginPath(); hex(R)(); g.fill();
      this.glowStroke(hex(R), col, sel ? 2.2 : 1.2, sel ? 12 : 6);
      if (sel) this.glowStroke(hex(R + 5 + Math.sin(this.t * 5) * 2), col, 0.8, 4);
      g.font = `700 ${Math.round(R * 0.62)}px "Orbitron", system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(String(z.diff), p.x, p.y + 1);
      g.textBaseline = 'alphabetic'; g.font = `600 ${Math.max(8, Math.round(R * 0.42))}px "Orbitron", system-ui`; g.fillStyle = '#d9f6ff'; g.fillText(z.name.toUpperCase(), p.x, p.y + R + 10);
      g.font = `700 ${Math.max(7, Math.round(R * 0.34))}px system-ui`; g.fillStyle = col; g.fillText(z.risk.toUpperCase(), p.x, p.y + R + 20);
      const evs = s.events.filter((e) => e.zone === z.id);
      evs.forEach((e, i) => { const live = e.startsAt <= s.tickCount; const ex2 = p.x + R * 0.9 + i * 12, ey2 = p.y - R * 0.8; this.radial(ex2, ey2, 12 + Math.sin(this.t * 6) * 3, e.type === 'breach' ? '#ff3b5c' : '#c35cff', live ? 0.9 : 0.4); g.font = '700 10px system-ui'; g.fillStyle = '#fff'; g.fillText(live ? '!' : '…', ex2, ey2 + 3); });
      this.hits.push({ x: p.x, y: p.y, r: R * 1.2, id: 'zone:' + z.id });
    }
    // Kin marker
    const k = s.kin;
    if (k && (k.status === 'deployed' || k.status === 'fallen')) {
      const zid = k.status === 'fallen' ? k.fallenZone! : k.zone!; const tp = this.zonePos(zid);
      if (!this.kinPos.init) { this.kinPos = { x: tp.x, y: tp.y, init: true }; }
      this.kinPos.x += (tp.x - this.kinPos.x) * 0.06; this.kinPos.y += (tp.y - this.kinPos.y) * 0.06;
      const A = ARCHETYPES.find((a) => a.id === k.arch)!; const col = k.status === 'fallen' ? '#ff3b5c' : A.color;
      const kx = this.kinPos.x, ky = this.kinPos.y - R * 1.5 + Math.sin(this.t * 3) * 2;
      this.radial(kx, ky, 18, col, 0.8);
      g.fillStyle = col; g.beginPath(); g.moveTo(kx, ky - 8); g.lineTo(kx + 6, ky); g.lineTo(kx, ky + 8); g.lineTo(kx - 6, ky); g.closePath(); g.fill();
      g.font = '700 9px "Orbitron", system-ui'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(k.status === 'fallen' ? `✖ ${k.name}` : k.name, kx, ky - 13);
      if (this.thought && this.t < this.thought.until) {
        const a = Math.min(1, (this.thought.until - this.t) * 1.5); g.globalAlpha = a; g.font = '600 9px system-ui';
        const tw = g.measureText(this.thought.text).width + 14; const bx = Math.min(w - tw - 4, Math.max(4, kx - tw / 2)), by = ky - 40;
        g.fillStyle = 'rgba(20,10,50,0.85)'; g.fillRect(bx, by, tw, 16); g.strokeStyle = '#ff4fd8'; g.strokeRect(bx, by, tw, 16);
        g.fillStyle = '#ffd6fa'; g.textAlign = 'left'; g.fillText(this.thought.text, bx + 7, by + 11); g.globalAlpha = 1;
        this.glowStroke(() => { g.moveTo(kx, ky - 10); g.lineTo(kx, by + 16); }, '#ff4fd8', 0.8, 4);
      }
    } else this.kinPos.init = false;
  }

  private drawFallen(s: Save) {
    const k = s.kin; if (!k) return;
    this.drawKin(this.w / 2, this.h * 0.9, Math.min(this.h * 0.0032, this.w * 0.004), k.arch, 0.75, true);
  }
}

function mulberry(a: number) { return () => { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hexA(hex: string, a: number) {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
