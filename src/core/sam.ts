// 自動連線成圖（S.A.M，依手冊第七章）
// 測點代碼 = 地類屬性 + 線別號碼 + 連線控制碼 + 附加部份；共點地物以「.」隔開，樓層註記以「..」開頭。
//   英文碼：BD1L、RD2B、IC2O3.5、BD1D-5-1.5+4.5、Q3G105、BD1L..3R、BD1L.BW1S.E
//   數字碼：1512（15 房屋、線別 1、控制碼 2=轉折點）、10（獨立物：電力桿）
import type { XY } from './geom';
import { polygonCentroid } from './geom';

export type Ctrl = 'S' | 'R' | 'L' | 'B' | 'M' | 'A' | 'O' | 'D' | 'T' | 'X' | 'Z' | 'C' | 'F' | 'E' | 'G' | 'N';
const NUM_CTRL: Record<string, Ctrl> = { '0': 'S', '1': 'R', '2': 'L', '3': 'B', '4': 'M', '5': 'A', '6': 'O', '7': 'D', '8': 'T', '9': 'X' };

export const CTRL_INFO: Array<[Ctrl, string, string]> = [
  ['S', '0', '正向線形起點'], ['R', '1', '反向線形起點'], ['L', '2', '轉折點'], ['B', '3', '切線弧上任意點'],
  ['M', '4', '三點弧中間點'], ['A', '5', '三點弧終點'], ['O', '6', '圓心（加半徑）'], ['D', '7', '直角支距加點'],
  ['T', '8', 'T 形分叉端點'], ['X', '9', '終點直角互交第一直線'], ['Z', 'Z', '終點平行交會第一直線'], ['C', 'C', '直線閉合至起點'],
  ['F', 'F', '弧線閉合至起點'], ['E', 'E', '線形終點'], ['G', 'G', '連接至其他點號'], ['N', 'N', '結束所有線形、新起點'],
];

export type LineStyle = 'solid' | 'dash' | 'dot' | 'wall' | 'bank' | 'fence';
export type SymbolKind = 'pole' | 'tel' | 'lamp' | 'hydrant' | 'manhole' | 'tree' | 'mark';

export interface LegendItem {
  /** 英文地類碼 */
  code: string;
  /** 數字地類碼（兩碼） */
  num: string;
  name: string;
  kind: 'line' | 'point' | 'none';
  color: string;
  layer: string;
  style: LineStyle;
  symbol: SymbolKind;
  /** 當作三角網斷線（地形線：坎、溝、路緣） */
  breakline: boolean;
}

/** 預設圖例庫：常用地物（可在介面中修改） */
export const DEFAULT_LEGEND: LegendItem[] = [
  { code: 'E', num: '10', name: '電力桿', kind: 'point', color: '#ffd166', layer: 'SAM_POLE', style: 'solid', symbol: 'pole', breakline: false },
  { code: 'T', num: '11', name: '電信桿', kind: 'point', color: '#ffd166', layer: 'SAM_POLE', style: 'solid', symbol: 'tel', breakline: false },
  { code: 'BW', num: '12', name: '圍牆', kind: 'line', color: '#a0aec0', layer: 'SAM_WALL', style: 'wall', symbol: 'mark', breakline: false },
  { code: 'RD', num: '13', name: '路邊線', kind: 'line', color: '#ffffff', layer: 'SAM_ROAD', style: 'solid', symbol: 'mark', breakline: true },
  { code: 'I', num: '14', name: '路燈', kind: 'point', color: '#fefcbf', layer: 'SAM_LAMP', style: 'solid', symbol: 'lamp', breakline: false },
  { code: 'BD', num: '15', name: '房屋', kind: 'line', color: '#fc8181', layer: 'SAM_BLDG', style: 'solid', symbol: 'mark', breakline: false },
  { code: 'GS', num: '16', name: '駁坎', kind: 'line', color: '#b794f4', layer: 'SAM_BANK', style: 'bank', symbol: 'mark', breakline: true },
  { code: 'DC', num: '17', name: '水溝', kind: 'line', color: '#63b3ed', layer: 'SAM_DITCH', style: 'solid', symbol: 'mark', breakline: true },
  { code: 'RV', num: '18', name: '溪流水線', kind: 'line', color: '#4299e1', layer: 'SAM_RIVER', style: 'dash', symbol: 'mark', breakline: true },
  { code: 'IC', num: '19', name: '分隔島', kind: 'line', color: '#68d391', layer: 'SAM_ISLAND', style: 'solid', symbol: 'mark', breakline: false },
  { code: 'PA', num: '20', name: '田埂', kind: 'line', color: '#c6f6d5', layer: 'SAM_PADDY', style: 'dot', symbol: 'mark', breakline: false },
  { code: 'FO', num: '21', name: '鐵柵', kind: 'line', color: '#a0aec0', layer: 'SAM_FENCE', style: 'fence', symbol: 'mark', breakline: false },
  { code: 'WF', num: '22', name: '鐵絲網', kind: 'line', color: '#a0aec0', layer: 'SAM_FENCE', style: 'fence', symbol: 'mark', breakline: false },
  { code: 'Q', num: '23', name: '竹垣', kind: 'line', color: '#9ae6b4', layer: 'SAM_HEDGE', style: 'dot', symbol: 'mark', breakline: false },
  { code: 'EM', num: '24', name: '電力人孔', kind: 'point', color: '#ffd166', layer: 'SAM_MANHOLE', style: 'solid', symbol: 'manhole', breakline: false },
  { code: 'F', num: '25', name: '消防栓', kind: 'point', color: '#fc8181', layer: 'SAM_HYDRANT', style: 'solid', symbol: 'hydrant', breakline: false },
  { code: 'TR', num: '26', name: '獨立樹', kind: 'point', color: '#68d391', layer: 'SAM_TREE', style: 'solid', symbol: 'tree', breakline: false },
  { code: 'BO', num: '27', name: '防風林', kind: 'line', color: '#68d391', layer: 'SAM_VEG', style: 'dot', symbol: 'mark', breakline: false },
  { code: 'BOO', num: '35', name: '竹林', kind: 'line', color: '#9ae6b4', layer: 'SAM_VEG', style: 'dot', symbol: 'mark', breakline: false },
  { code: 'GND', num: '90', name: '地面高程點', kind: 'none', color: '#3ddc84', layer: 'POINTS', style: 'solid', symbol: 'mark', breakline: false },
];

