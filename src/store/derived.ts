// 由專案資料推導出的計算結果。每一步都是純函式；React 端依參考相等做快取，只有相關資料變動時才重算。
import { useMemo } from 'react';
import type { Project } from '../core/model';
import { isValidZ } from '../core/model';
import { buildTin, traceContours, type Tin, type ContourLine, type Pt3 } from '../core/tin';
import { buildAlignment, type Alignment, type Stake } from '../core/alignment';
import { buildProfile, type Profile } from '../core/profile';
import { designSection, averageEndArea, type SectionResult, type VolumeRow, type OZ } from '../core/section';
import { runSam, samBreaklines, type SamResult } from '../core/sam';
import { buildRoadway, type Roadway } from '../core/superelev';
import { designSectionAdv, type StructSolid } from '../core/section-adv';

/** side：落差構造物處的上游（up）／下游（down）斷面 */
export interface StakeRow { stake: Stake; ground: number | null; design: number | null; dh: number | null; side?: 'up' | 'down' }
export interface SectionRow { stake: Stake; result: SectionResult | null; reason?: string; solids?: StructSolid[]; errors?: string[] }

/** 構造物數量：各材料逐樁面積與平均斷面法體積 */
export interface QuantityRow { material: string; unit: string; volume: number }

export interface Derived {
  sam: SamResult | null;
  roadway: Roadway | null;
  validCount: number;
  nullCount: number;
  tin: Tin | null;
  contours: ContourLine[];
  alignment: Alignment | null;
  profile: Profile;
  groundLine: Array<{ sta: number; z: number | null }>;
  stakeRows: StakeRow[];
  sections: SectionRow[];
  volumes: VolumeRow[];
  quantities: QuantityRow[];
}

/** 自動連線：依測點順序解讀代碼（無效高程視為 null） */
export function samOf(p: Pick<Project, 'points' | 'zRule' | 'legend' | 'sam'>): SamResult | null {
  if (!p.sam.enabled || !p.points.some(q => q.code)) return null;
  return runSam(p.points.map(q => ({ name: q.name, x: q.x, y: q.y, z: isValidZ(q.z, p.zRule) ? q.z : null, code: q.code })), p.legend);
}

export function breaklinesOf(p: Pick<Project, 'legend' | 'sam'>, sam: SamResult | null): Pt3[][] {
  return sam && p.sam.useBreaklines ? samBreaklines(sam, p.legend) : [];
}

export function validPoints(p: Project): Pt3[] {
  return p.points.filter(q => isValidZ(q.z, p.zRule)).map(q => ({ x: q.x, y: q.y, z: q.z as number }));
}

/** 縱斷面地面高：三角網取樣，或依水準測量成果（樁號→高程）內插 */
export type GroundFn = (sta: number, x: number, y: number) => number | null;

export function groundFnOf(tin: Tin | null, pg: Project['profileGround']): GroundFn | null {
  if (pg.source === 'level' && pg.pts.length >= 2) {
    const pts = [...pg.pts].sort((a, b) => a.sta - b.sta);
    return sta => {
      if (sta < pts[0].sta - 1e-6 || sta > pts[pts.length - 1].sta + 1e-6) return null;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (sta <= b.sta + 1e-9) return b.sta === a.sta ? a.z : a.z + ((sta - a.sta) / (b.sta - a.sta)) * (b.z - a.z);
      }
      return pts[pts.length - 1].z;
    };
  }
  return tin ? (_s, x, y) => tin.sample(x, y) : null;
}

export function groundLineOf(al: Alignment | null, g: GroundFn | null) {
  if (!al || !g) return [];
  const out: Array<{ sta: number; z: number | null }> = [];
  const step = Math.max(0.5, al.length / 600);
  for (let s = al.startStation; s <= al.endStation + 1e-6; s += step) {
    const sta = Math.min(s, al.endStation);
    const q = al.pointAt(sta)!;
    out.push({ sta, z: g(sta, q.x, q.y) });
  }
  return out;
}

