// 進階組合斷面（依手冊第五～七章「構造物單元」與「進階組合」的概念）
// 由中心線往外：路面（路寬 RW/LW、橫坡 RS/LS）→ 依序套構造物單元（條件成立才繪出）→ 最後放坡接地面。
// 構造物單元以區域座標描述：u 向外、v 向上，插入點為 (0,0)，座標可寫運算式（參數與系統變數）。
import { evaluate, lookup, parseAssignments, ExprError, type ExprEnv } from './expr';
import { groundAt, areaBetween, type OZ, type SectionResult, type SideResult, type SectionOverride, type SectionTemplate } from './section';
import { polygonArea } from './geom';

export interface UnitParam { key: string; label: string; def: number }
export interface StructUnit {
  id: string;
  name: string;
  desc: string;
  params: UnitParam[];
  /** 完成面（設計線）各點 [u, v]，第一點為插入點 */
  surface: Array<[string, string]>;
  /** 實體（材料）多邊形，用於數量計算 */
  solids: Array<{ material: string; pts: Array<[string, string]> }>;
}

export const BUILTIN_UNITS: StructUnit[] = [
  {
    id: 'SHOULDER', name: '路肩', desc: '寬 W、向外下降坡度 S（%）', params: [{ key: 'W', label: '寬', def: 1 }, { key: 'S', label: '坡度 %', def: 4 }],
    surface: [['0', '0'], ['W', '-W*S/100']], solids: [],
  },
  {
    id: 'CURB', name: '緣石', desc: '寬 W、露出高 H、埋深 D', params: [{ key: 'W', label: '寬', def: 0.15 }, { key: 'H', label: '露出高', def: 0.15 }, { key: 'D', label: '埋深', def: 0.25 }],
    surface: [['0', '0'], ['0', 'H'], ['W', 'H']],
    solids: [{ material: '混凝土', pts: [['0', '-D'], ['0', 'H'], ['W', 'H'], ['W', '-D']] }],
  },
  {
    id: 'DITCH', name: 'U 形側溝', desc: '內寬 W、深 H、壁厚 T', params: [{ key: 'W', label: '內寬', def: 0.5 }, { key: 'H', label: '深', def: 0.6 }, { key: 'T', label: '壁厚', def: 0.15 }],
    surface: [['0', '0'], ['T', '0'], ['T', '-H'], ['T+W', '-H'], ['T+W', '0'], ['2*T+W', '0']],
    solids: [{ material: '混凝土', pts: [['0', '0'], ['0', '-H-T'], ['2*T+W', '-H-T'], ['2*T+W', '0'], ['T+W', '0'], ['T+W', '-H'], ['T', '-H'], ['T', '0']] }],
  },
  {
    id: 'WALL', name: '重力式擋土牆（填方側）', desc: '高 H、頂寬 B、前坡 1:N、背坡 1:M', params: [{ key: 'H', label: '牆高', def: 3 }, { key: 'B', label: '頂寬', def: 0.4 }, { key: 'N', label: '前坡 1:', def: 0.3 }, { key: 'M', label: '背坡 1:', def: 0 }],
    surface: [['0', '0'], ['B', '0'], ['B+N*H', '-H']],
    solids: [{ material: '混凝土', pts: [['0', '0'], ['B', '0'], ['B+N*H', '-H'], ['-M*H', '-H']] }],
  },
  {
    id: 'CUTWALL', name: '擋土牆（挖方側）', desc: '高 H、頂寬 B、牆面坡 1:N', params: [{ key: 'H', label: '牆高', def: 2 }, { key: 'B', label: '頂寬', def: 0.4 }, { key: 'N', label: '牆面坡 1:', def: 0.3 }],
    surface: [['0', '0'], ['N*H', 'H'], ['N*H+B', 'H']],
    solids: [{ material: '混凝土', pts: [['0', '0'], ['N*H', 'H'], ['N*H+B', 'H'], ['N*H+B', '0']] }],
  },
  {
    id: 'BERM', name: '平台', desc: '寬 W、向內排水坡 S（%）', params: [{ key: 'W', label: '寬', def: 1.5 }, { key: 'S', label: '坡度 %', def: 0 }],
    surface: [['0', '0'], ['W', '-W*S/100']], solids: [],
  },
  {
    id: 'REVET', name: '護岸（坡面工）', desc: '高 H、坡度 1:N、厚 T（往下）', params: [{ key: 'H', label: '高', def: 3 }, { key: 'N', label: '坡度 1:', def: 0.5 }, { key: 'T', label: '厚', def: 0.3 }],
    surface: [['0', '0'], ['N*H', '-H']],
    solids: [{ material: '混凝土', pts: [['0', '0'], ['N*H', '-H'], ['N*H', '-H-T*SQRT(1+N^2)/N'], ['0', '-T*SQRT(1+N^2)/N']] }],
  },
];