export interface SamToken { feature: string; lineNo: string | null; ctrl: Ctrl | null; extra: string; raw: string }

/** 解析一個測點代碼（可能含多個共點地物與樓層註記） */
export function parseCode(code: string): { tokens: SamToken[]; note: string | null } {
  const c = code.trim().toUpperCase();
  if (!c) return { tokens: [], note: null };
  const di = c.indexOf('..');
  const body = di >= 0 ? c.slice(0, di) : c;
  const note = di >= 0 ? c.slice(di + 2).trim() || null : null;
  const numeric = /^\d/.test(body);
  // 英文碼：「.」後面接字母才是共點分隔（IC2O3.5 的 .5 是半徑小數）；數字碼：每個「.」都是分隔
  const parts = numeric ? body.split('.') : body.split(/\.(?=[A-Z])/);
  const tokens: SamToken[] = [];
  for (const raw of parts.map(s => s.trim()).filter(Boolean)) {
    let m: RegExpMatchArray | null;
    if (numeric) {
      if ((m = raw.match(/^(\d{2})(\d)([0-9ZCFEGN])?(.*)$/))) tokens.push({ feature: m[1], lineNo: m[2], ctrl: m[3] ? (NUM_CTRL[m[3]] ?? (m[3] as Ctrl)) : 'L', extra: m[4], raw });
      else if ((m = raw.match(/^(\d{2})$/))) tokens.push({ feature: m[1], lineNo: null, ctrl: null, extra: '', raw });
      else tokens.push({ feature: raw, lineNo: null, ctrl: null, extra: '', raw });
    } else {
      if ((m = raw.match(/^([A-Z]+?)(\d)([SRLBMAODTXZCFEGN])?(.*)$/))) tokens.push({ feature: m[1], lineNo: m[2], ctrl: (m[3] as Ctrl) ?? 'L', extra: m[4], raw });
      else tokens.push({ feature: raw.replace(/[^A-Z]/g, ''), lineNo: null, ctrl: null, extra: '', raw });
    }
  }
  return { tokens, note };
}

export interface SamInputPoint { name: string; x: number; y: number; z: number | null; code?: string }
export interface SamVertex { x: number; y: number; z: number | null; /** 原始測點名；弧線加密或支距推算的點為空 */ src: string | null }
export interface SamLine { feature: string; lineNo: string; pts: SamVertex[]; closed: boolean; reverse: boolean; label: string | null; labelAt: XY | null; branch?: boolean }
export interface SamSymbol { feature: string; x: number; y: number; z: number | null; name: string }
export interface SamCircle { feature: string; c: XY; r: number; name: string }
export interface SamError { point: string; code: string; msg: string }
export interface SamResult { lines: SamLine[]; symbols: SamSymbol[]; circles: SamCircle[]; errors: SamError[]; unknown: Map<string, number> }