export function stakeRowsOf(al: Alignment | null, g: GroundFn | null, profile: Profile): StakeRow[] {
  if (!al) return [];
  const drops = profile.drops.filter(d => d.sta >= al.startStation - 1e-6 && d.sta <= al.endStation + 1e-6);
  const stakes: Array<{ stake: Stake; side?: 'up' | 'down' }> = al.stakes.filter(s => !drops.some(d => Math.abs(d.sta - s.sta) < 1e-4)).map(stake => ({ stake }));
  // 落差處建立上游、下游兩個斷面樁
  for (const d of drops) {
    const q = al.pointAt(d.sta)!;
    const base: Stake = { sta: d.sta, label: d.name, kind: 'extra', x: q.x, y: q.y, az: q.az };
    stakes.push({ stake: { ...base, label: `${d.name}(上)` }, side: 'up' }, { stake: { ...base, label: `${d.name}(下)` }, side: 'down' });
  }
  stakes.sort((a, b) => a.stake.sta - b.stake.sta || (a.side === 'up' ? -1 : 1));
  return stakes.map(({ stake, side }) => {
    const ground = g ? g(stake.sta, stake.x, stake.y) : null;
    const design = side === 'up' ? profile.elevBefore(stake.sta) : profile.elevAt(stake.sta);
    return { stake, ground, design, dh: ground !== null && design !== null ? ground - design : null, side };
  });
}

/** 實際使用的縱坡交點：VIP 少於 2 個時改用單一坡度（起點設計高＋縱坡） */
export function effectiveVpis(p: Pick<Project, 'vpis' | 'pfSimple'>, al: Alignment | null) {
  if (p.vpis.length >= 2 || !al) return p.vpis;
  const s0 = al.startStation, s1 = al.endStation;
  return [{ sta: s0, z: p.pfSimple.z0, L: 0 }, { sta: s1, z: p.pfSimple.z0 + (p.pfSimple.slope / 100) * (s1 - s0), L: 0 }];
}

const tinOpts = (p: Project, breaklines: Pt3[][]) => ({
  maxEdge: p.tin.maxEdge,
  boundary: p.tin.useBoundary ? p.boundary : null,
  breaklines,
  peel: p.tin.hideSliver ? { maxEdge: p.tin.maxEdge, minAngle: p.tin.minAngle } : null,
  flips: p.tin.flips ?? [],
});

export function sectionsOf(al: Alignment | null, rows: StakeRow[], tin: Tin | null, p: Pick<Project, 'sectionSample' | 'template' | 'advanced'>, roadway: Roadway | null = null): SectionRow[] {
  if (!al) return [];
  const { halfWidth, step } = p.sectionSample;
  return rows.map(({ stake, design }) => {
    if (!tin) return { stake, result: null, reason: '沒有地形資料' };
    if (design === null) return { stake, result: null, reason: '沒有設計高（請設定縱坡）' };
    const ground: OZ[] = [];
    const n = Math.max(1, Math.round(halfWidth / Math.max(step, 0.1)));
    for (let i = -n; i <= n; i++) {
      const o = (i / n) * halfWidth;
      const q = al.pointAt(stake.sta, o)!;
      const z = tin.sample(q.x, q.y);
      if (z !== null) ground.push({ o, z });
    }
    if (ground.length < 2) return { stake, result: null, reason: '斷面超出地形範圍' };
    const ov = roadway ? roadway.stateAt(stake.sta) : null;
    if (p.advanced?.enabled) {
      const r = designSectionAdv(ground, design, stake.sta, p.template, p.advanced, ov);
      return { stake, result: r, solids: r.solids, errors: r.errors };
    }
    return { stake, result: designSection(ground, design, p.template, ov) };
  });
}

