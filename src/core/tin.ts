// 不規則三角網 (TIN)：建網、內插取高程、等高線追蹤
import Delaunator from 'delaunator';
import cdt2d from 'cdt2d';
import { pointInPolygon, type XY } from './geom';

export interface Pt3 { x: number; y: number; z: number }

export interface TinOptions {
  /** 最大邊長（公尺），超過的三角形捨棄；0 表示不限制 */
  maxEdge?: number;
  /** 外邊界：三角形形心在邊界外則捨棄 */
  boundary?: XY[] | null;
  /** 斷線（地形線）：三角形邊不得跨越 */
  breaklines?: Pt3[][];
  /** 由外圍往內剝除：邊長超過 maxEdge 或最小內角小於 minAngle（度）的外圍三角形。設定此項時 maxEdge 只用於剝除 */
  peel?: { maxEdge: number; minAngle: number } | null;
  /** 手動翻轉的共邊（兩端點座標 x1,y1,x2,y2）：建網後依序翻轉 */
  flips?: Array<[number, number, number, number]>;
}

export interface Tin {
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  /** 每 3 個為一個三角形的頂點索引 */
  tri: Uint32Array;
  minZ: number;
  maxZ: number;
  /** 參與建網的點數（去除無高程與重複點後） */
  nPts: number;
  /** 實際套用的斷線段數 */
  nBreakEdges: number;
  /** 斷線無法套用時的說明 */
  warning: string | null;
  sample(x: number, y: number): number | null;
}

export function buildTin(points: Pt3[], opts: TinOptions = {}): Tin | null {
  // 去除重複座標（取第一個）；斷線頂點若和測點重合就共用同一點
  const ptIndex = new Map<string, number>();
  const ps: Pt3[] = [];
  const keyOf = (p: Pt3) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const addPt = (p: Pt3) => {
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return -1;
    const k = keyOf(p);
    const i = ptIndex.get(k);
    if (i !== undefined) return i;
    ptIndex.set(k, ps.length);
    ps.push(p);
    return ps.length - 1;
  };
  for (const p of points) addPt(p);
  const edges: Array<[number, number]> = [];
  for (const bl of opts.breaklines ?? []) {
    for (let i = 1; i < bl.length; i++) {
      const a = addPt(bl[i - 1]), b = addPt(bl[i]);
      if (a >= 0 && b >= 0 && a !== b) edges.push([a, b]);
    }
  }
  if (ps.length < 3) return null;
  const n = ps.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  // 扣除局部原點以提高三角化的數值穩定度
  const ox = ps[0].x, oy = ps[0].y;
  const coords = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    xs[i] = ps[i].x; ys[i] = ps[i].y; zs[i] = ps[i].z;
    coords[2 * i] = ps[i].x - ox; coords[2 * i + 1] = ps[i].y - oy;
  }
  let triangles: ArrayLike<number>;
  let warning: string | null = null;
  let nBreakEdges = 0;
  if (edges.length) {
    try {
      const cells = cdt2d(Array.from({ length: n }, (_, i) => [coords[2 * i], coords[2 * i + 1]] as [number, number]), edges, { exterior: true });
      const flat = new Uint32Array(cells.length * 3);
      cells.forEach((c, i) => { flat[3 * i] = c[0]; flat[3 * i + 1] = c[1]; flat[3 * i + 2] = c[2]; });
      triangles = flat;
      nBreakEdges = edges.length;
    } catch {
      warning = '斷線彼此交叉或重疊，無法套用，已改用一般三角網';
      triangles = new Delaunator(coords).triangles;
    }
  } else {
    try { triangles = new Delaunator(coords).triangles; } catch { return null; }
  }
  const maxE2 = !opts.peel && opts.maxEdge && opts.maxEdge > 0 ? opts.maxEdge * opts.maxEdge : Infinity;
  const boundary = opts.boundary && opts.boundary.length >= 3 ? opts.boundary : null;
  const keep: number[] = [];
  const t = triangles;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i], b = t[i + 1], c = t[i + 2];
    if (maxE2 !== Infinity) {
      if (e2(xs, ys, a, b) > maxE2 || e2(xs, ys, b, c) > maxE2 || e2(xs, ys, c, a) > maxE2) continue;
    }
    if (boundary) {
      const cx = (xs[a] + xs[b] + xs[c]) / 3, cy = (ys[a] + ys[b] + ys[c]) / 3;
      if (!pointInPolygon({ x: cx, y: cy }, boundary)) continue;
    }
    keep.push(a, b, c);
  }
  let triList = opts.peel ? peelHull(keep, xs, ys, opts.peel.maxEdge, opts.peel.minAngle) : keep;
  if (opts.flips?.length) triList = applyFlips(triList, xs, ys, opts.flips, (x, y) => ptIndex.get(`${x.toFixed(4)},${y.toFixed(4)}`));
  const tri = Uint32Array.from(triList);
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < tri.length; i++) {
    const z = zs[tri[i]];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const index = buildIndex(xs, ys, tri);
  return {
    xs, ys, zs, tri, minZ, maxZ, nPts: n, nBreakEdges, warning,
    sample: (x, y) => sampleAt(xs, ys, zs, tri, index, x, y),
  };
}

