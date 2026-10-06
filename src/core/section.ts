// 橫斷面：簡易組合斷面（路面＋路拱＋挖填邊坡）、放坡與地面線求交（daylight）、挖填面積
// 偏距慣例：面向里程前進方向，左側為負、右側為正。

export interface SectionTemplate {
  /** 左、右路面寬（自中心線起算，公尺） */
  widthL: number;
  widthR: number;
  /** 路拱橫坡（%），由中心線向兩側下降為正 */
  crossfall: number;
  /** 挖方邊坡 1:m（水平 m : 垂直 1） */
  cutSlope: number;
  /** 填方邊坡 1:n */
  fillSlope: number;
  /** 側溝（只在挖方側加設）：寬、深，0 表示不設 */
  ditchWidth: number;
  ditchDepth: number;
}

export interface OZ { o: number; z: number }

export interface SectionResult {
  ground: OZ[];
  design: OZ[];
  zc: number;
  cutArea: number;
  fillArea: number;
  left: SideResult;
  right: SideResult;
}

export interface SideResult { mode: 'cut' | 'fill' | 'none'; daylight: OZ | null; caught: boolean }

/** 在地面線上內插高程（超出範圍回傳 null） */
export function groundAt(ground: OZ[], o: number): number | null {
  if (!ground.length || o < ground[0].o - 1e-9 || o > ground[ground.length - 1].o + 1e-9) return null;
  for (let i = 0; i < ground.length - 1; i++) {
    const a = ground[i], b = ground[i + 1];
    if (o >= a.o - 1e-9 && o <= b.o + 1e-9) {
      return b.o === a.o ? a.z : a.z + ((o - a.o) / (b.o - a.o)) * (b.z - a.z);
    }
  }
  return ground[ground.length - 1].z;
}

export function designSection(ground: OZ[], zc: number, t: SectionTemplate): SectionResult {
  const g = [...ground].sort((a, b) => a.o - b.o);
  const left = buildSide(g, zc, t, -1);
  const right = buildSide(g, zc, t, 1);
  const design: OZ[] = [...left.pts.slice().reverse(), { o: 0, z: zc }, ...right.pts];
  const { cut, fill } = areaBetween(g, design);
  return { ground: g, design, zc, cutArea: cut, fillArea: fill, left: left.res, right: right.res };
}

function buildSide(g: OZ[], zc: number, t: SectionTemplate, side: 1 | -1): { pts: OZ[]; res: SideResult } {
  const w = side > 0 ? t.widthR : t.widthL;
  const edge: OZ = { o: side * w, z: zc - (t.crossfall / 100) * w };
  const pts: OZ[] = [edge];
  const gEdge = groundAt(g, edge.o);
  if (gEdge === null) return { pts, res: { mode: 'none', daylight: null, caught: false } };
  const mode: 'cut' | 'fill' = gEdge > edge.z ? 'cut' : 'fill';
  let start = edge;
  if (mode === 'cut' && t.ditchWidth > 0 && t.ditchDepth > 0) {
    // 梯形側溝簡化成：外移半寬下挖、再外移半寬回到路面高
    const half = t.ditchWidth / 2;
    pts.push({ o: edge.o + side * half, z: edge.z - t.ditchDepth });
    start = { o: edge.o + side * t.ditchWidth, z: edge.z };
    pts.push(start);
  }
  const slope = mode === 'cut' ? t.cutSlope : t.fillSlope;
  // 每外移 1 m，高程變化 1/slope（挖方向上、填方向下）
  const rate = (mode === 'cut' ? 1 : -1) / Math.max(slope, 1e-6);
  const line = (o: number) => start.z + Math.abs(o - start.o) * rate;
  // 沿地面線往外找 ground − line 變號處
  const outer = g.filter(p => side > 0 ? p.o > start.o : p.o < start.o).sort((a, b) => side * (a.o - b.o));
  let prev: OZ = { o: start.o, z: groundAt(g, start.o) ?? start.z };
  let prevF = prev.z - line(prev.o);
  const sign = mode === 'cut' ? 1 : -1;
  if (sign * prevF <= 0) {
    // 起點已經在地面線另一側（側溝外緣低於地面時會發生），直接接到地面
    const dl: OZ = { o: start.o, z: prev.z };
    pts.push(dl);
    return { pts, res: { mode, daylight: dl, caught: true } };
  }
  for (const p of outer) {
    const f = p.z - line(p.o);
    if (sign * f <= 0) {
      const tt = prevF / (prevF - f);
      const o = prev.o + tt * (p.o - prev.o);
      const dl: OZ = { o, z: line(o) };
      pts.push(dl);
      return { pts, res: { mode, daylight: dl, caught: true } };
    }
    prev = p; prevF = f;
  }
  // 取樣寬度內接不到地面：延伸到取樣邊界
  const lastO = outer.length ? outer[outer.length - 1].o : start.o;
  const dl: OZ = { o: lastO, z: line(lastO) };
  pts.push(dl);
  return { pts, res: { mode, daylight: dl, caught: false } };
}