export interface TemplateItem {
  /** 套用側：L 左、R 右、B 兩側 */
  side: 'L' | 'R' | 'B';
  unit: string;
  /** 繪出條件（空白為一律繪出），例：CH>0、GH>LY */
  cond: string;
  /** 參數設定，例：W=0.6; H=MAX(1, LY-EH(LX+0.4)) */
  params: string;
}

export interface LookupTable { name: string; kind: 'IN' | 'TAB'; data: string }

export interface AdvancedTemplate {
  enabled: boolean;
  items: TemplateItem[];
  tables: LookupTable[];
  /** 邊坡每升降多高設一平台（0 = 不設）與平台寬 */
  bermEvery: number;
  bermWidth: number;
}

export const DEFAULT_ADVANCED: AdvancedTemplate = {
  enabled: false,
  items: [
    { side: 'B', unit: 'SHOULDER', cond: '', params: 'W=0.5; S=4' },
    { side: 'B', unit: 'DITCH', cond: 'GH>LY', params: 'W=0.5; H=0.5' },
    { side: 'B', unit: 'WALL', cond: 'LY-EH(LX+0.4)>1.5', params: 'H=ROUND(LY-EH(LX+0.4)+0.5,1); B=0.4; N=0.3' },
  ],
  tables: [],
  bermEvery: 0,
  bermWidth: 1.5,
};

export function parseTableData(s: string): Array<{ k: number; v: number }> {
  const out: Array<{ k: number; v: number }> = [];
  for (const part of s.split(/[,，;\n]/)) {
    const m = part.match(/^\s*(-?[\d.]+)\s*[:：=]\s*(-?[\d.]+)\s*$/);
    if (m) out.push({ k: Number(m[1]), v: Number(m[2]) });
  }
  return out;
}

export interface StructSolid { material: string; unit: string; side: 'L' | 'R'; poly: OZ[]; area: number }
export interface AdvSectionResult extends SectionResult { solids: StructSolid[]; errors: string[] }

/**
 * 進階組合斷面。ground：地面線（o 向右為正）；zc：中心設計高；ov：超高／加寬；sta：樁號。
 * 系統變數：ST 樁號、LW/RW 路寬、LS/RS 橫坡（%，向外下降為正）、CH 中心挖填高（地面−設計）、
 * LX 目前連接點距中心距離、LY 目前連接點高程、GH 連接點處地面高、SIDE（右 1、左 −1）。
 */
