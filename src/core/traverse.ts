// 導線計算（六種型態，依手冊第六章）
// 水平角 β：在測站上由後視方向順時針量到前視方向（ddd.mmss）。
// 方位角推算：α前 = α後 + 180° + β。角度閉合差平均分配，座標閉合差依羅盤儀法則（按距離比例）分配。
import { azimuth, dist, normAngle, wrapPi, type XY } from './geom';
import { DEG, dmsToDeg } from './units';
import type { ControlPoint } from './survey';

export type TraverseType = 'open-az' | 'loop-az' | 'open-2' | 'link-2' | 'link-3' | 'link-4';

export const TRAVERSE_TYPES: Array<[TraverseType, string, string]> = [
  ['open-az', '一已知點開放導線', '起點已知，加測第一邊方位角，無閉合檢核'],
  ['loop-az', '一已知點閉合導線', '起點已知加測方位角，導線繞一圈閉合回起點'],
  ['open-2', '二已知點開放導線', '起點與後視點兩已知點，無閉合檢核'],
  ['link-2', '二已知點閉合導線', '起點、終點各一已知點，只檢核兩點距離'],
  ['link-3', '三已知點閉合導線', '起點兩已知點、終點一已知點，檢核座標閉合差'],
  ['link-4', '四已知點閉合導線', '起點、終點各兩已知點，檢核角度與座標閉合差'],
];

export interface TraverseRow {
  name: string;
  /** 此站的水平角（ddd.mmss） */
  angle: string;
  /** 到下一站的平距 */
  dist: number;
  /** 到下一站的高差（可空白） */
  dh: number | null;
}

export interface TraverseInput {
  type: TraverseType;
  /** 第一邊方位角（open-az、loop-az） */
  startAz: string;
  /** 起點的後視已知點（open-2、link-3、link-4） */
  backsight: string;
  /** 終點的前視已知點（link-4） */
  foresight: string;
  /** 第一列為起點、最後一列為終點；閉合導線最後一列為起點本身 */
  rows: TraverseRow[];
}

export interface TraverseLeg {
  from: string; to: string;
  az: number;                 // 改正後方位角（弧度）
  dist: number;
  dE: number; dN: number;
  cE: number; cN: number;     // 座標改正數
}

export interface TraverseResult {
  ok: boolean;
  error?: string;
  /** 各站：觀測角、改正後角度（度；未使用的角為 null）、座標 */
  points: Array<{ name: string; angle: number | null; angleCorr: number | null; x: number; y: number; z: number | null; known: boolean }>;
  legs: TraverseLeg[];
  /** 角度閉合差（秒）；null 表示此型態無角度檢核 */
  fAngleSec: number | null;
  nAngles: number;
  fE: number | null; fN: number | null; f: number | null;
  /** link-2：計算距離與已知距離之差 */
  fLength: number | null;
  totalDist: number;
  /** 相對精度 1/x */
  precision: number | null;
  fZ: number | null;
}

const fail = (error: string): TraverseResult => ({ ok: false, error, points: [], legs: [], fAngleSec: null, nAngles: 0, fE: null, fN: null, f: null, fLength: null, totalDist: 0, precision: null, fZ: null });

