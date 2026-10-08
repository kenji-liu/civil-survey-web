// 測點清理：剔除 Z ≤ 0、-9999 與偏離主地形的異常高程（依 v3.4「濾除異常高程點」）
import type { SurveyPoint } from './model';

/**
 * 依四分位距判斷高程異常：Z ≤ 0、超出 [Q1 − k·IQR, Q3 + k·IQR] 的點視為異常。
 * 回傳保留的點與建議的有效高程範圍（保留點的最低、最高各外推 2 m）。
 */
export function filterElevationOutliers(points: SurveyPoint[], k = 3): { kept: SurveyPoint[]; removed: number; range: [number, number] | null } {
  const withZ = points.filter(p => p.z !== null && p.z > 0 && p.z > -9000);
  if (withZ.length < 5) return { kept: points, removed: 0, range: null };
  const zs = withZ.map(p => p.z as number).sort((a, b) => a - b);
  const q = (t: number) => { const i = (zs.length - 1) * t, lo = Math.floor(i), hi = Math.ceil(i); return zs[lo] + (zs[hi] - zs[lo]) * (i - lo); };
  const q1 = q(0.25), q3 = q(0.75), iqr = Math.max(q3 - q1, 1);
  const lo = q1 - k * iqr, hi = q3 + k * iqr;
  const kept = points.filter(p => p.z !== null && p.z > 0 && p.z >= lo && p.z <= hi);
  const kz = kept.map(p => p.z as number);
  const mn = kz.reduce((a, b) => Math.min(a, b), Infinity), mx = kz.reduce((a, b) => Math.max(a, b), -Infinity);
  return { kept, removed: points.length - kept.length, range: kz.length ? [Math.floor(mn - 2), Math.ceil(mx + 2)] : null };
}