interface OpenLine {
  feature: string; lineNo: string; reverse: boolean;
  pts: SamVertex[];
  /** 原始測點頂點在 pts 中的索引 */
  rawIdx: number[];
  pendingMid: SamVertex | null;
  /** 末端切線方向（單位向量） */
  dir: XY | null;
  label: string | null;
}

export function runSam(points: SamInputPoint[], legend: LegendItem[]): SamResult {
  const byCode = new Map<string, LegendItem>();
  for (const l of legend) { byCode.set(l.code.toUpperCase(), l); if (l.num) byCode.set(l.num, l); }
  const byName = new Map(points.map(p => [p.name, p]));
  const res: SamResult = { lines: [], symbols: [], circles: [], errors: [], unknown: new Map() };
  const open = new Map<string, OpenLine>();
  const canon = (f: string) => byCode.get(f)?.code ?? f;

  const finish = (L: OpenLine, closed = false) => {
    if (L.pendingMid) addStraight(L, L.pendingMid);
    open.delete(`${L.feature}|${L.lineNo}`);
    if (L.pts.length < 2) return;
    const line: SamLine = { feature: L.feature, lineNo: L.lineNo, pts: L.pts, closed, reverse: L.reverse, label: L.label, labelAt: null };
    if (L.label) line.labelAt = closed && L.pts.length >= 3 ? polygonCentroid(L.pts) : L.pts[Math.floor(L.pts.length / 2)];
    res.lines.push(line);
  };
  const start = (key: string, feature: string, lineNo: string, v: SamVertex, reverse: boolean): OpenLine => {
    const L: OpenLine = { feature, lineNo, reverse, pts: [v], rawIdx: [0], pendingMid: null, dir: null, label: null };
    open.set(key, L);
    return L;
  };
  const last = (L: OpenLine) => L.pts[L.pts.length - 1];
  const addStraight = (L: OpenLine, v: SamVertex) => {
    const a = last(L);
    const d = Math.hypot(v.x - a.x, v.y - a.y);
    if (d > 1e-9) L.dir = { x: (v.x - a.x) / d, y: (v.y - a.y) / d };
    L.pts.push(v);
    if (v.src !== null) L.rawIdx.push(L.pts.length - 1);
  };
  const addArc3 = (L: OpenLine, m: SamVertex, b: SamVertex) => {
    const a = last(L);
    const arc = arcThrough(a, m, b);
    if (!arc) { addStraight(L, m); addStraight(L, b); return; }
    const pts = sampleArc(arc.c, arc.r, arc.a0, arc.sweep, a, b);
    // 中間點 m 也是原始測點：插在最接近的位置
    for (const q of pts.slice(1, -1)) L.pts.push(q);
    L.pts.push(b);
    L.rawIdx.push(L.pts.length - 1);
    L.dir = arcEndDir(arc.c, b, arc.sweep);
  };
  const addTangentArc = (L: OpenLine, b: SamVertex) => {
    const a = last(L);
    if (!L.dir) { addStraight(L, b); return; }
    const t = L.dir;
    const n = { x: -t.y, y: t.x }; // 左法向
    const dx = b.x - a.x, dy = b.y - a.y;
    const s = n.x * dx + n.y * dy;
    const d2 = dx * dx + dy * dy;
    if (Math.abs(s) < 1e-9 * Math.sqrt(d2) + 1e-12) { addStraight(L, b); return; }
    const r = d2 / (2 * s); // 正：左轉；負：右轉
    const c = { x: a.x + n.x * r, y: a.y + n.y * r };
    const a0 = Math.atan2(a.y - c.y, a.x - c.x), a1 = Math.atan2(b.y - c.y, b.x - c.x);
    let sweep = a1 - a0;
    if (r > 0) { while (sweep <= 0) sweep += 2 * Math.PI; } else { while (sweep >= 0) sweep -= 2 * Math.PI; }
    const pts = sampleArc(c, Math.abs(r), a0, sweep, a, b);
    for (const q of pts.slice(1, -1)) L.pts.push(q);
    L.pts.push(b);
    L.rawIdx.push(L.pts.length - 1);
    L.dir = arcEndDir(c, b, sweep);
  };
  /** 一般加點：若前面有三點弧中間點，就畫三點弧 */
  const addPoint = (L: OpenLine, v: SamVertex) => {
    if (L.pendingMid) { const m = L.pendingMid; L.pendingMid = null; addArc3(L, m, v); }
    else addStraight(L, v);
  };

  for (const p of points) {
    if (!p.code) continue;
    const { tokens, note } = parseCode(p.code);
    const v: SamVertex = { x: p.x, y: p.y, z: p.z, src: p.name };
    for (const tk of tokens) {
      const feature = canon(tk.feature);
      const item = byCode.get(feature);
      if (tk.lineNo === null) {
        // 獨立物
        if (item?.kind === 'point') res.symbols.push({ feature, x: p.x, y: p.y, z: p.z, name: p.name });
        else if (!item) res.unknown.set(feature, (res.unknown.get(feature) ?? 0) + 1);
        continue;
      }
      if (!item) res.unknown.set(feature, (res.unknown.get(feature) ?? 0) + 1);
      const key = `${feature}|${tk.lineNo}`;
      let L = open.get(key);
      const err = (msg: string) => res.errors.push({ point: p.name, code: tk.raw, msg });
      switch (tk.ctrl) {
        case 'N':
          for (const o of [...open.values()]) finish(o);
          L = start(key, feature, tk.lineNo, v, false);
          break;
        case 'S': case 'R':
          if (L) finish(L);
          L = start(key, feature, tk.lineNo, v, tk.ctrl === 'R');
          break;
        case 'L':
          if (!L) L = start(key, feature, tk.lineNo, v, false); else addPoint(L, v);
          break;
        case 'B':
          if (!L) L = start(key, feature, tk.lineNo, v, false);
          else if (L.pendingMid) addPoint(L, v);
          else addTangentArc(L, v);
          break;
        case 'M':
          if (!L) L = start(key, feature, tk.lineNo, v, false);
          else { if (L.pendingMid) addStraight(L, L.pendingMid); L.pendingMid = v; }
          break;
        case 'A':
          if (!L) L = start(key, feature, tk.lineNo, v, false);
          else if (L.pendingMid) addPoint(L, v);
          else if (L.rawIdx.length >= 2) {
            // 把最後一段直線改成通過前兩點與本點的三點弧
            const iPrev = L.rawIdx[L.rawIdx.length - 1], iPrev2 = L.rawIdx[L.rawIdx.length - 2];
            const mid = L.pts[iPrev];
            L.pts.length = iPrev2 + 1;
            L.rawIdx.pop();
            addArc3(L, mid, v);
          } else addStraight(L, v);
          break;
        case 'O': {
          const r = Number(tk.extra);
          if (!(r > 0)) err('圓心點需在代碼後加半徑，例如 IC2O3.5');
          else res.circles.push({ feature, c: { x: p.x, y: p.y }, r, name: p.name });
          break;
        }
        case 'D': {
          if (!L) L = start(key, feature, tk.lineNo, v, false); else addPoint(L, v);
          const offs = [...tk.extra.matchAll(/([+-]?)(\d+(?:\.\d+)?)/g)];
          if (!offs.length) { err('直角支距加點需在代碼後加支距值，例如 BD1D-5-1.5+4.5'); break; }
          offs.forEach((m, i) => {
            const val = Number(m[2]);
            const dir = L!.dir;
            if (!dir) { err('支距前至少要有一段直線'); return; }
            let d: XY;
            if (!m[1]) {
              if (i > 0) { err('只有第一段支距可省略正負號'); return; }
              d = dir;
            } else d = m[1] === '+' ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x }; // + 右轉 90°，− 左轉 90°
            const q = last(L!);
            addStraight(L!, { x: q.x + d.x * val, y: q.y + d.y * val, z: null, src: null });
          });
          break;
        }
        case 'T': {
          if (!L) { L = start(key, feature, tk.lineNo, v, false); break; }
          const from = L.pendingMid ?? last(L);
          res.lines.push({ feature, lineNo: tk.lineNo, pts: [from, v], closed: false, reverse: L.reverse, label: null, labelAt: null, branch: true });
          break;
        }
        case 'X': case 'Z': {
          if (!L) { L = start(key, feature, tk.lineNo, v, false); break; }
          addPoint(L, v);
          const P0 = L.pts[0], P1 = L.pts[1];
          const prev = L.pts[L.pts.length - 2];
          const d2 = unit({ x: v.x - prev.x, y: v.y - prev.y });
          const d1 = unit({ x: P1.x - P0.x, y: P1.y - P0.y });
          const perp2 = { x: -d2.y, y: d2.x };
          // X：起點的垂線 × 終點的垂線；Z：過起點平行終邊的線 × 終點的垂線
          const q = tk.ctrl === 'X'
            ? lineX(P0, { x: -d1.y, y: d1.x }, v, perp2)
            : lineX(P0, d2, v, perp2);
          if (q && L.pts.length >= 3) addStraight(L, { x: q.x, y: q.y, z: null, src: null });
          else err('無法計算交會點（線形太短或方向平行），改為直接閉合');
          finish(L, true);
          break;
        }
        case 'C':
          if (!L) { L = start(key, feature, tk.lineNo, v, false); break; }
          addPoint(L, v);
          finish(L, true);
          break;
        case 'F': {
          if (!L) { L = start(key, feature, tk.lineNo, v, false); break; }
          if (L.pendingMid) addPoint(L, v); else addTangentArc(L, v);
          const s0 = L.pts[0];
          if (L.dir) addTangentArc(L, { ...s0, src: null }); else addStraight(L, { ...s0, src: null });
          L.pts.pop(); // 終點與起點重合，以 closed 表示
          finish(L, true);
          break;
        }
        case 'E':
          if (!L) { err('線形終點前沒有起點'); break; }
          addPoint(L, v);
          finish(L);
          break;
        case 'G': {
          if (!L) L = start(key, feature, tk.lineNo, v, false); else addPoint(L, v);
          const target = byName.get(tk.extra.trim());
          if (!target) { err(`找不到要連接的點號 ${tk.extra || '（未填）'}`); break; }
          addStraight(L, { x: target.x, y: target.y, z: target.z, src: target.name });
          finish(L);
          break;
        }
        default:
          break;
      }
      if (note && open.get(key)) open.get(key)!.label = note;
      else if (note && res.lines.length && res.lines[res.lines.length - 1].feature === feature && !res.lines[res.lines.length - 1].label) {
        const ln = res.lines[res.lines.length - 1];
        ln.label = note;
        ln.labelAt = ln.closed && ln.pts.length >= 3 ? polygonCentroid(ln.pts) : ln.pts[Math.floor(ln.pts.length / 2)];
      }
    }
  }
  for (const L of [...open.values()]) finish(L);
  return res;
}

