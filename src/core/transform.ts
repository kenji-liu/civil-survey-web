// 座標轉換：以兩點以上的對應點求相似轉換（平移、旋轉、縮放）或剛體轉換（比例固定 1）
import type { XY } from './geom';

export interface TransformPair { from: XY; to: XY }

export interface Similarity {
  /** X' = tx + a·x − b·y；Y' = ty + b·x + a·y（數學座標系，逆時針為正） */
  a: number; b: number; tx: number; ty: number;
  scale: number;
  /** 旋轉角（弧度，逆時針為正） */
  rotation: number;
  residuals: Array<{ dx: number; dy: number }>;
  rms: number;
}

export function fitSimilarity(pairs: TransformPair[], fixScale: boolean): Similarity | null {
  const n = pairs.length;
  if (n < 2) return null;
  const fx = pairs.reduce((s, p) => s + p.from.x, 0) / n, fy = pairs.reduce((s, p) => s + p.from.y, 0) / n;
  const tx0 = pairs.reduce((s, p) => s + p.to.x, 0) / n, ty0 = pairs.reduce((s, p) => s + p.to.y, 0) / n;
  let Sxx = 0, Sxy = 0, L = 0;
  for (const p of pairs) {
    const x = p.from.x - fx, y = p.from.y - fy, X = p.to.x - tx0, Y = p.to.y - ty0;
    Sxx += x * X + y * Y;
    Sxy += x * Y - y * X;
    L += x * x + y * y;
  }
  if (L < 1e-12) return null;
  let a = Sxx / L, b = Sxy / L;
  if (fixScale) { const s = Math.hypot(a, b); a /= s; b /= s; }
  const tx = tx0 - (a * fx - b * fy), ty = ty0 - (b * fx + a * fy);
  const residuals = pairs.map(p => {
    const q = apply({ a, b, tx, ty }, p.from);
    return { dx: p.to.x - q.x, dy: p.to.y - q.y };
  });
  return { a, b, tx, ty, scale: Math.hypot(a, b), rotation: Math.atan2(b, a), residuals, rms: Math.sqrt(residuals.reduce((s, r) => s + r.dx * r.dx + r.dy * r.dy, 0) / n) };
}

export function apply(t: { a: number; b: number; tx: number; ty: number }, p: XY): XY {
  return { x: t.tx + t.a * p.x - t.b * p.y, y: t.ty + t.b * p.x + t.a * p.y };
}
