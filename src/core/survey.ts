// 數值測量計算：3DF 觀測檔、碎部點計算、轉站點、自由測站（後方交會）、前方交會
// 角度一律以 ddd.mmss 字串保存，避免浮點誤差；垂直角為天頂距。
import { azimuth, normAngle, type XY } from './geom';
import { DEG, dmsToDeg } from './units';

export interface ControlPoint { name: string; x: number; y: number; z: number | null }

/** 一筆觀測。SD 模式：v = 天頂距（ddd.mmss），dist = 斜距；HD 模式：v = 高差（公尺），dist = 平距 */
export interface Obs { name: string; ht: number; hz: string; v: string; dist: number; code: string }

export interface Station {
  name: string;
  /** 後視點名（可空白：此時水平角讀數視為方位角） */
  bs: string;
  hi: number;
  /** 後視時的水平度盤讀數 */
  bsAngle: string;
  mode: 'SD' | 'HD';
  obs: Obs[];
}

export interface ComputedPoint { name: string; x: number; y: number; z: number | null; code: string; station: string; kind: 'detail' | 'transfer' | 'intersection' }

export interface StationReport {
  name: string;
  ok: boolean;
  message: string;
  x?: number; y?: number; z?: number | null;
  /** 度盤 0 方向的方位角（定向角） */
  orientation?: number;
  resection?: ResectionResult;
}

export interface SurveyResult {
  points: ComputedPoint[];
  stations: StationReport[];
  /** 計算過程中新增的控制點（轉站點、自由測站、交會點） */
  newControls: ControlPoint[];
}

/** 英文字母開頭的點名視為控制點／轉站點（沿用原版規則） */
export const isControlName = (n: string) => /^[A-Za-z]/.test(n.trim());

/** 由觀測值求平距與垂距（儀器中心到稜鏡中心） */
export function reduceObs(o: Obs, mode: 'SD' | 'HD'): { hd: number; vd: number | null } {
  if (mode === 'HD') {
    const dh = o.v.trim() === '' ? NaN : Number(o.v);
    return { hd: o.dist, vd: isFinite(dh) ? dh : null };
  }
  const zen = dmsToDeg(o.v);
  if (!isFinite(zen)) return { hd: o.dist, vd: null };
  return { hd: o.dist * Math.sin(zen * DEG), vd: o.dist * Math.cos(zen * DEG) };
}