function unit(v: XY): XY { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; }

/** 兩條直線（點＋方向）的交點 */
function lineX(p: XY, d: XY, q: XY, e: XY): XY | null {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

/** 通過三點的圓弧：圓心、半徑、起始角與掃掠角（經過 m） */
export function arcThrough(a: XY, m: XY, b: XY): { c: XY; r: number; a0: number; sweep: number } | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, m2 = m.x * m.x + m.y * m.y, b2 = b.x * b.x + b.y * b.y;
  const c = { x: (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d, y: (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const ang = (p: XY) => Math.atan2(p.y - c.y, p.x - c.x);
  const a0 = ang(a);
  const norm = (t: number) => { t %= 2 * Math.PI; return t < 0 ? t + 2 * Math.PI : t; };
  const tm = norm(ang(m) - a0), tb = norm(ang(b) - a0);
  // 逆時針經過 m 嗎？
  const sweep = tm < tb ? tb : tb - 2 * Math.PI;
  return { c, r, a0, sweep };
}

function sampleArc(c: XY, r: number, a0: number, sweep: number, a: SamVertex, b: SamVertex): SamVertex[] {
  const n = Math.min(180, Math.max(4, Math.ceil(Math.abs(sweep) * r / 0.5), Math.ceil(Math.abs(sweep) / (5 * Math.PI / 180))));
  const out: SamVertex[] = [a];
  for (let i = 1; i < n; i++) {
    const t = a0 + (sweep * i) / n;
    const z = a.z !== null && b.z !== null ? a.z + ((b.z - a.z) * i) / n : null;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t), z, src: null });
  }
  out.push(b);
  return out;
}

function arcEndDir(c: XY, b: XY, sweep: number): XY {
  const rx = b.x - c.x, ry = b.y - c.y, d = Math.hypot(rx, ry) || 1;
  // 逆時針（sweep > 0）的切線為半徑向量左轉 90°
  return sweep > 0 ? { x: -ry / d, y: rx / d } : { x: ry / d, y: -rx / d };
}

/** 斷線：圖例標為斷線的地形線，取其原始測點（有高程）依序相連 */
export function samBreaklines(res: SamResult, legend: LegendItem[]): Array<Array<{ x: number; y: number; z: number }>> {
  const brk = new Set(legend.filter(l => l.breakline).map(l => l.code.toUpperCase()));
  const out: Array<Array<{ x: number; y: number; z: number }>> = [];
  for (const ln of res.lines) {
    if (!brk.has(ln.feature)) continue;
    const pts = ln.pts.filter(v => v.src !== null && v.z !== null).map(v => ({ x: v.x, y: v.y, z: v.z as number }));
    if (pts.length >= 2) out.push(pts);
  }
  return out;
}