export function quantitiesOf(sections: SectionRow[]): QuantityRow[] {
  const key = (s: StructSolid) => `${s.unit}|${s.material}`;
  const areaAt = (row: SectionRow) => {
    const m = new Map<string, number>();
    for (const s of row.solids ?? []) m.set(key(s), (m.get(key(s)) ?? 0) + s.area);
    return m;
  };
  const tot = new Map<string, number>();
  for (let i = 1; i < sections.length; i++) {
    const a = areaAt(sections[i - 1]), b = areaAt(sections[i]);
    const L = sections[i].stake.sta - sections[i - 1].stake.sta;
    for (const k of new Set([...a.keys(), ...b.keys()])) tot.set(k, (tot.get(k) ?? 0) + (((a.get(k) ?? 0) + (b.get(k) ?? 0)) / 2) * L);
  }
  return [...tot.entries()].map(([k, volume]) => { const [unit, material] = k.split('|'); return { unit, material, volume }; });
}

export function volumesOf(sections: SectionRow[]) {
  return averageEndArea(sections.map(s => ({
    sta: s.stake.sta, label: s.stake.label,
    cutArea: s.result?.cutArea ?? 0, fillArea: s.result?.fillArea ?? 0, ok: !!s.result,
  })));
}

/** 不經 React 的完整計算（測試與批次用） */
export function computeDerived(p: Project): Derived {
  const valid = validPoints(p);
  const sam = samOf(p);
  const tin = buildTin(valid, tinOpts(p, breaklinesOf(p, sam)));
  const contours = tin ? traceContours(tin, p.contour.interval, p.contour.majorEvery) : [];
  const alignment = p.alignment ? buildAlignment(p.alignment) : null;
  const profile = buildProfile(effectiveVpis(p, alignment), p.drops);
  const g = groundFnOf(tin, p.profileGround);
  const stakeRows = stakeRowsOf(alignment, g, profile);
  const roadway = buildRoadway(alignment, p.roadway);
  const sections = sectionsOf(alignment, stakeRows, tin, p, roadway);
  return {
    quantities: quantitiesOf(sections),
    sam, roadway, validCount: valid.length, nullCount: p.points.length - valid.length,
    tin, contours, alignment, profile, groundLine: groundLineOf(alignment, g), stakeRows, sections, volumes: volumesOf(sections),
  };
}

export function useDerived(p: Project): Derived {
  const valid = useMemo(() => validPoints(p), [p.points, p.zRule]); // eslint-disable-line react-hooks/exhaustive-deps
  const sam = useMemo(() => samOf(p), [p.points, p.zRule, p.legend, p.sam]); // eslint-disable-line react-hooks/exhaustive-deps
  const breaklines = useMemo(() => breaklinesOf(p, sam), [p.legend, p.sam, sam]); // eslint-disable-line react-hooks/exhaustive-deps
  const tin = useMemo(() => buildTin(valid, tinOpts(p, breaklines)), [valid, p.tin, p.boundary, breaklines]); // eslint-disable-line react-hooks/exhaustive-deps
  const contours = useMemo(() => (tin ? traceContours(tin, p.contour.interval, p.contour.majorEvery) : []), [tin, p.contour.interval, p.contour.majorEvery]);
  const alignment = useMemo(() => (p.alignment ? buildAlignment(p.alignment) : null), [p.alignment]);
  const profile = useMemo(() => buildProfile(effectiveVpis(p, alignment), p.drops), [p.vpis, p.pfSimple, p.drops, alignment]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = useMemo(() => groundFnOf(tin, p.profileGround), [tin, p.profileGround]);
  const groundLine = useMemo(() => groundLineOf(alignment, g), [alignment, g]);
  const stakeRows = useMemo(() => stakeRowsOf(alignment, g, profile), [alignment, g, profile]);
  const roadway = useMemo(() => buildRoadway(alignment, p.roadway), [alignment, p.roadway]);
  const sections = useMemo(() => sectionsOf(alignment, stakeRows, tin, { sectionSample: p.sectionSample, template: p.template, advanced: p.advanced }, roadway), [alignment, stakeRows, tin, p.sectionSample, p.template, p.advanced, roadway]);
  const quantities = useMemo(() => quantitiesOf(sections), [sections]);
  const volumes = useMemo(() => volumesOf(sections), [sections]);
  return {
    sam, roadway, quantities, validCount: valid.length, nullCount: p.points.length - valid.length,
    tin, contours, alignment, profile, groundLine, stakeRows, sections, volumes,
  };
}