export function computeSurvey(stations: Station[], controls: ControlPoint[]): SurveyResult {
  const known = new Map<string, ControlPoint>();
  for (const c of controls) known.set(c.name, c);
  const newControls: ControlPoint[] = [];
  const addControl = (c: ControlPoint) => {
    if (known.has(c.name)) return;
    known.set(c.name, c);
    newControls.push(c);
  };
  const reports: Array<StationReport | null> = stations.map(() => null);
  const points: ComputedPoint[] = [];
  const rays = new Map<string, Array<{ from: XY; az: number; station: string }>>();

  // 測站可能要等前面測站算出轉站點才能算：重複掃描直到沒有進展
  let progress = true;
  while (progress) {
    progress = false;
    stations.forEach((st, si) => {
      if (reports[si]) return;
      let stPt = known.get(st.name);
      let orientation: number | null = null;
      let resection: ResectionResult | undefined;
      const bsObs = st.obs.filter(o => o.code.trim().toUpperCase() === 'BS');
      if (!stPt && bsObs.length) {
        const usable = bsObs.filter(o => known.has(o.name));
        if (usable.length < 2) return; // 還不能算，等下一輪
        resection = resect(st.hi, st.mode, usable.map(o => ({ obs: o, pt: known.get(o.name)! })));
        stPt = { name: st.name, x: resection.x, y: resection.y, z: resection.z };
        orientation = resection.orientation;
        addControl(stPt);
      }
      if (!stPt) return;
      if (orientation === null) {
        const bsPt = st.bs.trim() ? known.get(st.bs.trim()) : undefined;
        if (st.bs.trim() && !bsPt) return; // 後視點尚未知
        const bsRead = dmsToDeg(st.bsAngle || '0') * DEG;
        orientation = bsPt ? normAngle(azimuth(stPt, bsPt) - bsRead) : 0;
      }
      const zSt = stPt.z;
      for (const o of st.obs) {
        const code = o.code.trim();
        if (code.toUpperCase() === 'BS') continue;
        const az = normAngle(orientation + dmsToDeg(o.hz) * DEG);
        if (/^99999\./.test(code)) {
          const target = code.slice(6).trim() || o.name;
          (rays.get(target) ?? rays.set(target, []).get(target)!).push({ from: stPt, az, station: st.name });
          continue;
        }
        const { hd, vd } = reduceObs(o, st.mode);
        if (!isFinite(hd)) continue;
        const x = stPt.x + hd * Math.sin(az), y = stPt.y + hd * Math.cos(az);
        // 覘標高為 0 表示此點不計高程（屋頂、懸吊物等）
        const z = zSt !== null && vd !== null && o.ht !== 0 ? zSt + st.hi + vd - o.ht : null;
        const transfer = isControlName(o.name);
        points.push({ name: o.name, x, y, z, code, station: st.name, kind: transfer ? 'transfer' : 'detail' });
        if (transfer) addControl({ name: o.name, x, y, z });
      }
      reports[si] = {
        name: st.name, ok: true,
        message: resection ? `自由測站：${resection.used} 個已知點，殘差 RMS ${resection.rms.toFixed(4)} m` : st.bs.trim() ? `後視 ${st.bs}` : '未設後視，讀數視為方位角',
        x: stPt.x, y: stPt.y, z: stPt.z, orientation, resection,
      };
      progress = true;
    });
  }
  // 前方交會
  for (const [name, rs] of rays) {
    const from = new Set(rs.map(r => r.station));
    if (from.size < 2) continue;
    const p = intersectRays(rs);
    if (!p) continue;
    points.push({ name, x: p.x, y: p.y, z: null, code: '99999', station: [...from].join('+'), kind: 'intersection' });
    addControl({ name, x: p.x, y: p.y, z: null });
  }
  const stationReports = reports.map((r, i) => r ?? {
    name: stations[i].name, ok: false,
    message: stations[i].obs.some(o => o.code.trim().toUpperCase() === 'BS')
      ? '自由測站的已知點不足 2 點'
      : !known.has(stations[i].name) ? `測站 ${stations[i].name} 沒有座標（請先輸入控制點）` : `後視點 ${stations[i].bs} 沒有座標`,
  });
  return { points, stations: stationReports, newControls };
}

// ---------------- 後方交會（自由測站） ----------------

export interface ResectionResult {
  x: number; y: number; z: number | null;
  /** 度盤 0 方向的方位角 */
  orientation: number;
  /** 觀測距離與已知座標的比例（理想為 1） */
  scale: number;
  used: number;
  residuals: Array<{ name: string; dx: number; dy: number }>;
  rms: number;
}

/**
 * 以剛體轉換（旋轉＋平移，比例固定 1）做最小二乘配合：
 * 把測站為原點的區域座標配到已知座標上。2 點以上即可求解。
 */
export function resect(hi: number, mode: 'SD' | 'HD', list: Array<{ obs: Obs; pt: ControlPoint }>): ResectionResult {
  const loc = list.map(({ obs }) => {
    const { hd } = reduceObs(obs, mode);
    const th = dmsToDeg(obs.hz) * DEG;
    return { u: hd * Math.sin(th), v: hd * Math.cos(th) };
  });
  const n = list.length;
  const ub = loc.reduce((s, p) => s + p.u, 0) / n, vb = loc.reduce((s, p) => s + p.v, 0) / n;
  const Xb = list.reduce((s, l) => s + l.pt.x, 0) / n, Yb = list.reduce((s, l) => s + l.pt.y, 0) / n;
  let A = 0, B = 0, Ls = 0, Ks = 0;
  list.forEach((l, i) => {
    const u = loc[i].u - ub, v = loc[i].v - vb, X = l.pt.x - Xb, Y = l.pt.y - Yb;
    A += u * X + v * Y;
    B += v * X - u * Y;
    Ls += u * u + v * v;
    Ks += X * X + Y * Y;
  });
  const w = Math.atan2(B, A);
  const c = Math.cos(w), s = Math.sin(w);
  const rot = (u: number, v: number) => ({ x: u * c + v * s, y: -u * s + v * c });
  const t = rot(ub, vb);
  const x0 = Xb - t.x, y0 = Yb - t.y;
  const residuals = list.map((l, i) => {
    const r = rot(loc[i].u, loc[i].v);
    return { name: l.obs.name, dx: l.pt.x - (x0 + r.x), dy: l.pt.y - (y0 + r.y) };
  });
  const rms = Math.sqrt(residuals.reduce((s2, r) => s2 + r.dx * r.dx + r.dy * r.dy, 0) / n);
  // 測站高程：已知點高程 + 覘標高 − 儀器高 − 垂距 的平均
  const zs: number[] = [];
  list.forEach(({ obs, pt }) => {
    const { vd } = reduceObs(obs, mode);
    if (pt.z !== null && vd !== null && obs.ht !== 0) zs.push(pt.z + obs.ht - hi - vd);
  });
  return {
    x: x0, y: y0, z: zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null,
    orientation: normAngle(w), scale: Ls > 0 ? Math.sqrt(Ks / Ls) : 1, used: n, residuals, rms,
  };
}