/**
 * 由三角網外圍往內剝除不良三角形：在外圍（有一邊不與其他三角形共用）且
 * 最長邊大於 maxEdge 或最小內角小於 minAngle 的三角形移除，直到外圍都合格。內部不會挖洞。
 */
function peelHull(tris: number[], xs: Float64Array, ys: Float64Array, maxEdge: number, minAngleDeg: number): number[] {
  const n = tris.length / 3;
  if (!n) return tris;
  const alive = new Uint8Array(n).fill(1);
  const nV = xs.length;
  const key = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
    const k = key(tris[3 * t + e], tris[3 * t + ((e + 1) % 3)]);
    (edgeTris.get(k) ?? edgeTris.set(k, []).get(k)!).push(t);
  }
  const maxE2 = maxEdge > 0 ? maxEdge * maxEdge : Infinity;
  const cosMin = Math.cos((Math.max(0, minAngleDeg) * Math.PI) / 180);
  const bad = (t: number) => {
    const v = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
    const L = [e2(xs, ys, v[1], v[2]), e2(xs, ys, v[0], v[2]), e2(xs, ys, v[0], v[1])];
    if (Math.max(...L) > maxE2) return true;
    if (minAngleDeg <= 0) return false;
    // 餘弦定理求各角；最小角對應最短邊
    for (let i = 0; i < 3; i++) {
      const a2 = L[i], b2 = L[(i + 1) % 3], c2 = L[(i + 2) % 3];
      const cosA = (b2 + c2 - a2) / (2 * Math.sqrt(b2 * c2) || 1);
      if (cosA > cosMin) return true;
    }
    return false;
  };
  const onHull = (t: number) => {
    for (let e = 0; e < 3; e++) {
      const k = key(tris[3 * t + e], tris[3 * t + ((e + 1) % 3)]);
      if ((edgeTris.get(k) ?? []).filter(o => alive[o]).length < 2) return true;
    }
    return false;
  };
  const queue: number[] = [];
  for (let t = 0; t < n; t++) if (onHull(t)) queue.push(t);
  while (queue.length) {
    const t = queue.pop()!;
    if (!alive[t] || !bad(t) || !onHull(t)) continue;
    alive[t] = 0;
    for (let e = 0; e < 3; e++) {
      const k = key(tris[3 * t + e], tris[3 * t + ((e + 1) % 3)]);
      for (const o of edgeTris.get(k) ?? []) if (alive[o]) queue.push(o);
    }
  }
  const out: number[] = [];
  for (let t = 0; t < n; t++) if (alive[t]) out.push(tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]);
  return out;
}

