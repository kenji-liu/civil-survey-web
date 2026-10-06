// 平曲線：單圓曲線與對稱克羅梭緩和曲線（TS–SC–CS–ST），曲線要素互算、中心線幾何、里程樁
import { azimuth, dist, polar, wrapPi, type XY } from './geom';
import { DEG, dmsToDeg } from './units';

/** 曲線要素：給其中一項即可求 R（Δ 由 IP 幾何決定） */
export type CurveKind = 'R' | 'T' | 'L' | 'E';
export interface CurveSpec { kind: CurveKind; value: number }

export interface IPInput {
  name: string; x: number; y: number; curve: CurveSpec | null;
  /** 緩和曲線長 Ls（兩側對稱），0 或未填為單圓曲線 */
  ls?: number;
}

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
  /** 圓曲線起終點（有緩和曲線時為 SC、CS） */
  BC: XY; EC: XY; MC: XY; center: XY;
  staBC: number; staMC: number; staEC: number;
  /** 緩和曲線長；0 表示單圓曲線 */
  ls: number;
  /** 緩和曲線起終點（無緩和曲線時等於 BC、EC） */
  TS: XY; ST: XY; staTS: number; staST: number;
  /** 圓曲線段長 Lc、內移量 p、切線增長 k */
  Lc: number; p: number; k: number;
}

type Element =
  | { type: 'line'; s0: number; len: number; p0: XY; az: number }
  | { type: 'arc'; s0: number; len: number; p0: XY; az: number; R: number; dir: 1 | -1; center: XY }
  /** 緩和曲線：in 由 TS 量起；out 由 ST 往回量 */
  | { type: 'spiral'; mode: 'in' | 'out'; s0: number; len: number; p0: XY; az: number; R: number; dir: 1 | -1 };

export interface Stake { sta: number; label: string; kind: 'BP' | 'EP' | 'BC' | 'MC' | 'EC' | 'TS' | 'SC' | 'CS' | 'ST' | 'full' | 'extra'; x: number; y: number; az: number }

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

/** 克羅梭曲線局部座標（沿切線 x、偏移 y），A² = R·Ls */
export function clothoidXY(l: number, R: number, Ls: number): { x: number; y: number } {
  const t = (l * l) / (2 * R * Ls); // 切線轉角
  const t2 = t * t;
  // 級數展開：x = l(1 − t²/10 + t⁴/216 − t⁶/9360)，y = l(t/3 − t³/42 + t⁵/1320 − t⁷/75600)
  return { x: l * (1 - t2 / 10 + (t2 * t2) / 216 - (t2 * t2 * t2) / 9360), y: l * (t / 3 - (t * t2) / 42 + (t * t2 * t2) / 1320 - (t * t2 * t2 * t2) / 75600) };
}

/** 對稱緩和曲線要素：θs、p、k、Ts、Lc、E */
export function spiralElements(R: number, Ls: number, deltaAbs: number) {
  const ths = Ls / (2 * R);
  const { x: Xs, y: Ys } = clothoidXY(Ls, R, Ls);
  const p = Ys - R * (1 - Math.cos(ths));
  const k = Xs - R * Math.sin(ths);
  const T = (R + p) * Math.tan(deltaAbs / 2) + k;
  const Lc = R * (deltaAbs - 2 * ths);
  const E = (R + p) / Math.cos(deltaAbs / 2) - R;
  return { ths, Xs, Ys, p, k, T, Lc, E };
}

