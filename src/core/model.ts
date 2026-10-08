// 專案資料模型（存檔格式）
import type { XY } from './geom';
import type { AlignmentInput } from './alignment';
import type { VPI, Drop, OtherLine } from './profile';
import type { SectionTemplate } from './section';
import type { ControlPoint, Station } from './survey';
import type { TraverseInput } from './traverse';
import type { LevelInput } from './leveling';
import { DEFAULT_LEGEND, type LegendItem } from './sam';
import { DEFAULT_ROADWAY, type RoadwaySettings } from './superelev';
import { DEFAULT_ADVANCED, type AdvancedTemplate } from './section-adv';

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
  /** hideSliver：由外圍往內剝除過長邊（maxEdge）與銳角（minAngle）三角形 */
  tin: { maxEdge: number; useBoundary: boolean; hideSliver: boolean; minAngle: number; flips: Array<[number, number, number, number]> };
  contour: { interval: number; majorEvery: number; labels: boolean };
  grid: {
    cell: number;
    /** flat 水平面、slope 單向斜面、profile 依中心線縱斷設計高 */
    designMode: 'flat' | 'slope' | 'profile';
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
  // ---- 第二版：測量計算 ----
  /** 控制點資料庫（已知點、轉站點） */
  controls: ControlPoint[];
  /** 外業觀測手簿 */
  stations: Station[];
  traverse: TraverseInput;
  level: LevelInput;
  /** 座標轉換對應點：原座標 (fx, fy) → 新座標 (tx, ty) */
  transform: { pairs: Array<{ name: string; fx: number; fy: number; tx: number; ty: number }>; fixScale: boolean; dz: number };
  /** 縱斷面原地面來源：三角網或水準測量 */
  profileGround: { source: 'tin' | 'level'; pts: Array<{ sta: number; z: number }> };
  // ---- 第三版：自動連線成圖 ----
  /** 圖例庫（地類碼 → 名稱、圖層、線型、是否為斷線） */
  legend: LegendItem[];
  sam: { enabled: boolean; useBreaklines: boolean };
  // ---- v1.0 ----
  /** 超高與加寬 */
  roadway: RoadwaySettings;
  /** 進階組合斷面（構造物單元＋條件＋運算式） */
  advanced: AdvancedTemplate;
  // ---- v2.0（v3.4 介面）----
  /** 防砂壩／固床工等垂直落差 */
  drops: Drop[];
  /** 單一坡度模式（VIP 少於 2 個時）：起點設計高與縱坡 % */
  pfSimple: { z0: number; slope: number };
  /** 縱斷面圖面設定、規範等級、其他設計線、備註 */
  pf: ProfileDisplay;
  /** 匯入 DXF 的彩色線條底圖 */
  backdrop: BackdropItem[] | null;
}

export interface ProfileDisplay {
  title: string;
  /** 垂直誇大倍率，0 = 自動填滿 */
  vEx: number;
  slopeFmt: 'pct' | 'ratio' | 'deg';
  showA: boolean;
  showField: boolean;
  fieldOff: number;
  leaderH: number;
  speed: number;
  rows: string[];
  /** 備註：每行「樁號, 文字」 */
  notes: string;
  /** 區間備註：每行「起樁號, 迄樁號, 文字」 */
  ranges: string;
  lines: OtherLine[];
}

export interface BackdropItem { c: string; pts: number[]; closed: boolean }

export const PF_ROWS: Array<[string, string]> = [
  ['name', '點名 / 曲線樁'], ['sta', '縱斷面里程'], ['dist', '單距'], ['ground', '原地面高程'], ['design', '中心設計高程'], ['cutfill', '中心挖填高'],
  ['cut', '挖深'], ['fill', '填高'], ['lt', '左田高'], ['rt', '右田高'], ['grade', '設計縱坡度'], ['note', '備註'],
];

export const DEFAULT_PF: ProfileDisplay = {
  title: '縱斷面圖', vEx: 0, slopeFmt: 'pct', showA: true, showField: false, fieldOff: 6, leaderH: 0, speed: 40,
  rows: ['name', 'sta', 'ground', 'design', 'cutfill', 'grade'], notes: '', ranges: '', lines: [],
};

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
    tin: { maxEdge: 45, useBoundary: true, hideSliver: true, minAngle: 8, flips: [] },
    contour: { interval: 1, majorEvery: 5, labels: true },
    grid: { cell: 10, designMode: 'flat', designZ: 0, slopePct: 0, slopeAzDeg: 0 },
    alignment: null,
    vpis: [],
    template: { widthL: 3.5, widthR: 3.5, crossfall: 2, cutSlope: 0.5, fillSlope: 1.5, ditchWidth: 0.6, ditchDepth: 0.4 },
    sectionSample: { halfWidth: 30, step: 1 },
    controls: [],
    stations: [],
    traverse: { type: 'link-4', startAz: '0', backsight: '', foresight: '', rows: [] },
    level: { startZ: 0, endMode: 'known', endZ: 0, tolC: 20, rows: [] },
    transform: { pairs: [], fixScale: true, dz: 0 },
    profileGround: { source: 'tin', pts: [] },
    legend: DEFAULT_LEGEND.map(l => ({ ...l })),
    sam: { enabled: true, useBreaklines: true },
    roadway: { ...DEFAULT_ROADWAY },
    advanced: { ...DEFAULT_ADVANCED, items: DEFAULT_ADVANCED.items.map(i => ({ ...i })) },
    drops: [],
    pfSimple: { z0: 100, slope: -1.5 },
    pf: { ...DEFAULT_PF, rows: [...DEFAULT_PF.rows] },
    backdrop: null,
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
    controls: p.controls ?? [],
    stations: p.stations ?? [],
    traverse: { ...base.traverse, ...p.traverse },
    level: { ...base.level, ...p.level },
    transform: { ...base.transform, ...p.transform },
    profileGround: { ...base.profileGround, ...p.profileGround },
    legend: p.legend?.length ? p.legend : base.legend,
    sam: { ...base.sam, ...p.sam },
    roadway: { ...base.roadway, ...p.roadway },
    advanced: { ...base.advanced, ...p.advanced },
    drops: p.drops ?? [],
    pfSimple: { ...base.pfSimple, ...p.pfSimple },
    pf: { ...base.pf, ...p.pf },
    backdrop: p.backdrop ?? null,
  } as Project;
}