export function designSectionAdv(ground: OZ[], zc: number, sta: number, t: SectionTemplate, adv: AdvancedTemplate, ov?: SectionOverride | null, units: StructUnit[] = BUILTIN_UNITS): AdvSectionResult {
  const g = [...ground].sort((a, b) => a.o - b.o);
  const errors: string[] = [];
  const solids: StructSolid[] = [];
  const tables = new Map(adv.tables.map(tb => [tb.name.toUpperCase(), { kind: tb.kind, rows: parseTableData(tb.data) }]));
  const unitMap = new Map(units.map(u => [u.id.toUpperCase(), u]));
  const LW = t.widthL + (ov?.widenL ?? 0), RW = t.widthR + (ov?.widenR ?? 0);
  const LS = ov ? ov.fallL : t.crossfall, RS = ov ? ov.fallR : t.crossfall;
  const gc = groundAt(g, 0);
  const CH = gc === null ? 0 : gc - zc;

  const side = (s: 1 | -1): { pts: OZ[]; res: SideResult } => {
    const w = s > 0 ? RW : LW, fall = s > 0 ? RS : LS;
    const pts: OZ[] = [{ o: s * w, z: zc - (fall / 100) * w }];
    let LX = w, LY = pts[0].z;
    const env = (extra: Record<string, number>): ExprEnv => {
      const gh = groundAt(g, s * LX);
      return {
        vars: { ST: sta, LW, RW, LS, RS, CH, LX, LY, GH: gh ?? LY, SIDE: s, ...extra },
        table: (kind, name, key) => {
          const tb = tables.get(name);
          if (!tb) throw new ExprError(`找不到表 ${name}`);
          return lookup(kind === 'TAB' || tb.kind === 'TAB' ? 'TAB' : 'IN', tb.rows, key);
        },
        eh: off => { const z = groundAt(g, s * off); if (z === null) throw new ExprError(`EH(${off.toFixed(2)}) 超出地面線範圍`); return z; },
      };
    };
    for (const item of adv.items) {
      if (!(item.side === 'B' || (item.side === 'R') === (s > 0))) continue;
      const unit = unitMap.get(item.unit.toUpperCase());
      const tag = `${s > 0 ? '右' : '左'}側 ${unit?.name ?? item.unit}`;
      if (!unit) { errors.push(`${tag}：找不到構造物單元`); continue; }
      try {
        if (item.cond.trim() && !evaluate(item.cond, env({}))) continue;
        const assigned = parseAssignments(item.params);
        const P: Record<string, number> = {};
        for (const prm of unit.params) P[prm.key] = assigned[prm.key] !== undefined ? evaluate(assigned[prm.key], env(P)) : prm.def;
        const e = env(P);
        const tr = ([u, v]: [string, string]): OZ => ({ o: s * (LX + evaluate(u, e)), z: LY + evaluate(v, e) });
        const surf = unit.surface.map(tr);
        for (const sol of unit.solids) {
          const poly = sol.pts.map(tr);
          solids.push({ material: sol.material, unit: unit.name, side: s > 0 ? 'R' : 'L', poly, area: polygonArea(poly.map(q => ({ x: q.o, y: q.z }))) });
        }
        pts.push(...surf.slice(1));
        const last = surf[surf.length - 1];
        LX = Math.abs(last.o); LY = last.z;
      } catch (err) {
        errors.push(`${tag}：${(err as Error).message}`);
      }
    }
    // 放坡接地面（可每隔 bermEvery 設平台）
    const start = pts[pts.length - 1];
    const gStart = groundAt(g, start.o);
    if (gStart === null) return { pts, res: { mode: 'none', daylight: null, caught: false } };
    const mode: 'cut' | 'fill' = gStart > start.z ? 'cut' : 'fill';
    // 構造物末端剛好落在地面上（例如擋土牆牆趾）：不必再放坡
    if (Math.abs(gStart - start.z) < 1e-6) return { pts, res: { mode, daylight: start, caught: true } };
    const slope = mode === 'cut' ? t.cutSlope : t.fillSlope;
    const dirZ = mode === 'cut' ? 1 : -1;
    const outer = g.filter(q => (s > 0 ? q.o > start.o : q.o < start.o)).sort((a, b) => s * (a.o - b.o));
    const limit = outer.length ? Math.abs(outer[outer.length - 1].o) : Math.abs(start.o);
    let cur = start;
    for (let guard = 0; guard < 200; guard++) {
      // 一段邊坡：升降 bermEvery（不設平台時直到取樣邊界）
      const dh = adv.bermEvery > 0 ? adv.bermEvery : Math.max(1, (limit - Math.abs(cur.o)) / Math.max(slope, 1e-6) + 1);
      const end: OZ = { o: cur.o + s * dh * slope, z: cur.z + dirZ * dh };
      const hit = intersectGround(g, cur, end);
      if (hit) { pts.push(hit); return { pts, res: { mode, daylight: hit, caught: true } }; }
      if (Math.abs(end.o) >= limit) {
        const o = s * limit;
        const dl: OZ = { o, z: cur.z + (dirZ * Math.abs(o - cur.o)) / Math.max(slope, 1e-6) };
        pts.push(dl);
        return { pts, res: { mode, daylight: dl, caught: false } };
      }
      pts.push(end);
      const berm: OZ = { o: end.o + s * adv.bermWidth, z: end.z };
      const hit2 = intersectGround(g, end, berm);
      if (hit2) { pts.push(hit2); return { pts, res: { mode, daylight: hit2, caught: true } }; }
      pts.push(berm);
      cur = berm;
    }
    return { pts, res: { mode, daylight: cur, caught: false } };
  };

  const left = side(-1), right = side(1);
  const design: OZ[] = [...left.pts.slice().reverse(), { o: 0, z: zc }, ...right.pts];
  const { cut, fill } = areaBetween(g, design);
  return { ground: g, design, zc, cutArea: cut, fillArea: fill, left: left.res, right: right.res, solids, errors };
}

/** 線段 a→b 與地面線的第一個交點（由 a 往 b） */
function intersectGround(g: OZ[], a: OZ, b: OZ): OZ | null {
  const ga = groundAt(g, a.o);
  if (ga === null) return null;
  let prevO = a.o, prevF = ga - a.z;
  const lo = Math.min(a.o, b.o), hi = Math.max(a.o, b.o);
  const xs = g.map(q => q.o).filter(o => o > lo && o < hi);
  xs.push(b.o);
  xs.sort((x, y) => (b.o > a.o ? x - y : y - x));
  const lineZ = (o: number) => (b.o === a.o ? b.z : a.z + ((o - a.o) / (b.o - a.o)) * (b.z - a.z));
  for (const o of xs) {
    const gz = groundAt(g, o);
    if (gz === null) return null;
    const f = gz - lineZ(o);
    if ((prevF > 0 && f <= 0) || (prevF < 0 && f >= 0)) {
      const t = prevF / (prevF - f);
      const oo = prevO + t * (o - prevO);
      return { o: oo, z: lineZ(oo) };
    }
    prevO = o; prevF = f;
  }
  return null;
}

/** 把簡易斷面轉成進階組合（側溝只設在挖方側） */
export function simpleToAdvanced(t: SectionTemplate): AdvancedTemplate {
  const items: TemplateItem[] = [];
  if (t.ditchWidth > 0 && t.ditchDepth > 0) items.push({ side: 'B', unit: 'DITCH', cond: 'GH>LY', params: `W=${t.ditchWidth}; H=${t.ditchDepth}; T=0.15` });
  return { ...DEFAULT_ADVANCED, enabled: true, items };
}
