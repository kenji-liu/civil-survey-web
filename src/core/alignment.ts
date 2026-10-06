// 平曲線（單圓曲線）：曲線要素互算、中心線幾何、里程樁
import { azimuth, dist, polar, wrapPi, type XY } from './geom';
import { DEG, dmsToDeg } from './units';

/** 曲線要素：給其中一項即可求 R（Δ 由 IP 幾何決定） */
export type CurveKind = 'R' | 'T' | 'L' | 'E';
export interface CurveSpec { kind: CurveKind; value: number }

export interface IPInput { name: string; x: number; y: number; curve: CurveSpec | null }

export interface AlignmentInput {
  name: string;
  /** BP 的里程（公尺） */
  startStation: number;
  /** 第一點為 BP、最後一點為 EP，中間為 IP */
  ips: IPInput[];
  /** 整樁單距（公路 20、水利 50、灌溉 25） */
  interval: number;
  /** 整樁距曲線樁小於此值則省略 */
  minGap: number;
  /** 使用者自行加樁（里程） */
  extraStations: number[];
}

export interface CurveData {
  ipIndex: number;
  name: string;
  /** 偏角（弧度），右偏為正 */
  delta: number;
  R: number; T: number; L: number; E: number; M: number;
  BC: XY; EC: XY; MC: XY; center: XY;
  staBC: number; staMC: number; staEC: number;
}

type Element =
  | { type: 'line'; s0: number; len: number; p0: XY; az: number }
  | { type: 'arc'; s0: number; len: number; p0: XY; az: number; R: number; dir: 1 | -1; center: XY };

export interface Stake { sta: number; label: string; kind: 'BP' | 'EP' | 'BC' | 'MC' | 'EC' | 'full' | 'extra'; x: number; y: number; az: number }

export interface Alignment {
  input: AlignmentInput;
  curves: CurveData[];
  elements: Element[];
  length: number;
  startStation: number;
  endStation: number;
  warnings: string[];
  pointAt(sta: number, offset?: number): { x: number; y: number; az: number } | null;
  stakes: Stake[];
}

/** 由偏角 Δ（弧度，取絕對值）與任一要素求半徑 */
export function radiusFrom(spec: CurveSpec, deltaAbs: number): number {
  const h = deltaAbs / 2;
  switch (spec.kind) {
    case 'R': return spec.value;
    case 'T': return spec.value / Math.tan(h);
    case 'L': return spec.value / deltaAbs;
    case 'E': return spec.value / (1 / Math.cos(h) - 1);
  }
}

export function curveElements(R: number, deltaAbs: number) {
  const h = deltaAbs / 2;
  return { R, T: R * Math.tan(h), L: R * deltaAbs, E: R * (1 / Math.cos(h) - 1), M: R * (1 - Math.cos(h)) };
}

export function buildAlignment(input: AlignmentInput): Alignment | null {
  const P = input.ips;
  if (P.length < 2) return null;
  const warnings: string[] = [];
  const n = P.length;
  // 1. 各 IP 的曲線要素
  const raw: Array<{ i: number; delta: number; R: number; T: number; L: number; E: number; M: number; azIn: number; azOut: number } | null> = [];
  for (let i = 1; i < n - 1; i++) {
    const azIn = azimuth(P[i - 1], P[i]);
    const azOut = azimuth(P[i], P[i + 1]);
    const delta = wrapPi(azOut - azIn);
    const dAbs = Math.abs(delta);
    const spec = P[i].curve;
    if (!spec || !(spec.value > 0) || dAbs < 1e-9) { raw.push(null); continue; }
    if (dAbs > Math.PI - 1e-6) { warnings.push(`${P[i].name}：偏角接近 180°，無法設曲線`); raw.push(null); continue; }
    const R = radiusFrom(spec, dAbs);
    raw.push({ i, delta, ...curveElements(R, dAbs), azIn, azOut });
  }
  // 2. 切線衝突檢查：相鄰兩曲線切線長和 > IP 間距
  for (let i = 0; i < n - 1; i++) {
    const tA = i >= 1 ? raw[i - 1]?.T ?? 0 : 0;
    const tB = i + 1 <= n - 2 ? raw[i]?.T ?? 0 : 0;
    const D = dist(P[i], P[i + 1]);
    if (tA + tB > D + 1e-6) warnings.push(`切線衝突：${P[i].name}–${P[i + 1].name} 間距 ${D.toFixed(3)} m，小於切線長和 ${(tA + tB).toFixed(3)} m`);
  }
  // 3. 依序組成直線與圓弧元素
  const elements: Element[] = [];
  const curves: CurveData[] = [];
  let s = input.startStation;
  let cur: XY = { x: P[0].x, y: P[0].y };
  for (let i = 1; i < n; i++) {
    const c = i <= n - 2 ? raw[i - 1] : null;
    const ip = P[i];
    const azIn = azimuth(P[i - 1], ip);
    if (c) {
      const BC = polar(ip, azIn + Math.PI, c.T);
      const lineLen = dist(cur, BC);
      elements.push({ type: 'line', s0: s, len: lineLen, p0: cur, az: azIn });
      s += lineLen;
      const dir: 1 | -1 = c.delta > 0 ? 1 : -1;
      const center = polar(BC, azIn + dir * Math.PI / 2, c.R);
      const EC = polar(ip, c.azOut, c.T);
      const midAz = azIn + dir * Math.abs(c.delta) / 4;
      const MC = polar(BC, midAz, 2 * c.R * Math.sin(Math.abs(c.delta) / 4));
      elements.push({ type: 'arc', s0: s, len: c.L, p0: BC, az: azIn, R: c.R, dir, center });
      curves.push({ ipIndex: i, name: ip.name, delta: c.delta, R: c.R, T: c.T, L: c.L, E: c.E, M: c.M, BC, EC, MC, center, staBC: s, staMC: s + c.L / 2, staEC: s + c.L });
      s += c.L;
      cur = EC;
    } else {
      const lineLen = dist(cur, ip);
      elements.push({ type: 'line', s0: s, len: lineLen, p0: cur, az: lineLen > 0 ? azimuth(cur, ip) : azIn });
      s += lineLen;
      cur = { x: ip.x, y: ip.y };
    }
  }
  const startStation = input.startStation;
  const endStation = s;

  const pointAt = (sta: number, offset = 0) => {
    if (!elements.length || sta < startStation - 1e-6 || sta > endStation + 1e-6) return null;
    let e = elements[elements.length - 1];
    for (const el of elements) { if (sta <= el.s0 + el.len + 1e-9) { e = el; break; } }
    const ds = Math.min(Math.max(sta - e.s0, 0), e.len);
    let p: XY, az: number;
    if (e.type === 'line') {
      p = polar(e.p0, e.az, ds); az = e.az;
    } else {
      const phi = ds / e.R;
      p = polar(e.p0, e.az + e.dir * phi / 2, 2 * e.R * Math.sin(phi / 2));
      az = e.az + e.dir * phi;
    }
    if (offset) p = polar(p, az + Math.PI / 2, offset); // 右側為正
    return { x: p.x, y: p.y, az };
  };

  const alignment: Alignment = { input, curves, elements, length: endStation - startStation, startStation, endStation, warnings, pointAt, stakes: [] };
  alignment.stakes = buildStakes(alignment);
  return alignment;
}

