// 超高與加寬（依手冊第九章引用之交通部《公路路線設計規範》民國 90 年版）
// 超高：e = Vd²/(127R) − f，下限為正常路拱、上限為 emax；R ≥ 免設超高半徑時維持正常路拱。
// 超高漸變：以中心線為旋轉軸。正常路拱 → 外側水平（路拱消除段）→ 全超高（超高漸變段）。
//   漸變段長 Le = max(B·e/Gr, Vd·s/3.6)；路拱消除段長 = B·c/Gr。B 為中心線到外側車道邊緣的寬度。
//   有緩和曲線時漸變段即緩和曲線；沒有時依「直線段比例」分配在直線與圓曲線上。
// 加寬：Wc = N(Uc + Cc) + (N−1)Fa + Zc，Uc = 2.5 + R − √(R² − Y)，Fa = √(R² + X) − R，
//   Cc = (Vd + 90)/200，Zc = 0.1Vd/√R；ΔW = Wc − Wn，小於 0.5 m 免設，加在曲線內側。
import type { Alignment, CurveData } from './alignment';

export interface RoadwaySettings {
  enabled: boolean;
  /** 設計速率 Vd（km/h） */
  speed: number;
  /** 最大超高 */
  emax: number;
  /** 正常路拱（%） */
  crown: number;
  /** 車道數 N（雙向合計） */
  lanes: number;
  /** 每車道寬（m） */
  laneWidth: number;
  vehicle: 'SU' | 'WB12' | 'WB15';
  /** 未設緩和曲線時，漸變段放在直線上的比例（%），規範為 50～100 */
  tangentPct: number;
  /** 漸變率採用：建議值或容許最大值 */
  grade: 'rec' | 'max';
  widening: boolean;
}

export const DEFAULT_ROADWAY: RoadwaySettings = {
  enabled: false, speed: 40, emax: 0.08, crown: 2, lanes: 2, laneWidth: 3.5, vehicle: 'SU', tangentPct: 70, grade: 'rec', widening: true,
};

const SPEEDS = [120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 25];
/** 表 9.1 平曲線最小半徑：[emax 0.04, 0.06, 0.08, 0.10] */
const RMIN: Record<number, Array<number | null>> = {
  120: [null, 700, 620, 560], 110: [null, 560, 500, 450], 100: [null, 440, 390, 360], 90: [380, 340, 300, 280], 80: [280, 250, 230, 210],
  70: [210, 190, 170, 160], 60: [150, 140, 120, 110], 50: [100, 90, 80, 75], 40: [60, 55, 50, 45], 30: [35, 30, 30, 25], 25: [25, 20, 20, 20],
};
/** 表 9.2 側向摩擦係數（110、120 km/h 規範未列，沿用 100 km/h 值） */
const FRIC: Array<[number, number]> = [[25, 0.173], [30, 0.17], [40, 0.164], [50, 0.158], [60, 0.152], [70, 0.146], [80, 0.14], [90, 0.13], [100, 0.12], [120, 0.12]];
/** 表 9.3 免設超高曲線半徑（容許最小值） */
const RN: Record<number, number> = { 120: 4500, 110: 3800, 100: 3100, 90: 2500, 80: 2000, 70: 1500, 60: 1100, 50: 780, 40: 500, 30: 280, 25: 200 };
/** 表 9.4 免設緩和曲線半徑（容許最小值） */
const RS: Record<number, number> = { 120: 2100, 110: 1750, 100: 1450, 90: 1200, 80: 950, 70: 700, 60: 500, 50: 360, 40: 230, 30: 130, 25: 90 };
/** 表 9.9 超高漸變率 [容許最大值, 建議值]（分母） */
const GR: Record<number, [number, number]> = {
  120: [250, 300], 110: [230, 280], 100: [210, 260], 90: [190, 240], 80: [170, 220], 70: [150, 200], 60: [130, 180], 50: [110, 160], 40: [90, 140], 30: [70, 120], 25: [60, 110],
};
/** 表 9.7 設計車輛尺寸係數 */
const VEH: Record<RoadwaySettings['vehicle'], { name: string; X: number; Y: number }> = {
  SU: { name: '貨車 SU', X: 15.8, Y: 36 }, WB12: { name: '中型半聯結車 WB12', X: 10.8, Y: 71.5 }, WB15: { name: '大型半聯結車 WB15', X: 10.5, Y: 110.2 },
};
export const VEHICLES = Object.entries(VEH).map(([k, v]) => [k, v.name] as [RoadwaySettings['vehicle'], string]);