// ---------------- 前方交會 ----------------

/** 多條方向線的最小二乘交點（兩條時為精確交點） */
export function intersectRays(rays: Array<{ from: XY; az: number }>): XY | null {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (const r of rays) {
    // 方向 (sin az, cos az) 的法向量 n = (cos az, −sin az)
    const nx = Math.cos(r.az), ny = -Math.sin(r.az);
    a11 += nx * nx; a12 += nx * ny; a22 += ny * ny;
    const d = nx * r.from.x + ny * r.from.y;
    b1 += nx * d; b2 += ny * d;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return null;
  return { x: (b1 * a22 - b2 * a12) / det, y: (a11 * b2 - a12 * b1) / det };
}

/**
 * 兩已知點前方交會（方向觀測）。
 * 在 A 架站：照準 B 的讀數 hzAB、照準 P 的讀數 hzAP；在 B 架站：照準 A 的讀數 hzBA、照準 P 的讀數 hzBP。
 */
export function forwardIntersection(A: XY, B: XY, hzAB: string, hzAP: string, hzBA: string, hzBP: string): XY | null {
  const azAP = azimuth(A, B) + (dmsToDeg(hzAP) - dmsToDeg(hzAB)) * DEG;
  const azBP = azimuth(B, A) + (dmsToDeg(hzBP) - dmsToDeg(hzBA)) * DEG;
  return intersectRays([{ from: A, az: azAP }, { from: B, az: azBP }]);
}

// ---------------- 3DF 檔 ----------------

/**
 * 解析 3DF 觀測檔（各廠牌儀器整理後的通用格式）：
 *   ST:測站 後視 儀器高 後視角
 *   SD:點號 覘標高 水平角 天頂距 斜距 [代碼]
 *   HD:點號 覘標高 水平角 高差 平距 [代碼]
 * 欄位以空白、Tab 或逗號分隔。
 */
export function parse3DF(text: string): { stations: Station[]; skipped: number } {
  const stations: Station[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(ST|SD|HD)\s*[:：]\s*(.*)$/i);
    if (!m) { skipped++; continue; }
    const kind = m[1].toUpperCase();
    const f = m[2].split(/[\s,]+/).filter(Boolean);
    if (kind === 'ST') {
      // 後視可能省略：ST:T2 1.490
      const hasBs = f.length >= 3 && isNaN(Number(f[1]));
      stations.push({
        name: f[0] ?? '', bs: hasBs ? f[1] : '',
        hi: Number(hasBs ? f[2] : f[1]) || 0,
        bsAngle: (hasBs ? f[3] : f[2]) ?? '0',
        mode: 'SD', obs: [],
      });
      continue;
    }
    const st = stations[stations.length - 1];
    if (!st || f.length < 5) { skipped++; continue; }
    // 同一測站以第一筆觀測的型式為準
    if (!st.obs.length) st.mode = kind === 'HD' ? 'HD' : 'SD';
    st.obs.push({ name: f[0], ht: Number(f[1]) || 0, hz: f[2], v: f[3], dist: Number(f[4]) || 0, code: f.slice(5).join(' ') });
  }
  return { stations, skipped };
}

export function to3DF(stations: Station[]): string {
  const out: string[] = [];
  for (const s of stations) {
    out.push(`ST:${s.name} ${s.bs || '-'} ${s.hi.toFixed(3)} ${s.bsAngle || '0'}`.replace(' - ', ' '));
    for (const o of s.obs) out.push(`${s.mode}:${o.name} ${o.ht.toFixed(3)} ${o.hz} ${o.v} ${o.dist.toFixed(3)}${o.code ? ' ' + o.code : ''}`);
  }
  return out.join('\r\n') + '\r\n';
}