export function computeTraverse(t: TraverseInput, controls: ControlPoint[]): TraverseResult {
  const K = new Map(controls.map(c => [c.name, c]));
  const rows = t.rows.filter(r => r.name.trim());
  const n = rows.length;
  if (n < 2) return fail('至少要有起點與下一站兩列');
  const start = K.get(rows[0].name);
  if (!start) return fail(`起點 ${rows[0].name} 不在控制點資料中`);
  const legsN = n - 1;
  for (let i = 0; i < legsN; i++) if (!(rows[i].dist > 0)) return fail(`第 ${i + 1} 列 ${rows[i].name} 的距離未填`);
  const beta = rows.map(r => dmsToDeg(r.angle || '0'));

  // 1. 第一邊方位角
  let az0: number;
  if (t.type === 'open-az' || t.type === 'loop-az') {
    az0 = dmsToDeg(t.startAz) * DEG;
    if (!isFinite(az0)) return fail('請輸入第一邊方位角');
  } else if (t.type === 'link-2') {
    az0 = 0; // 暫定，最後旋轉到兩已知點
  } else {
    const B = K.get(t.backsight);
    if (!B) return fail(`後視已知點 ${t.backsight || '（未填）'} 不在控制點資料中`);
    az0 = azimuth(B, start) + Math.PI + beta[0] * DEG;
  }
  // 2. 推算各邊方位角（未改正）。leg i 使用的角度個數：
  const az: number[] = [az0];
  for (let i = 1; i < legsN; i++) az.push(az[i - 1] + Math.PI + beta[i] * DEG);

  // 3. 角度閉合差
  let fAngle: number | null = null, nAngles = 0;
  if (t.type === 'link-4') {
    const F = K.get(t.foresight), E = K.get(rows[n - 1].name);
    if (!F) return fail(`終點前視已知點 ${t.foresight || '（未填）'} 不在控制點資料中`);
    if (!E) return fail(`終點 ${rows[n - 1].name} 不在控制點資料中`);
    const azEnd = az[legsN - 1] + Math.PI + beta[n - 1] * DEG;
    fAngle = wrapPi(azEnd - azimuth(E, F));
    nAngles = n; // β0 … β(n−1)
    // 第 i 邊用了 β0..βi，共 i+1 個角
    for (let i = 0; i < legsN; i++) az[i] -= (fAngle * (i + 1)) / nAngles;
  } else if (t.type === 'loop-az' && rows[n - 1].angle.trim() !== '' && n >= 3) {
    // 回到起點後量閉合角，推回第一邊方位角比較
    const azBack = az[legsN - 1] + Math.PI + beta[n - 1] * DEG;
    fAngle = wrapPi(azBack - az0);
    nAngles = n - 1; // β1 … β(n−1)
    for (let i = 1; i < legsN; i++) az[i] -= (fAngle * i) / nAngles;
  }

  // 4. 座標增量
  let dE = rows.slice(0, legsN).map((r, i) => r.dist * Math.sin(az[i]));
  let dN = rows.slice(0, legsN).map((r, i) => r.dist * Math.cos(az[i]));
  const totalDist = rows.slice(0, legsN).reduce((s, r) => s + r.dist, 0);
  const sumE = () => dE.reduce((a, b) => a + b, 0), sumN = () => dN.reduce((a, b) => a + b, 0);

  // 5. 終點條件
  let end: XY | null = null;
  let fLength: number | null = null;
  if (t.type === 'loop-az') end = start;
  if (t.type === 'link-2' || t.type === 'link-3' || t.type === 'link-4') {
    const E = K.get(rows[n - 1].name);
    if (!E) return fail(`終點 ${rows[n - 1].name} 不在控制點資料中`);
    end = E;
  }
  if (t.type === 'link-2' && end) {
    // 無方位檢核：整條導線繞起點旋轉，使計算終點方向對準已知終點
    const calc = { x: start.x + sumE(), y: start.y + sumN() };
    const rot = azimuth(start, end) - azimuth(start, calc);
    for (let i = 0; i < legsN; i++) az[i] += rot;
    dE = rows.slice(0, legsN).map((r, i) => r.dist * Math.sin(az[i]));
    dN = rows.slice(0, legsN).map((r, i) => r.dist * Math.cos(az[i]));
    fLength = dist(start, { x: start.x + sumE(), y: start.y + sumN() }) - dist(start, end);
  }
  let fE: number | null = null, fN: number | null = null;
  if (end) { fE = start.x + sumE() - end.x; fN = start.y + sumN() - end.y; }

  // 6. 羅盤儀法則改正
  const legs: TraverseLeg[] = [];
  // 各站角度是否參與推算、改正量
  const cAng = fAngle !== null ? fAngle / DEG / nAngles : 0;
  const angleInfo = (i: number) => {
    const used = i === 0 ? usesStartAngleFor(t.type) : i < legsN || (t.type === 'link-4' || (t.type === 'loop-az' && fAngle !== null));
    if (!used) return { angle: null, angleCorr: null };
    const corrected = (t.type === 'link-4') || (t.type === 'loop-az' && fAngle !== null && i >= 1);
    return { angle: beta[i], angleCorr: beta[i] - (corrected ? cAng : 0) };
  };
  const points: TraverseResult['points'] = [{ name: rows[0].name, ...angleInfo(0), x: start.x, y: start.y, z: start.z, known: true }];
  let x = start.x, y = start.y;
  for (let i = 0; i < legsN; i++) {
    const w = rows[i].dist / totalDist;
    const cE = fE !== null ? -fE * w : 0, cN = fN !== null ? -fN * w : 0;
    x += dE[i] + cE; y += dN[i] + cN;
    legs.push({ from: rows[i].name, to: rows[i + 1].name, az: normAngle(az[i]), dist: rows[i].dist, dE: dE[i], dN: dN[i], cE, cN });
    const isEnd = i === legsN - 1 && end;
    points.push({ name: rows[i + 1].name, ...angleInfo(i + 1), x: isEnd ? end!.x : x, y: isEnd ? end!.y : y, z: null, known: !!isEnd });
  }

  // 7. 高程（若各邊高差都有填）
  let fZ: number | null = null;
  const dhs = rows.slice(0, legsN).map(r => r.dh);
  if (start.z !== null && dhs.every(v => v !== null && isFinite(v))) {
    const endZ = t.type === 'loop-az' ? start.z : end ? (K.get(rows[n - 1].name)?.z ?? null) : null;
    const sumDh = (dhs as number[]).reduce((a, b) => a + b, 0);
    if (endZ !== null) fZ = start.z + sumDh - endZ;
    let z = start.z, cum = 0;
    for (let i = 0; i < legsN; i++) {
      cum += rows[i].dist;
      z += dhs[i] as number;
      points[i + 1].z = fZ !== null ? z - fZ * (cum / totalDist) : z;
    }
  }
  const f = fE !== null && fN !== null ? Math.hypot(fE, fN) : null;
  return {
    ok: true, points, legs,
    fAngleSec: fAngle !== null ? (fAngle / DEG) * 3600 : null, nAngles,
    fE, fN, f, fLength, totalDist,
    precision: f !== null && f > 1e-9 ? totalDist / f : fLength !== null && Math.abs(fLength) > 1e-9 ? totalDist / Math.abs(fLength) : null,
    fZ,
  };
}

function usesStartAngleFor(t: TraverseType) {
  return t === 'open-2' || t === 'link-3' || t === 'link-4';
}
