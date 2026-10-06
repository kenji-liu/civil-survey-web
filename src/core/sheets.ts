// 出圖排版：在圖紙座標（mm，左下為原點、y 向上）產生圖元，可輸出 SVG、PDF（列印）、DXF。
// 圖紙種類：平面圖（依比例分幅）、縱斷面圖（含下方資料表）、橫斷面圖（依格排列）。圖框含標題欄。
import type { XY } from './geom';
import type { Derived } from '../store/derived';
import type { Project } from './model';
import { formatStation } from './units';

export type Prim =
  | { k: 'line'; pts: XY[]; layer: string; w?: number; color?: string; dash?: boolean; closed?: boolean; fill?: string }
  | { k: 'text'; x: number; y: number; h: number; s: string; layer: string; rot?: number; anchor?: 'start' | 'middle' | 'end'; color?: string; bold?: boolean }
  | { k: 'circle'; x: number; y: number; r: number; layer: string; color?: string };

export interface Sheet { kind: 'plan' | 'profile' | 'section'; title: string; scale: string; w: number; h: number; prims: Prim[] }

export const PAPERS: Record<string, [number, number]> = { A3: [420, 297], A2: [594, 420], A1: [841, 594] };

export interface PlotSettings {
  paper: 'A3' | 'A2' | 'A1';
  planScale: number;
  profileH: number;
  profileV: number;
  sectionScale: number;
  plan: boolean; profile: boolean; section: boolean;
  /** 設計單位（標題欄） */
  org: string;
  /** 圖號前綴 */
  prefix: string;
  contours: boolean; points: boolean;
}

export const DEFAULT_PLOT: PlotSettings = {
  paper: 'A3', planScale: 1000, profileH: 1000, profileV: 200, sectionScale: 200, plan: true, profile: true, section: true,
  org: '', prefix: 'D-', contours: true, points: false,
};

const M = { l: 25, r: 10, t: 10, b: 10 };      // 圖框邊界
const TB = { w: 170, h: 30 };                   // 標題欄

function frame(sh: Sheet, p: Project, s: PlotSettings, no: string, total: string) {
  const { w, h } = sh;
  const P = sh.prims;
  P.push({ k: 'line', layer: 'FRAME', w: 0.7, closed: true, pts: [{ x: M.l, y: M.b }, { x: w - M.r, y: M.b }, { x: w - M.r, y: h - M.t }, { x: M.l, y: h - M.t }] });
  const x0 = w - M.r - TB.w, y0 = M.b;
  P.push({ k: 'line', layer: 'FRAME', w: 0.5, closed: true, pts: [{ x: x0, y: y0 }, { x: x0 + TB.w, y: y0 }, { x: x0 + TB.w, y: y0 + TB.h }, { x: x0, y: y0 + TB.h }] });
  const cells: Array<[number, number, number, number, string, string]> = [
    [0, 20, 110, 10, '工程名稱', p.info.name || '未命名工程'],
    [110, 20, 60, 10, '設計單位', s.org || p.info.owner || ''],
    [0, 10, 110, 10, '圖　　名', sh.title],
    [110, 10, 60, 10, '比 例 尺', sh.scale],
    [0, 0, 55, 10, '設 計 者', p.info.designer || ''],
    [55, 0, 55, 10, '日　　期', new Date().toISOString().slice(0, 10)],
    [110, 0, 60, 10, '圖　　號', `${s.prefix}${no}／${total}`],
  ];
  for (const [cx, cy, cw, chh, lab, val] of cells) {
    P.push({ k: 'line', layer: 'FRAME', w: 0.25, closed: true, pts: [{ x: x0 + cx, y: y0 + cy }, { x: x0 + cx + cw, y: y0 + cy }, { x: x0 + cx + cw, y: y0 + cy + chh }, { x: x0 + cx, y: y0 + cy + chh }] });
    P.push({ k: 'text', layer: 'FRAME', x: x0 + cx + 2, y: y0 + cy + 3.2, h: 2.2, s: lab, color: '#555' });
    P.push({ k: 'text', layer: 'FRAME', x: x0 + cx + 18, y: y0 + cy + 3, h: 3.2, s: val, bold: true });
  }
}

