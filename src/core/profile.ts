// 縱斷面：縱坡交點 (VPI) 與拋物線豎曲線
// z(x) = z_BVC + g1·x + A/(2L)·x²，x 為距 BVC 的距離，A = g2 − g1
// 中距 e = A·L/8

export interface VPI { sta: number; z: number; /** 豎曲線長，0 表示不設 */ L: number }

export interface VerticalCurve {
  index: number; sta: number; z: number; L: number;
  g1: number; g2: number; A: number; e: number;
  bvc: number; evc: number;
  type: 'crest' | 'sag';
}

export interface Profile {
  vpis: VPI[];
  curves: VerticalCurve[];
  grades: number[];
  warnings: string[];
  elevAt(sta: number): number | null;
  gradeAt(sta: number): number | null;
}

export function buildProfile(input: VPI[]): Profile {
  const vpis = [...input].filter(v => isFinite(v.sta) && isFinite(v.z)).sort((a, b) => a.sta - b.sta);
  const warnings: string[] = [];
  const grades: number[] = [];
  for (let i = 0; i < vpis.length - 1; i++) {
    const ds = vpis[i + 1].sta - vpis[i].sta;
    grades.push(ds > 0 ? (vpis[i + 1].z - vpis[i].z) / ds : 0);
  }
  const curves: VerticalCurve[] = [];
  for (let i = 1; i < vpis.length - 1; i++) {
    const v = vpis[i];
    if (!(v.L > 0)) continue;
    const g1 = grades[i - 1], g2 = grades[i], A = g2 - g1;
    curves.push({ index: i, sta: v.sta, z: v.z, L: v.L, g1, g2, A, e: (A * v.L) / 8, bvc: v.sta - v.L / 2, evc: v.sta + v.L / 2, type: A < 0 ? 'crest' : 'sag' });
  }
  // 豎曲線重疊或超出前後交點
  for (let k = 0; k < curves.length; k++) {
    const c = curves[k];
    const prevLimit = k > 0 ? curves[k - 1].evc : vpis[0].sta;
    if (c.bvc < prevLimit - 1e-6) warnings.push(`VPI ${c.index} 豎曲線起點 BVC 與前一段重疊`);
    if (c.evc > vpis[c.index + 1].sta + 1e-6) warnings.push(`VPI ${c.index} 豎曲線終點 EVC 超過下一個交點`);
  }

  const segIndex = (sta: number) => {
    for (let i = 0; i < vpis.length - 1; i++) if (sta <= vpis[i + 1].sta) return i;
    return vpis.length - 2;
  };
  const tangentAt = (sta: number) => {
    const i = segIndex(sta);
    return vpis[i].z + grades[i] * (sta - vpis[i].sta);
  };
  const elevAt = (sta: number) => {
    if (vpis.length < 2 || sta < vpis[0].sta - 1e-6 || sta > vpis[vpis.length - 1].sta + 1e-6) return null;
    for (const c of curves) {
      if (sta >= c.bvc && sta <= c.evc) {
        const x = sta - c.bvc;
        const zBVC = c.z - c.g1 * (c.L / 2);
        return zBVC + c.g1 * x + (c.A / (2 * c.L)) * x * x;
      }
    }
    return tangentAt(sta);
  };
  const gradeAt = (sta: number) => {
    if (vpis.length < 2) return null;
    for (const c of curves) if (sta >= c.bvc && sta <= c.evc) return c.g1 + (c.A * (sta - c.bvc)) / c.L;
    return grades[segIndex(sta)];
  };
  return { vpis, curves, grades, warnings, elevAt, gradeAt };
}