/** 計算兩條折線之間的面積：地面高於設計為挖方、低於為填方。只計算設計線範圍內。 */
export function areaBetween(ground: OZ[], design: OZ[]): { cut: number; fill: number } {
  if (design.length < 2) return { cut: 0, fill: 0 };
  const o0 = design[0].o, o1 = design[design.length - 1].o;
  const xs = new Set<number>();
  for (const p of design) xs.add(p.o);
  for (const p of ground) if (p.o > o0 && p.o < o1) xs.add(p.o);
  const sorted = [...xs].sort((a, b) => a - b);
  let cut = 0, fill = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b - a < 1e-12) continue;
    const ga = groundAt(ground, a), gb = groundAt(ground, b);
    if (ga === null || gb === null) continue;
    const da = ga - interp(design, a), db = gb - interp(design, b);
    const w = b - a;
    if (da >= 0 && db >= 0) cut += ((da + db) / 2) * w;
    else if (da <= 0 && db <= 0) fill -= ((da + db) / 2) * w;
    else {
      const t = da / (da - db);
      if (da > 0) { cut += (da / 2) * t * w; fill -= (db / 2) * (1 - t) * w; }
      else { fill -= (da / 2) * t * w; cut += (db / 2) * (1 - t) * w; }
    }
  }
  return { cut, fill };
}

/** 折線內插（允許同一偏距有兩點，例如垂直的側溝壁時取第一個） */
function interp(line: OZ[], o: number): number {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    if (o >= a.o - 1e-9 && o <= b.o + 1e-9) return b.o === a.o ? a.z : a.z + ((o - a.o) / (b.o - a.o)) * (b.z - a.z);
  }
  return o < line[0].o ? line[0].z : line[line.length - 1].z;
}

export interface VolumeRow { sta: number; label: string; cutArea: number; fillArea: number; dist: number; cutVol: number; fillVol: number; cumCut: number; cumFill: number; mass: number; ok: boolean }

/** 平均斷面法 V = (A1 + A2) / 2 × L */
export function averageEndArea(rows: Array<{ sta: number; label: string; cutArea: number; fillArea: number; ok: boolean }>): VolumeRow[] {
  const out: VolumeRow[] = [];
  let cumCut = 0, cumFill = 0;
  rows.forEach((r, i) => {
    let dist = 0, cutVol = 0, fillVol = 0;
    if (i > 0) {
      const p = rows[i - 1];
      dist = r.sta - p.sta;
      if (r.ok && p.ok) {
        cutVol = ((p.cutArea + r.cutArea) / 2) * dist;
        fillVol = ((p.fillArea + r.fillArea) / 2) * dist;
      }
    }
    cumCut += cutVol; cumFill += fillVol;
    out.push({ ...r, dist, cutVol, fillVol, cumCut, cumFill, mass: cumCut - cumFill });
  });
  return out;
}