export function buildAlignment(input: AlignmentInput): Alignment | null {
  const P = input.ips;
  if (P.length < 2) return null;
  const warnings: string[] = [];
  const n = P.length;
  // 1. 各 IP 的曲線要素
  const raw: Array<{ i: number; delta: number; R: number; T: number; L: number; E: number; M: number; azIn: number; azOut: number; ls: number; Lc: number; p: number; k: number } | null> = [];
  for (let i = 1; i < n - 1; i++) {
    const azIn = azimuth(P[i - 1], P[i]);
    const azOut = azimuth(P[i], P[i + 1]);
    const delta = wrapPi(azOut - azIn);
    const dAbs = Math.abs(delta);
    const spec = P[i].curve;
    if (!spec || !(spec.value > 0) || dAbs < 1e-9) { raw.push(null); continue; }
    if (dAbs > Math.PI - 1e-6) { warnings.push(`${P[i].name}：偏角接近 180°，無法設曲線`); raw.push(null); continue; }
    const R = radiusFrom(spec, dAbs);
    let ls = P[i].ls && P[i].ls! > 0 ? P[i].ls! : 0;
    if (ls) {
      if (spec.kind !== 'R') warnings.push(`${P[i].name}：設有緩和曲線時，曲線要素以半徑 R 為準（目前由 ${spec.kind} 換算 R）`);
      if (ls / R >= dAbs) { warnings.push(`${P[i].name}：緩和曲線太長（2θs ≥ Δ），已改為單圓曲線`); ls = 0; }
    }
    if (ls) {
      const sp = spiralElements(R, ls, dAbs);
      raw.push({ i, delta, R, T: sp.T, L: sp.Lc + 2 * ls, E: sp.E, M: R * (1 - Math.cos(dAbs / 2)), azIn, azOut, ls, Lc: sp.Lc, p: sp.p, k: sp.k });
    } else {
      const ce = curveElements(R, dAbs);
      raw.push({ i, delta, ...ce, azIn, azOut, ls: 0, Lc: ce.L, p: 0, k: 0 });
    }
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
      const TS = polar(ip, azIn + Math.PI, c.T);
      const ST = polar(ip, c.azOut, c.T);
      const lineLen = dist(cur, TS);
      elements.push({ type: 'line', s0: s, len: lineLen, p0: cur, az: azIn });
      s += lineLen;
      const dir: 1 | -1 = c.delta > 0 ? 1 : -1;
      const staTS = s;
      let BC = TS, azBC = azIn;
      if (c.ls) {
        elements.push({ type: 'spiral', mode: 'in', s0: s, len: c.ls, p0: TS, az: azIn, R: c.R, dir });
        const q = clothoidXY(c.ls, c.R, c.ls);
        BC = { x: TS.x + q.x * Math.sin(azIn) + dir * q.y * Math.cos(azIn), y: TS.y + q.x * Math.cos(azIn) - dir * q.y * Math.sin(azIn) };
        azBC = azIn + dir * (c.ls / (2 * c.R));
        s += c.ls;
      }
      const center = polar(BC, azBC + dir * Math.PI / 2, c.R);
      const phi = c.Lc / c.R;
      const EC = polar(BC, azBC + dir * phi / 2, 2 * c.R * Math.sin(phi / 2));
      const MC = polar(BC, azBC + dir * phi / 4, 2 * c.R * Math.sin(phi / 4));
      elements.push({ type: 'arc', s0: s, len: c.Lc, p0: BC, az: azBC, R: c.R, dir, center });
      const staBC = s;
      s += c.Lc;
      const staEC = s;
      if (c.ls) {
        elements.push({ type: 'spiral', mode: 'out', s0: s, len: c.ls, p0: ST, az: c.azOut, R: c.R, dir });
        s += c.ls;
      }
      curves.push({ ipIndex: i, name: ip.name, delta: c.delta, R: c.R, T: c.T, L: c.L, E: c.E, M: c.M, BC, EC, MC, center, staBC, staMC: staBC + c.Lc / 2, staEC, ls: c.ls, TS, ST, staTS, staST: s, Lc: c.Lc, p: c.p, k: c.k });
      cur = c.ls ? ST : EC;
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
    } else if (e.type === 'spiral') {
      // 局部座標 → 世界座標：x 沿切線、y 偏向曲線內側（右偏時為右側）
      const l = e.mode === 'in' ? ds : e.len - ds;
      const q = clothoidXY(l, e.R, e.len);
      const sx = e.mode === 'in' ? q.x : -q.x;
      const u = { x: Math.sin(e.az), y: Math.cos(e.az) }, nr = { x: Math.cos(e.az), y: -Math.sin(e.az) };
      p = { x: e.p0.x + sx * u.x + e.dir * q.y * nr.x, y: e.p0.y + sx * u.y + e.dir * q.y * nr.y };
      const turn = (l * l) / (2 * e.R * e.len);
      az = e.mode === 'in' ? e.az + e.dir * turn : e.az - e.dir * turn;
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
    if (c.ls) {
      special.push({ sta: c.staTS, label: `TS${k + 1}`, kind: 'TS' });
      special.push({ sta: c.staBC, label: `SC${k + 1}`, kind: 'SC' });
      special.push({ sta: c.staMC, label: `MC${k + 1}`, kind: 'MC' });
      special.push({ sta: c.staEC, label: `CS${k + 1}`, kind: 'CS' });
      special.push({ sta: c.staST, label: `ST${k + 1}`, kind: 'ST' });
    } else {
      special.push({ sta: c.staBC, label: `BC${k + 1}`, kind: 'BC' });
      special.push({ sta: c.staMC, label: `MC${k + 1}`, kind: 'MC' });
      special.push({ sta: c.staEC, label: `EC${k + 1}`, kind: 'EC' });
    }
  });
  const list = [...special];
  const curveStas = special.filter(s => s.kind !== 'BP' && s.kind !== 'EP').map(s => s.sta);
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