/** 翻轉共邊：兩個共用 a–b 邊的三角形 (a,b,c)(b,a,d)，在四邊形為凸時改成 c–d 對角線 */
function applyFlips(tris: number[], xs: Float64Array, ys: Float64Array, flips: Array<[number, number, number, number]>, idx: (x: number, y: number) => number | undefined): number[] {
  const t = tris.slice();
  for (const [x1, y1, x2, y2] of flips) {
    const a = idx(x1, y1), b = idx(x2, y2);
    if (a === undefined || b === undefined) continue;
    const owners: number[] = [];
    for (let k = 0; k < t.length; k += 3) {
      const v = [t[k], t[k + 1], t[k + 2]];
      if (v.includes(a) && v.includes(b)) owners.push(k);
    }
    if (owners.length !== 2) continue;
    const opp = owners.map(k => [t[k], t[k + 1], t[k + 2]].find(v => v !== a && v !== b)!);
    const [c, d] = opp;
    // 凸四邊形檢查：c、d 在 a–b 兩側，且 a、b 在 c–d 兩側
    const side = (p: number, q: number, r: number) => (xs[q] - xs[p]) * (ys[r] - ys[p]) - (ys[q] - ys[p]) * (xs[r] - xs[p]);
    if (side(a, b, c) * side(a, b, d) >= 0 || side(c, d, a) * side(c, d, b) >= 0) continue;
    const orient = (p: number, q: number, r: number) => (side(p, q, r) > 0 ? [p, q, r] : [p, r, q]);
    const t1 = orient(c, d, a), t2 = orient(c, d, b);
    t.splice(owners[0], 3, ...t1);
    t.splice(owners[1], 3, ...t2);
  }
  return t;
}

/** 找離 (x,y) 最近、且由兩個三角形共用的邊（翻網格工具用） */
export function nearestSharedEdge(tin: Tin, x: number, y: number): [number, number, number, number] | null {
  const { xs, ys, tri } = tin;
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let k = 0; k < tri.length; k += 3) for (let e = 0; e < 3; e++) { const kk = key(tri[k + e], tri[k + ((e + 1) % 3)]); count.set(kk, (count.get(kk) ?? 0) + 1); }
  let best: [number, number] | null = null, bd = Infinity;
  for (const [kk, n] of count) {
    if (n !== 2) continue;
    const [a, b] = kk.split(',').map(Number);
    const dx = xs[b] - xs[a], dy = ys[b] - ys[a], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - xs[a]) * dx + (y - ys[a]) * dy) / L2));
    const d = Math.hypot(x - (xs[a] + t * dx), y - (ys[a] + t * dy));
    if (d < bd) { bd = d; best = [a, b]; }
  }
  return best ? [xs[best[0]], ys[best[0]], xs[best[1]], ys[best[1]]] : null;
}

function e2(xs: Float64Array, ys: Float64Array, a: number, b: number) {
  const dx = xs[a] - xs[b], dy = ys[a] - ys[b];
  return dx * dx + dy * dy;
}

interface GridIndex { minX: number; minY: number; cell: number; nx: number; ny: number; buckets: Map<number, number[]> }

function buildIndex(xs: Float64Array, ys: Float64Array, tri: Uint32Array): GridIndex {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < tri.length; i++) {
    const v = tri[i];
    minX = Math.min(minX, xs[v]); maxX = Math.max(maxX, xs[v]);
    minY = Math.min(minY, ys[v]); maxY = Math.max(maxY, ys[v]);
  }
  const nt = tri.length / 3 || 1;
  const area = Math.max((maxX - minX) * (maxY - minY), 1e-6);
  const cell = Math.max(Math.sqrt(area / nt) * 1.5, 1e-3);
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const buckets = new Map<number, number[]>();
  for (let k = 0; k < tri.length; k += 3) {
    const a = tri[k], b = tri[k + 1], c = tri[k + 2];
    const x0 = Math.floor((Math.min(xs[a], xs[b], xs[c]) - minX) / cell);
    const x1 = Math.floor((Math.max(xs[a], xs[b], xs[c]) - minX) / cell);
    const y0 = Math.floor((Math.min(ys[a], ys[b], ys[c]) - minY) / cell);
    const y1 = Math.floor((Math.max(ys[a], ys[b], ys[c]) - minY) / cell);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const key = gy * nx + gx;
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(k);
    }
  }
  return { minX, minY, cell, nx, ny, buckets };
}

function sampleAt(xs: Float64Array, ys: Float64Array, zs: Float64Array, tri: Uint32Array, idx: GridIndex, x: number, y: number): number | null {
  const gx = Math.floor((x - idx.minX) / idx.cell), gy = Math.floor((y - idx.minY) / idx.cell);
  if (gx < 0 || gy < 0 || gx >= idx.nx || gy >= idx.ny) return null;
  const arr = idx.buckets.get(gy * idx.nx + gx);
  if (!arr) return null;
  for (const k of arr) {
    const a = tri[k], b = tri[k + 1], c = tri[k + 2];
    const x1 = xs[a], y1 = ys[a], x2 = xs[b], y2 = ys[b], x3 = xs[c], y3 = ys[c];
    const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (det === 0) continue;
    const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det;
    const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det;
    const l3 = 1 - l1 - l2;
    const eps = -1e-9;
    if (l1 >= eps && l2 >= eps && l3 >= eps) return l1 * zs[a] + l2 * zs[b] + l3 * zs[c];
  }
  return null;
}

