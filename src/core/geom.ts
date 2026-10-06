// 平面幾何工具。座標慣例：x = E（橫座標），y = N（縱座標）。
// 方位角採測量慣例：由北起算、順時針為正，弧度 [0, 2π)。

export interface XY { x: number; y: number }

export const TAU = Math.PI * 2;

export function dist(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 測量方位角（北起順時針） */
export function azimuth(a: XY, b: XY): number {
  return normAngle(Math.atan2(b.x - a.x, b.y - a.y));
}

export function normAngle(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

/** 角度差正規化到 (-π, π] */
export function wrapPi(a: number): number {
  a = normAngle(a);
  return a > Math.PI ? a - TAU : a;
}

/** 由點、方位角、距離求新點 */
export function polar(p: XY, az: number, d: number): XY {
  return { x: p.x + d * Math.sin(az), y: p.y + d * Math.cos(az) };
}

/** 多邊形有號面積（逆時針為正） */
export function signedArea(poly: XY[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(poly: XY[]): number {
  return Math.abs(signedArea(poly));
}

/** 多邊形形心（面積為 0 時回傳頂點平均） */
export function polygonCentroid(poly: XY[]): XY {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-12) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Sutherland–Hodgman：保留 f(p) >= 0 的部分，f 為線性函數 f(p) = a·x + b·y + c。
 * 被裁切的多邊形可以是凹多邊形；結果可能含退化邊，但面積與形心積分仍正確。
 */
export function clipByHalfPlane(poly: XY[], a: number, b: number, c: number): XY[] {
  const out: XY[] = [];
  const n = poly.length;
  if (n === 0) return out;
  const f = (p: XY) => a * p.x + b * p.y + c;
  for (let i = 0; i < n; i++) {
    const P = poly[i], Q = poly[(i + 1) % n];
    const fp = f(P), fq = f(Q);
    if (fp >= 0) out.push(P);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: P.x + t * (Q.x - P.x), y: P.y + t * (Q.y - P.y) });
    }
  }
  return out;
}

/** 以凸多邊形 window 裁切任意多邊形 */
export function clipByConvex(poly: XY[], window: XY[]): XY[] {
  const ccw = signedArea(window) > 0;
  let res = poly;
  for (let i = 0, n = window.length; i < n && res.length; i++) {
    const A = window[i], B = window[(i + 1) % n];
    // 內側：逆時針多邊形邊的左側
    let a = -(B.y - A.y), b = B.x - A.x;
    if (!ccw) { a = -a; b = -b; }
    const c = -(a * A.x + b * A.y);
    res = clipByHalfPlane(res, a, b, c);
  }
  return res;
}

export function segmentIntersection(p1: XY, p2: XY, p3: XY, p4: XY): { t: number; u: number; p: XY } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-14) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return { t, u, p: { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) } };
}

export function polylineLength(pts: XY[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** 點到線段距離 */
export function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function boundsOf(pts: Iterable<XY>): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
