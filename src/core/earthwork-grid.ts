// 方格法土方。
// 依手冊：每個方格四個角點有地面高、設計高、挖填高；方格切成兩個三角形，
// 三角形內挖填高為線性，並以 0 線把挖方區與填方區分開計算。
// 這裡把邊界多邊形依三角形與 0 線裁切後積分（線性函數在多邊形上的積分 = 面積 × 形心處的值），
// 所以邊界方格與挖填交界都是精確值，不必近似。
import { clipByConvex, clipByHalfPlane, polygonArea, polygonCentroid, boundsOf, type XY } from './geom';

export type SurfaceFn = (x: number, y: number) => number | null;

export interface GridCellResult {
  i: number; j: number;
  x0: number; y0: number; size: number;
  /** 四角點：左下、右下、右上、左上；dh = 地面高 − 設計高（正值為挖） */
  corners: Array<{ x: number; y: number; ground: number | null; design: number | null; dh: number | null }>;
  area: number;
  cut: number;
  fill: number;
}

export interface GridResult {
  cells: GridCellResult[];
  cell: number;
  totalArea: number;
  cut: number;
  fill: number;
  /** 範圍內取不到地形或設計高而無法計算的方格數與面積 */
  skipped: number;
  skippedArea: number;
}

export function gridEarthwork(boundary: XY[], cell: number, ground: SurfaceFn, design: SurfaceFn): GridResult {
  const res: GridResult = { cells: [], cell, totalArea: 0, cut: 0, fill: 0, skipped: 0, skippedArea: 0 };
  const b = boundsOf(boundary);
  if (!b || !(cell > 0) || boundary.length < 3) return res;
  // 方格原點對齊格寬的整數倍，方便和圖面對照
  const gx0 = Math.floor(b.minX / cell) * cell, gy0 = Math.floor(b.minY / cell) * cell;
  const nx = Math.ceil((b.maxX - gx0) / cell), ny = Math.ceil((b.maxY - gy0) / cell);
  if (nx * ny > 400000) throw new Error(`方格數 ${nx * ny} 太多，請加大方格邊長`);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = gx0 + i * cell, y0 = gy0 + j * cell;
      const sq: XY[] = [{ x: x0, y: y0 }, { x: x0 + cell, y: y0 }, { x: x0 + cell, y: y0 + cell }, { x: x0, y: y0 + cell }];
      const inCell = clipByConvex(boundary, sq);
      const area = inCell.length >= 3 ? polygonArea(inCell) : 0;
      if (area < 1e-9) continue;
      // 邊界方格的角點可能落在地形外。依序改取：範圍內最近一點 → 範圍內形心 → 同格其他角點平均。
      // 這只影響邊界內那一小塊的內插，積分範圍仍然只有邊界內。
      const cen = polygonCentroid(inCell);
      const corners = sq.map(p => {
        let g = ground(p.x, p.y), d = design(p.x, p.y);
        if (g === null || d === null) {
          const q = nearestInside(p, inCell);
          g = g ?? ground(q.x, q.y) ?? ground(cen.x, cen.y);
          d = d ?? design(q.x, q.y) ?? design(cen.x, cen.y);
        }
        return { x: p.x, y: p.y, ground: g, design: d, dh: g !== null && d !== null ? g - d : null };
      });
      let known = corners.filter(k => k.dh !== null);
      if (!known.length) {
        // 四角都取不到：在範圍內由各頂點往形心找第一個有地形的點
        search: for (const v of inCell) for (const t of [0.25, 0.5, 0.75]) {
          const x = v.x + (cen.x - v.x) * t, y = v.y + (cen.y - v.y) * t;
          const g = ground(x, y), d = design(x, y);
          if (g !== null && d !== null) { known = [{ x, y, ground: g, design: d, dh: g - d }]; break search; }
        }
      }
      if (known.length && known.length < 4) {
        const avg = (f: (k: typeof corners[number]) => number) => known.reduce((s, k) => s + f(k), 0) / known.length;
        const gA = avg(k => k.ground!), dA = avg(k => k.design!);
        for (const k of corners) if (k.dh === null) { k.ground = k.ground ?? gA; k.design = k.design ?? dA; k.dh = k.ground - k.design; }
      }
      if (corners.some(c => c.dh === null)) { res.skipped++; res.skippedArea += area; continue; }
      let cut = 0, fill = 0;
      // 兩個三角形：(0,1,2) 與 (0,2,3)
      for (const t of [[0, 1, 2], [0, 2, 3]]) {
        const tri = t.map(k => ({ x: corners[k].x, y: corners[k].y, h: corners[k].dh! }));
        const piece = clipByConvex(inCell, tri);
        if (piece.length < 3) continue;
        const plane = planeOf(tri);
        // 挖方區：h >= 0
        const cutPoly = clipByHalfPlane(piece, plane.a, plane.b, plane.c);
        const fillPoly = clipByHalfPlane(piece, -plane.a, -plane.b, -plane.c);
        cut += integrate(cutPoly, plane);
        fill -= integrate(fillPoly, plane);
      }
      res.cells.push({ i, j, x0, y0, size: cell, corners, area, cut, fill });
      res.totalArea += area;
      res.cut += cut;
      res.fill += fill;
    }
  }
  return res;
}

/** 多邊形上離 p 最近的點，再往形心內縮一點點，確保落在範圍內 */
function nearestInside(p: XY, poly: XY[]): XY {
  let best = poly[0], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  const c = polygonCentroid(poly);
  return { x: best.x + (c.x - best.x) * 0.02, y: best.y + (c.y - best.y) * 0.02 };
}

/** 三點決定的線性函數 h(x,y) = a·x + b·y + c */
function planeOf(t: Array<{ x: number; y: number; h: number }>) {
  const [p, q, r] = t;
  const det = (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y);
  const a = ((q.h - p.h) * (r.y - p.y) - (r.h - p.h) * (q.y - p.y)) / det;
  const b = ((r.h - p.h) * (q.x - p.x) - (q.h - p.h) * (r.x - p.x)) / det;
  const c = p.h - a * p.x - b * p.y;
  return { a, b, c };
}

function integrate(poly: XY[], pl: { a: number; b: number; c: number }): number {
  if (poly.length < 3) return 0;
  const A = polygonArea(poly);
  if (A < 1e-12) return 0;
  const g = polygonCentroid(poly);
  return A * (pl.a * g.x + pl.b * g.y + pl.c);
}

/** 設計面：水平面 */
export function flatSurface(z: number): SurfaceFn {
  return () => z;
}

/** 設計面：通過基準點、沿指定方位角有固定坡度（%）的斜面 */
export function slopedSurface(base: XY, zBase: number, gradePct: number, azimuthRad: number): SurfaceFn {
  const ux = Math.sin(azimuthRad), uy = Math.cos(azimuthRad);
  return (x, y) => zBase + ((x - base.x) * ux + (y - base.y) * uy) * gradePct / 100;
}
