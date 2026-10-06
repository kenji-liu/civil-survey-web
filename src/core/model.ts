// 專案資料模型（存檔格式）
import type { XY } from './geom';
import type { AlignmentInput } from './alignment';
import type { VPI } from './profile';
import type { SectionTemplate } from './section';

export interface SurveyPoint {
  id: number;
  name: string;
  x: number;
  y: number;
  /** null 表示無高程，不參與三角網 */
  z: number | null;
  code?: string;
}

export interface ZRule {
  /** 高程為 0 視為無資料 */
  zeroIsNull: boolean;
  /** 合理高程範圍，超出視為無資料（例：-9999） */
  minZ: number;
  maxZ: number;
}

export interface Project {
  format: 'civil-web-project';
  version: 1;
  info: { name: string; code: string; owner: string; site: string; designer: string };
  createdAt: string;
  updatedAt: string;
  points: SurveyPoint[];
  zRule: ZRule;
  /** 三角網外邊界（也作為方格法計算範圍） */
  boundary: XY[] | null;
  tin: { maxEdge: number; useBoundary: boolean };
  contour: { interval: number; majorEvery: number; labels: boolean };
  grid: {
    cell: number;
    designMode: 'flat' | 'slope';
    designZ: number;
    slopePct: number;
    slopeAzDeg: number;
  };
  alignment: AlignmentInput | null;
  /** 縱坡交點 */
  vpis: VPI[];
  template: SectionTemplate;
  /** 橫斷面取樣：左右各取多寬、取樣間距 */
  sectionSample: { halfWidth: number; step: number };
}

export function isValidZ(z: number | null | undefined, rule: ZRule): z is number {
  if (z === null || z === undefined || !isFinite(z)) return false;
  if (rule.zeroIsNull && z === 0) return false;
  return z >= rule.minZ && z <= rule.maxZ;
}

/** 下一個可用的點 id（不用展開運算子，避免大量點時堆疊溢位） */
export function nextPointId(points: SurveyPoint[]): number {
  let m = 0;
  for (const p of points) if (p.id > m) m = p.id;
  return m + 1;
}

export function newProject(name = '未命名工程'): Project {
  const now = new Date().toISOString();
  return {
    format: 'civil-web-project',
    version: 1,
    info: { name, code: '', owner: '', site: '', designer: '' },
    createdAt: now,
    updatedAt: now,
    points: [],
    zRule: { zeroIsNull: true, minZ: -500, maxZ: 9000 },
    boundary: null,
    tin: { maxEdge: 0, useBoundary: true },
    contour: { interval: 1, majorEvery: 5, labels: true },
    grid: { cell: 10, designMode: 'flat', designZ: 0, slopePct: 0, slopeAzDeg: 0 },
    alignment: null,
    vpis: [],
    template: { widthL: 3.5, widthR: 3.5, crossfall: 2, cutSlope: 0.5, fillSlope: 1.5, ditchWidth: 0.6, ditchDepth: 0.4 },
    sectionSample: { halfWidth: 30, step: 1 },
  };
}

/** 讀入舊版或不完整的專案檔時補上預設值 */
export function normalizeProject(p: Partial<Project>): Project {
  const base = newProject();
  if (p.format !== 'civil-web-project') throw new Error('不是本系統的專案檔');
  return {
    ...base,
    ...p,
    info: { ...base.info, ...p.info },
    zRule: { ...base.zRule, ...p.zRule },
    tin: { ...base.tin, ...p.tin },
    contour: { ...base.contour, ...p.contour },
    grid: { ...base.grid, ...p.grid },
    template: { ...base.template, ...p.template },
    sectionSample: { ...base.sectionSample, ...p.sectionSample },
    points: p.points ?? [],
    vpis: p.vpis ?? [],
  } as Project;
}