/** 表格依設計速率取值：取不小於 Vd 的最近一級（偏安全） */
function bySpeed<T>(tab: Record<number, T>, v: number): T {
  const keys = SPEEDS.filter(s => tab[s] !== undefined).sort((a, b) => a - b);
  return tab[keys.find(s => s >= v) ?? keys[keys.length - 1]];
}

export function friction(v: number): number {
  for (let i = 1; i < FRIC.length; i++) {
    const [v0, f0] = FRIC[i - 1], [v1, f1] = FRIC[i];
    if (v <= v1) return v <= v0 ? f0 : f0 + ((v - v0) / (v1 - v0)) * (f1 - f0);
  }
  return FRIC[FRIC.length - 1][1];
}

export function rMin(v: number, emax: number): number | null {
  const row = bySpeed(RMIN, v);
  const idx = Math.round((emax - 0.04) / 0.02);
  return row[Math.max(0, Math.min(3, idx))];
}

export function rNoSuper(v: number) { return bySpeed(RN, v); }
export function rNoSpiral(v: number) { return bySpeed(RS, v); }
export function gradeRate(v: number, mode: 'rec' | 'max') { return 1 / bySpeed(GR, v)[mode === 'rec' ? 1 : 0]; }

/** 緩和曲線最短長度 Ls = Vd³ / (47·J·R)，J 標準值 0.7 − Vd/400 */
export function minSpiral(v: number, R: number) {
  const J = 0.7 - v / 400;
  return (v ** 3) / (47 * J * R);
}

/** 設計超高（小數）；正常路拱時回傳 crown */
export function designSuper(v: number, R: number, s: RoadwaySettings): number {
  const c = s.crown / 100;
  if (R >= rNoSuper(v)) return c;
  const e = (v * v) / (127 * R) - friction(v);
  return Math.min(s.emax, Math.max(c, Math.ceil(e * 1000) / 1000));
}

/** 單側加寬量 ΔW（m），小於 0.5 m 回傳 0 */
export function widening(v: number, R: number, s: RoadwaySettings): number {
  const { X, Y } = VEH[s.vehicle];
  const N = s.lanes;
  if (R * R <= Y) return 0;
  const Uc = 2.5 + R - Math.sqrt(R * R - Y);
  const Fa = Math.sqrt(R * R + X) - R;
  const Cc = (v + 90) / 200;
  const Zc = (0.1 * v) / Math.sqrt(R);
  const Wc = N * (Uc + Cc) + (N - 1) * Fa + Zc;
  const dW = Wc - N * s.laneWidth;
  return dW < 0.5 ? 0 : Math.round(dW * 100) / 100;
}

export interface CurveSuper {
  name: string;
  R: number;
  /** 設計超高（小數），等於路拱時表示免設超高 */
  e: number;
  dW: number;
  /** 漸變段長、路拱消除段長 */
  Le: number;
  Lr: number;
  /** 關鍵樁號：路拱消除起點、外側水平、全超高起、全超高終、外側水平、路拱恢復終點 */
  keys: [number, number, number, number, number, number];
  dir: 1 | -1;
  warnings: string[];
}

export interface RoadwayState { fallL: number; fallR: number; widenL: number; widenR: number }

export interface Roadway {
  curves: CurveSuper[];
  stateAt(sta: number): RoadwayState;
}