function buildStakes(al: Alignment): Stake[] {
  const { interval, minGap, extraStations } = al.input;
  const special: Array<{ sta: number; label: string; kind: Stake['kind'] }> = [
    { sta: al.startStation, label: 'BP', kind: 'BP' },
    { sta: al.endStation, label: 'EP', kind: 'EP' },
  ];
  al.curves.forEach((c, k) => {
    special.push({ sta: c.staBC, label: `BC${k + 1}`, kind: 'BC' });
    special.push({ sta: c.staMC, label: `MC${k + 1}`, kind: 'MC' });
    special.push({ sta: c.staEC, label: `EC${k + 1}`, kind: 'EC' });
  });
  const list = [...special];
  const curveStas = special.filter(s => s.kind === 'BC' || s.kind === 'MC' || s.kind === 'EC').map(s => s.sta);
  if (interval > 0) {
    const first = Math.ceil((al.startStation + 1e-6) / interval) * interval;
    for (let s = first; s < al.endStation - 1e-6; s += interval) {
      if (curveStas.some(c => Math.abs(c - s) < minGap)) continue;
      list.push({ sta: s, label: '', kind: 'full' });
    }
  }
  for (const s of extraStations) {
    if (s > al.startStation && s < al.endStation) list.push({ sta: s, label: '加樁', kind: 'extra' });
  }
  list.sort((a, b) => a.sta - b.sta);
  const out: Stake[] = [];
  for (const it of list) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.sta - it.sta) < 1e-4) {
      if (it.label && !prev.label.includes(it.label)) prev.label = prev.label ? `${prev.label}/${it.label}` : it.label;
      continue;
    }
    const p = al.pointAt(it.sta)!;
    out.push({ sta: it.sta, label: it.label, kind: it.kind, x: p.x, y: p.y, az: p.az });
  }
  return out;
}

/**
 * 偏角法轉座標。rows[0] 為 BP：angle 為 BP→IP1 的方位角；
 * 其餘各列 angle 為該 IP 的偏角（右偏為正）；每列 dist 為到下一點的距離。
 * 角度皆為 ddd.mmss 寫法。
 */
export function deflectionToIPs(bp: XY, rows: Array<{ name: string; angle: string; dist: number; curve: CurveSpec | null }>): IPInput[] {
  const out: IPInput[] = [{ name: rows[0]?.name || 'BP', x: bp.x, y: bp.y, curve: null }];
  if (!rows.length) return out;
  let az = dmsToDeg(rows[0].angle) * DEG;
  let cur: XY = bp;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) az += dmsToDeg(rows[i].angle) * DEG;
    if (!(rows[i].dist > 0)) break;
    cur = polar(cur, az, rows[i].dist);
    const next = rows[i + 1];
    out.push({ name: next?.name || (i + 1 === rows.length ? 'EP' : `IP${i + 1}`), x: cur.x, y: cur.y, curve: next?.curve ?? null });
  }
  return out;
}