/** 以 Liang–Barsky 把折線裁切到矩形內，回傳若干段 */
function clipPolyline(pts: XY[], x0: number, y0: number, x1: number, y1: number): XY[][] {
  const out: XY[][] = [];
  let cur: XY[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const pq: Array<[number, number]> = [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]];
    let ok = true;
    for (const [pp, q] of pq) {
      if (pp === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / pp;
      if (pp < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    const A = { x: a.x + t0 * dx, y: a.y + t0 * dy }, B = { x: a.x + t1 * dx, y: a.y + t1 * dy };
    if (!cur.length || t0 > 0) { if (cur.length > 1) out.push(cur); cur = [A]; }
    cur.push(B);
    if (t1 < 1) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// ---------------- 平面圖 ----------------
function planSheets(p: Project, d: Derived, s: PlotSettings): Sheet[] {
  const [W, H] = PAPERS[s.paper];
  const pts: XY[] = [];
  if (d.tin) for (let i = 0; i < d.tin.xs.length; i += Math.max(1, Math.floor(d.tin.xs.length / 2000))) pts.push({ x: d.tin.xs[i], y: d.tin.ys[i] });
  else p.points.forEach(q => pts.push(q));
  d.alignment?.input.ips.forEach(q => pts.push(q));
  if (!pts.length) return [];
  const bx0 = Math.min(...pts.map(q => q.x)), bx1 = Math.max(...pts.map(q => q.x)), by0 = Math.min(...pts.map(q => q.y)), by1 = Math.max(...pts.map(q => q.y));
  const k = 1000 / s.planScale; // mm / m
  const ax0 = M.l + 5, ax1 = W - M.r - 5, ay0 = M.b + TB.h + 5, ay1 = H - M.t - 5;
  const tileW = (ax1 - ax0) / k, tileH = (ay1 - ay0) / k;
  const nx = Math.max(1, Math.ceil((bx1 - bx0) / tileW)), ny = Math.max(1, Math.ceil((by1 - by0) / tileH));
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const gx0 = cx - (nx * tileW) / 2, gy0 = cy - (ny * tileH) / 2;
  const sheets: Sheet[] = [];
  const L = new Map(p.legend.map(l => [l.code.toUpperCase(), l]));
  for (let j = ny - 1; j >= 0; j--) for (let i = 0; i < nx; i++) {
    const wx0 = gx0 + i * tileW, wy0 = gy0 + j * tileH, wx1 = wx0 + tileW, wy1 = wy0 + tileH;
    const X = (x: number) => ax0 + (x - wx0) * k, Y = (y: number) => ay0 + (y - wy0) * k;
    const sh: Sheet = { kind: 'plan', title: '平面圖', scale: `1/${s.planScale}`, w: W, h: H, prims: [] };
    const add = (line: XY[], layer: string, w: number, color?: string, dash?: boolean) => {
      for (const seg of clipPolyline(line, wx0, wy0, wx1, wy1)) sh.prims.push({ k: 'line', layer, w, color, dash, pts: seg.map(q => ({ x: X(q.x), y: Y(q.y) })) });
    };
    const inWin = (q: XY) => q.x >= wx0 && q.x <= wx1 && q.y >= wy0 && q.y <= wy1;
    // 座標方格十字
    const step = s.planScale <= 500 ? 50 : s.planScale <= 1000 ? 100 : 200;
    for (let gx = Math.ceil(wx0 / step) * step; gx <= wx1; gx += step) for (let gy = Math.ceil(wy0 / step) * step; gy <= wy1; gy += step) {
      add([{ x: gx - 2 / k * 2, y: gy }, { x: gx + 2 / k * 2, y: gy }], 'GRID', 0.18);
      add([{ x: gx, y: gy - 2 / k * 2 }, { x: gx, y: gy + 2 / k * 2 }], 'GRID', 0.18);
    }
    for (let gx = Math.ceil(wx0 / step) * step; gx <= wx1; gx += step) sh.prims.push({ k: 'text', layer: 'GRID', x: X(gx), y: ay0 + 1, h: 1.8, s: `E${gx}`, anchor: 'middle', color: '#666' });
    for (let gy = Math.ceil(wy0 / step) * step; gy <= wy1; gy += step) sh.prims.push({ k: 'text', layer: 'GRID', x: ax0 + 1, y: Y(gy) + 0.6, h: 1.8, s: `N${gy}`, color: '#666' });
    if (s.contours) for (const c of d.contours) add(c.pts, c.major ? 'CONT5' : 'CONT1', c.major ? 0.3 : 0.13, '#a0522d');
    if (s.points) for (const q of p.points) if (q.z !== null && inWin(q)) {
      sh.prims.push({ k: 'circle', layer: 'POINTS', x: X(q.x), y: Y(q.y), r: 0.3 });
      sh.prims.push({ k: 'text', layer: 'PT_ELEV', x: X(q.x) + 0.6, y: Y(q.y) + 0.4, h: 1.2, s: q.z.toFixed(2) });
    }
    if (d.sam) {
      for (const ln of d.sam.lines) add(ln.closed ? [...ln.pts, ln.pts[0]] : ln.pts, L.get(ln.feature)?.layer ?? 'SAM', 0.35, '#000', L.get(ln.feature)?.style === 'dash');
      for (const sy of d.sam.symbols) if (inWin(sy)) sh.prims.push({ k: 'circle', layer: L.get(sy.feature)?.layer ?? 'SAM', x: X(sy.x), y: Y(sy.y), r: 0.8 });
      for (const c of d.sam.circles) if (inWin(c.c)) sh.prims.push({ k: 'circle', layer: 'SAM', x: X(c.c.x), y: Y(c.c.y), r: c.r * k });
    }
    if (p.boundary) add([...p.boundary, p.boundary[0]], 'BOUNDARY', 0.25, '#888', true);
    const al = d.alignment;
    if (al) {
      add(al.input.ips, 'IP_LINE', 0.18, '#c00', true);
      const cl: XY[] = [];
      for (let st = al.startStation; st <= al.endStation; st += Math.max(al.length / 1500, 0.5)) cl.push(al.pointAt(st)!);
      cl.push(al.pointAt(al.endStation)!);
      add(cl, 'AXIS', 0.6, '#c00');
      for (const stk of al.stakes) {
        if (!inWin(stk)) continue;
        const a = al.pointAt(stk.sta, -2)!, b = al.pointAt(stk.sta, 2)!;
        add([a, b], 'STAKE', 0.25, '#c00');
        const rot = (-stk.az * 180) / Math.PI; // 沿右側法線方向
        const tip = al.pointAt(stk.sta, 3)!;
        sh.prims.push({ k: 'text', layer: 'STAKE_TXT', x: X(tip.x), y: Y(tip.y), h: 1.8, s: `${stk.label ? stk.label + ' ' : ''}${formatStation(stk.sta, stk.kind === 'full' ? 0 : 2)}`, rot: rot > 90 || rot < -90 ? rot + 180 : rot, anchor: rot > 90 || rot < -90 ? 'end' : 'start', color: '#c00' });
      }
      for (const ip of al.input.ips) if (inWin(ip)) sh.prims.push({ k: 'text', layer: 'IP_LINE', x: X(ip.x) + 1, y: Y(ip.y) + 1, h: 2.2, s: ip.name, color: '#c00', bold: true });
    }
    for (const c of p.controls) if (inWin(c)) {
      const x = X(c.x), y = Y(c.y);
      sh.prims.push({ k: 'line', layer: 'CONTROL', w: 0.3, closed: true, pts: [{ x, y: y + 1.6 }, { x: x + 1.4, y: y - 0.8 }, { x: x - 1.4, y: y - 0.8 }] });
      sh.prims.push({ k: 'text', layer: 'CONTROL', x: x + 2, y: y + 1, h: 2, s: c.name, bold: true });
    }
    // 只有方格十字、沒有其他內容的分幅不出圖
    if (!sh.prims.some(q => q.layer !== 'GRID')) continue;
    // 指北
    const nX = ax1 - 12, nY = ay1 - 18;
    sh.prims.push({ k: 'line', layer: 'FRAME', w: 0.35, closed: true, fill: '#000', pts: [{ x: nX, y: nY + 12 }, { x: nX + 3, y: nY }, { x: nX, y: nY + 3 }, { x: nX - 3, y: nY }] });
    sh.prims.push({ k: 'text', layer: 'FRAME', x: nX, y: nY + 13.5, h: 3.5, s: 'N', anchor: 'middle', bold: true });
    sheets.push(sh);
  }
  if (sheets.length > 1) sheets.forEach((sh, i) => { sh.title = `平面圖（${i + 1}/${sheets.length}）`; });
  return sheets;
}

// ---------------- 縱斷面圖 ----------------
function profileSheets(_p: Project, d: Derived, s: PlotSettings): Sheet[] {
  const al = d.alignment;
  if (!al || !d.groundLine.length) return [];
  const [W, H] = PAPERS[s.paper];
  const kh = 1000 / s.profileH, kv = 1000 / s.profileV;
  const labW = 26, rowH = 9, rows = ['樁　號', '地 面 高', '設 計 高', '挖 填 高'];
  const ax0 = M.l + 5 + labW, ax1 = W - M.r - 5, by0 = M.b + TB.h + 6, ay0 = by0 + rows.length * rowH + 4, ay1 = H - M.t - 8;
  const span = (ax1 - ax0) / kh;
  const nSheets = Math.max(1, Math.ceil(al.length / span - 1e-9));
  const sheets: Sheet[] = [];
  const designAt = (st: number) => d.profile.elevAt(st);
  for (let n = 0; n < nSheets; n++) {
    const s0 = al.startStation + n * span, s1 = Math.min(al.endStation, s0 + span);
    const sh: Sheet = { kind: 'profile', title: nSheets > 1 ? `縱斷面圖（${formatStation(s0, 0)}～${formatStation(s1, 0)}）` : '縱斷面圖', scale: `H 1/${s.profileH}　V 1/${s.profileV}`, w: W, h: H, prims: [] };
    const zs: number[] = [];
    d.groundLine.forEach(g => { if (g.sta >= s0 - 1e-6 && g.sta <= s1 + 1e-6 && g.z !== null) zs.push(g.z); });
    for (let st = s0; st <= s1; st += Math.max(span / 200, 0.5)) { const z = designAt(st); if (z !== null) zs.push(z); }
    if (!zs.length) continue;
    let z0 = Math.floor(Math.min(...zs) - 2);
    const maxH = (ay1 - ay0) / kv;
    if (Math.max(...zs) - z0 > maxH) z0 = Math.floor(Math.max(...zs) - maxH + 1);
    const X = (st: number) => ax0 + (st - s0) * kh, Y = (z: number) => ay0 + (z - z0) * kv;
    const P = sh.prims;
    const zTop = z0 + maxH;
    // 方格：每 1 m 細線、每 5 m 粗線
    const zStep = kv >= 10 ? 1 : kv >= 4 ? 2 : 5;
    for (let z = Math.ceil(z0 / zStep) * zStep; z <= zTop; z += zStep) {
      P.push({ k: 'line', layer: 'GRID', w: z % (zStep * 5) === 0 ? 0.25 : 0.1, color: '#bbb', pts: [{ x: ax0, y: Y(z) }, { x: X(s1), y: Y(z) }] });
      if (z % (zStep * 5) === 0) P.push({ k: 'text', layer: 'GRID', x: ax0 - 1, y: Y(z) - 0.8, h: 2, s: String(z), anchor: 'end' });
    }
    P.push({ k: 'text', layer: 'GRID', x: ax0 - labW, y: ay0 + 1, h: 2.4, s: `DL=${z0.toFixed(2)}`, bold: true });
    // 資料表
    rows.forEach((r, i) => {
      const y = by0 + (rows.length - 1 - i) * rowH;
      P.push({ k: 'line', layer: 'TABLE', w: 0.25, closed: true, pts: [{ x: ax0 - labW, y }, { x: X(s1), y }, { x: X(s1), y: y + rowH }, { x: ax0 - labW, y: y + rowH }] });
      P.push({ k: 'text', layer: 'TABLE', x: ax0 - labW + 2, y: y + 3, h: 2.6, s: r, bold: true });
    });
    P.push({ k: 'line', layer: 'TABLE', w: 0.25, pts: [{ x: ax0, y: by0 }, { x: ax0, y: by0 + rows.length * rowH }] });
    // 地面線、設計線
    const gl = d.groundLine.filter(g => g.sta >= s0 - 1e-6 && g.sta <= s1 + 1e-6 && g.z !== null).map(g => ({ x: X(g.sta), y: Y(g.z!) }));
    P.push({ k: 'line', layer: 'PROF_GROUND', w: 0.3, color: '#2f855a', pts: gl });
    const dl: XY[] = [];
    for (let st = s0; st <= s1 + 1e-6; st += Math.max(span / 400, 0.25)) { const z = designAt(Math.min(st, s1)); if (z !== null) dl.push({ x: X(Math.min(st, s1)), y: Y(z) }); }
    P.push({ k: 'line', layer: 'PROF_DESIGN', w: 0.6, color: '#c05621', pts: dl });
    // 每樁：刻線與資料
    for (const r of d.stakeRows) {
      if (r.stake.sta < s0 - 1e-6 || r.stake.sta > s1 + 1e-6) continue;
      const x = X(r.stake.sta);
      P.push({ k: 'line', layer: 'GRID', w: 0.1, color: '#999', pts: [{ x, y: by0 + rows.length * rowH }, { x, y: r.ground !== null ? Y(r.ground) : ay0 }] });
      const vals = [`${r.stake.label ? r.stake.label + ' ' : ''}${formatStation(r.stake.sta)}`, r.ground?.toFixed(2) ?? '', r.design?.toFixed(2) ?? '', r.dh === null ? '' : `${r.dh >= 0 ? '+' : ''}${r.dh.toFixed(2)}`];
      vals.forEach((v, i) => {
        const y = by0 + (rows.length - 1 - i) * rowH;
        P.push({ k: 'text', layer: 'TABLE', x: x + 0.8, y: y + 0.8, h: 1.8, s: v, rot: 90, color: i === 3 && r.dh !== null ? (r.dh >= 0 ? '#c53030' : '#2b6cb0') : undefined });
      });
    }
    // VPI 與坡度
    const v = d.profile.vpis;
    v.forEach((q, i) => {
      if (q.sta < s0 - 1e-6 || q.sta > s1 + 1e-6) return;
      P.push({ k: 'circle', layer: 'PROF_VPI', x: X(q.sta), y: Y(q.z), r: 0.8, color: '#c00' });
      if (i > 0 && i < v.length - 1) {
        const c = d.profile.curves.find(cc => cc.index === i);
        P.push({ k: 'line', layer: 'PROF_VPI', w: 0.18, color: '#c00', pts: [{ x: X(q.sta), y: Y(q.z) + 2 }, { x: X(q.sta), y: Y(q.z) + 18 }] });
        P.push({ k: 'text', layer: 'PROF_VPI', x: X(q.sta) - 0.8, y: Y(q.z) + 3, h: 1.9, rot: 90, s: `VPI ${formatStation(q.sta)} EL=${q.z.toFixed(3)}${c ? ` L=${c.L} e=${c.e.toFixed(3)}` : ''}`, color: '#c00' });
      }
    });
    d.profile.grades.forEach((g, i) => {
      const a = v[i], b = v[i + 1];
      const m = Math.max(s0, Math.min(s1, (a.sta + b.sta) / 2));
      const zm = a.z + g * (m - a.sta);
      if (m <= s0 || m >= s1) return;
      P.push({ k: 'text', layer: 'PROF_DESIGN', x: X(m), y: Y(zm) - 4, h: 2, s: `i=${(g * 100).toFixed(2)}%  L=${(b.sta - a.sta).toFixed(1)}`, anchor: 'middle', color: '#c05621' });
    });
    sheets.push(sh);
  }
  return sheets;
}

// ---------------- 橫斷面圖 ----------------
function sectionSheets(_p: Project, d: Derived, s: PlotSettings): Sheet[] {
  const secs = d.sections.filter(r => r.result);
  if (!secs.length) return [];
  const [W, H] = PAPERS[s.paper];
  const k = 1000 / s.sectionScale;
  // 地面線只取設計線兩端外 5 m，避免圖面被取樣寬度撐大
  const cropped = new Map(secs.map(r => {
    const des = r.result!.design;
    const o0 = Math.min(...des.map(q => q.o)) - 5, o1 = Math.max(...des.map(q => q.o)) + 5;
    return [r, r.result!.ground.filter(q => q.o >= o0 && q.o <= o1)];
  }));
  // 每個斷面用自己的寬高（中心線兩側不對稱也照實際範圍），由左而右、由上而下排列（貨架式排版）
  const boxes = secs.map(r => {
    const g = cropped.get(r)!, des = r.result!.design;
    const all = [...g, ...des];
    const oL = Math.min(...all.map(q => q.o)), oR = Math.max(...all.map(q => q.o));
    const zs = all.map(q => q.z);
    const zb = Math.floor(Math.min(...zs) - 0.5);
    const w = (oR - oL) * k + 8, h = (Math.max(...zs) - zb) * k + 16;
    return { r, g, oL, zb, w: Math.max(w, 60), h };
  });
  const ax0 = M.l + 4, ax1 = W - M.r - 4, ay0 = M.b + TB.h + 4, ay1 = H - M.t - 4;
  const sheets: Sheet[] = [];
  let i = 0;
  while (i < boxes.length) {
    const sh: Sheet = { kind: 'section', title: '', scale: `1/${s.sectionScale}`, w: W, h: H, prims: [] };
    const P = sh.prims;
    const first = i;
    let top = ay1;
    while (i < boxes.length) {
      // 排一列
      let x = ax0, rowH = 0, j = i;
      while (j < boxes.length && (x + boxes[j].w <= ax1 || j === i)) { rowH = Math.max(rowH, boxes[j].h); x += boxes[j].w; j++; }
      if (top - rowH < ay0 && i > first) break; // 這張放不下，換下一張
      x = ax0;
      for (let q = i; q < j; q++) {
        const { r, g, oL, zb, w, h } = boxes[q];
        const res = r.result!;
        const ox = x + 4 - oL * k;              // o = 0 的紙面 x
        const yb = top - h + 8;                 // DL 的紙面 y
        const X = (o: number) => ox + o * k, Y = (z: number) => yb + (z - zb) * k;
        P.push({ k: 'line', layer: 'SEC_GROUND', w: 0.25, color: '#2f855a', pts: g.map(v => ({ x: X(v.o), y: Y(v.z) })) });
        P.push({ k: 'line', layer: 'SEC_DESIGN', w: 0.5, color: '#c05621', pts: res.design.map(v => ({ x: X(v.o), y: Y(v.z) })) });
        for (const sol of r.solids ?? []) P.push({ k: 'line', layer: 'SEC_STRUCT', w: 0.3, closed: true, fill: '#ddd', pts: sol.poly.map(v => ({ x: X(v.o), y: Y(v.z) })) });
        P.push({ k: 'line', layer: 'SEC_CL', w: 0.18, color: '#c00', dash: true, pts: [{ x: X(0), y: yb }, { x: X(0), y: Y(res.zc) + 5 }] });
        P.push({ k: 'line', layer: 'SEC_DL', w: 0.18, pts: [{ x: x + 2, y: yb }, { x: x + w - 2, y: yb }] });
        P.push({ k: 'text', layer: 'SEC_TXT', x: x + 2, y: yb + 0.8, h: 1.6, s: `DL=${zb.toFixed(2)}` });
        P.push({ k: 'text', layer: 'SEC_TXT', x: X(0), y: top - 3.5, h: 2.6, s: `${r.stake.label ? r.stake.label + '  ' : ''}${formatStation(r.stake.sta)}`, anchor: 'middle', bold: true });
        P.push({ k: 'text', layer: 'SEC_TXT', x: x + w / 2, y: yb - 3.6, h: 1.9, s: `At=${res.cutArea.toFixed(2)}m²  Af=${res.fillArea.toFixed(2)}m²  FH=${res.zc.toFixed(2)}`, anchor: 'middle' });
        x += w;
      }
      top -= rowH;
      i = j;
    }
    sh.title = `橫斷面圖（${formatStation(boxes[first].r.stake.sta, 0)}～${formatStation(boxes[i - 1].r.stake.sta, 0)}）`;
    sheets.push(sh);
  }
  return sheets;
}

export function buildSheets(p: Project, d: Derived, s: PlotSettings): Sheet[] {
  const sheets = [...(s.plan ? planSheets(p, d, s) : []), ...(s.profile ? profileSheets(p, d, s) : []), ...(s.section ? sectionSheets(p, d, s) : [])];
  sheets.forEach((sh, i) => frame(sh, p, s, String(i + 1), String(sheets.length)));
  return sheets;
}

// ---------------- 輸出 ----------------
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function sheetToSvg(sh: Sheet): string {
  const H = sh.h;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${sh.w}mm" height="${sh.h}mm" viewBox="0 0 ${sh.w} ${sh.h}" font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif"><rect width="${sh.w}" height="${sh.h}" fill="#fff"/>`];
  const f = (v: number) => v.toFixed(2);
  for (const q of sh.prims) {
    if (q.k === 'line') {
      if (q.pts.length < 2) continue;
      const d = q.pts.map((pt, i) => `${i ? 'L' : 'M'}${f(pt.x)} ${f(H - pt.y)}`).join('') + (q.closed ? 'Z' : '');
      out.push(`<path d="${d}" fill="${q.fill ?? 'none'}" stroke="${q.color ?? '#000'}" stroke-width="${q.w ?? 0.25}"${q.dash ? ' stroke-dasharray="2 1"' : ''} stroke-linejoin="round"/>`);
    } else if (q.k === 'circle') {
      out.push(`<circle cx="${f(q.x)}" cy="${f(H - q.y)}" r="${f(q.r)}" fill="none" stroke="${q.color ?? '#000'}" stroke-width="0.25"/>`);
    } else {
      const rot = q.rot ? ` transform="rotate(${f(-q.rot)} ${f(q.x)} ${f(H - q.y)})"` : '';
      out.push(`<text x="${f(q.x)}" y="${f(H - q.y)}" font-size="${q.h}" fill="${q.color ?? '#000'}"${q.bold ? ' font-weight="700"' : ''} text-anchor="${q.anchor ?? 'start'}"${rot}>${esc(q.s)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}