export function buildRoadway(al: Alignment | null, s: RoadwaySettings): Roadway | null {
  if (!al || !s.enabled) return null;
  const c = s.crown / 100;
  const v = s.speed;
  const B = (s.lanes * s.laneWidth) / 2;
  const Gr = gradeRate(v, s.grade);
  const curves: CurveSuper[] = al.curves.map((cv: CurveData) => {
    const warnings: string[] = [];
    const rm = rMin(v, s.emax);
    if (rm !== null && cv.R < rm) warnings.push(`R=${cv.R.toFixed(1)} 小於規範最小半徑 ${rm} m（Vd=${v}、emax=${s.emax}）`);
    if (rm === null) warnings.push(`設計速率 ${v} km/h 不適用 emax=${s.emax}`);
    if (!cv.ls && v > 40 && cv.R < rNoSpiral(v)) warnings.push(`R 小於免設緩和曲線半徑 ${rNoSpiral(v)} m，建議設緩和曲線 Ls ≥ ${minSpiral(v, cv.R).toFixed(1)} m`);
    if (cv.ls && cv.ls < minSpiral(v, cv.R)) warnings.push(`緩和曲線 Ls=${cv.ls} 小於最短長度 ${minSpiral(v, cv.R).toFixed(1)} m`);
    const e = designSuper(v, cv.R, s);
    const dW = s.widening ? widening(v, cv.R, s) : 0;
    const Le = cv.ls ? cv.ls : Math.max((B * e) / Gr, (v * 3) / 3.6);
    const Lr = (B * c) / Gr;
    let k1: number, k2: number, k3: number, k4: number;
    if (cv.ls) {
      k1 = cv.staTS; k2 = cv.staBC; k3 = cv.staEC; k4 = cv.staST;
      if (cv.ls < (B * e) / Gr - 1e-6) warnings.push(`緩和曲線長小於超高漸變所需 ${((B * e) / Gr).toFixed(1)} m`);
    } else {
      const tp = Math.max(0, Math.min(100, s.tangentPct)) / 100;
      k1 = cv.staBC - Le * tp; k2 = k1 + Le; k4 = cv.staEC + Le * tp; k3 = k4 - Le;
      if (k2 > k3) { const m = (cv.staBC + cv.staEC) / 2; k2 = k3 = m; warnings.push('圓曲線太短，無法完整設置全超高段'); }
    }
    return { name: cv.name, R: cv.R, e, dW, Le, Lr, keys: [k1 - Lr, k1, k2, k3, k4, k4 + Lr], dir: cv.delta > 0 ? 1 : -1, warnings };
  });

  /** 外側路面坡度（向外下降為正）：c → 0 → −e → −e → 0 → c */
  const outerAt = (k: CurveSuper['keys'], e: number, sta: number) => {
    const [a0, a1, a2, a3, a4, a5] = k;
    const lin = (x: number, x0: number, x1: number, y0: number, y1: number) => (x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
    if (sta <= a0 || sta >= a5) return null;
    if (sta < a1) return lin(sta, a0, a1, c, 0);
    if (sta < a2) return lin(sta, a1, a2, 0, -e);
    if (sta <= a3) return -e;
    if (sta < a4) return lin(sta, a3, a4, -e, 0);
    return lin(sta, a4, a5, 0, c);
  };
  /** 加寬漸變：漸變段內線性增加 */
  const widenAt = (k: CurveSuper['keys'], dW: number, sta: number) => {
    const [, a1, a2, a3, a4] = k;
    if (!dW || sta <= a1 || sta >= a4) return 0;
    if (sta < a2) return (dW * (sta - a1)) / Math.max(a2 - a1, 1e-9);
    if (sta > a3) return (dW * (a4 - sta)) / Math.max(a4 - a3, 1e-9);
    return dW;
  };

  return {
    curves,
    stateAt(sta: number): RoadwayState {
      for (const cs of curves) {
        const out = outerAt(cs.keys, cs.e, sta);
        if (out === null) continue;
        // 內側：外側降到 −c 之前維持 c，之後與外側反向（以中心線為軸旋轉）
        const inner = Math.max(c, -out);
        const w = widenAt(cs.keys, cs.dW, sta);
        const pct = (x: number) => Math.round(x * 100000) / 1000;
        // 右偏：外側為左、內側為右
        return cs.dir > 0
          ? { fallL: pct(out), fallR: pct(inner), widenL: 0, widenR: w }
          : { fallL: pct(inner), fallR: pct(out), widenL: w, widenR: 0 };
      }
      return { fallL: s.crown, fallR: s.crown, widenL: 0, widenR: 0 };
    },
  };
}