export interface ContourLine { level: number; major: boolean; pts: XY[]; closed: boolean }

/**
 * 在 TIN 上追蹤等高線。等高線交點都落在三角形邊上，
 * 以「邊」作為接點鍵值即可把相鄰三角形的線段串成連續線。
 */
export function traceContours(tin: Tin, interval: number, majorEvery = 5): ContourLine[] {
  if (!(interval > 0) || tin.tri.length === 0) return [];
  const { xs, ys, zs, tri } = tin;
  const start = Math.ceil(tin.minZ / interval);
  const end = Math.floor(tin.maxZ / interval);
  if (end - start > 2000) return []; // 間距相對高差太小，避免卡死
  // level index -> segments [edgeKeyA, edgeKeyB]
  const segs = new Map<number, Array<[number, number]>>();
  const ptOf = new Map<string, XY>();
  const nV = xs.length;
  const edgeKey = (i: number, j: number) => (i < j ? i * nV + j : j * nV + i);
  for (let k = 0; k < tri.length; k += 3) {
    const v = [tri[k], tri[k + 1], tri[k + 2]];
    const zmin = Math.min(zs[v[0]], zs[v[1]], zs[v[2]]);
    const zmax = Math.max(zs[v[0]], zs[v[1]], zs[v[2]]);
    for (let li = Math.max(start, Math.ceil(zmin / interval)); li <= Math.min(end, Math.floor(zmax / interval)); li++) {
      const L = li * interval;
      const hits: number[] = [];
      for (let e = 0; e < 3; e++) {
        const i = v[e], j = v[(e + 1) % 3];
        // 頂點剛好等於等高線高程時視為「在上方」，避免重複交點
        const ai = zs[i] >= L, aj = zs[j] >= L;
        if (ai === aj) continue;
        const key = edgeKey(i, j);
        hits.push(key);
        const sk = `${li}:${key}`;
        if (!ptOf.has(sk)) {
          const t = (L - zs[i]) / (zs[j] - zs[i]);
          ptOf.set(sk, { x: xs[i] + t * (xs[j] - xs[i]), y: ys[i] + t * (ys[j] - ys[i]) });
        }
      }
      if (hits.length === 2) {
        let arr = segs.get(li);
        if (!arr) segs.set(li, (arr = []));
        arr.push([hits[0], hits[1]]);
      }
    }
  }
  const out: ContourLine[] = [];
  for (const [li, arr] of segs) {
    const adj = new Map<number, number[]>();
    arr.forEach(([a, b], idx) => {
      (adj.get(a) ?? adj.set(a, []).get(a)!).push(idx);
      (adj.get(b) ?? adj.set(b, []).get(b)!).push(idx);
    });
    const used = new Uint8Array(arr.length);
    const walk = (startKey: number, firstSeg: number): number[] => {
      const keys = [startKey];
      let cur = startKey, seg = firstSeg;
      while (seg >= 0 && !used[seg]) {
        used[seg] = 1;
        const [a, b] = arr[seg];
        const next = a === cur ? b : a;
        keys.push(next);
        cur = next;
        seg = (adj.get(cur) ?? []).find(s => !used[s]) ?? -1;
      }
      return keys;
    };
    const level = li * interval;
    const major = majorEvery > 0 && li % majorEvery === 0;
    const toPts = (keys: number[]) => keys.map(k => ptOf.get(`${li}:${k}`)!);
    // 先從端點（只連一段）開始走，得到開放線；剩下的是閉合線
    for (const [key, list] of adj) {
      if (list.length === 1 && !used[list[0]]) {
        out.push({ level, major, pts: toPts(walk(key, list[0])), closed: false });
      }
    }
    for (let s = 0; s < arr.length; s++) {
      if (used[s]) continue;
      const keys = walk(arr[s][0], s);
      out.push({ level, major, pts: toPts(keys), closed: keys[0] === keys[keys.length - 1] });
    }
  }
  return out;
}
