import { describe, it, expect } from 'vitest';
import { designSuper, widening, rMin, rNoSuper, friction, gradeRate, minSpiral, buildRoadway, DEFAULT_ROADWAY } from '../src/core/superelev';
import { buildAlignment } from '../src/core/alignment';
import { designSection } from '../src/core/section';

const S = { ...DEFAULT_ROADWAY, enabled: true, speed: 60, emax: 0.08, crown: 2 };

describe('規範表格', () => {
  it('最小半徑、免設超高半徑、摩擦係數、漸變率', () => {
    expect(rMin(60, 0.08)).toBe(120);
    expect(rMin(100, 0.04)).toBeNull();
    expect(rNoSuper(60)).toBe(1100);
    expect(friction(60)).toBeCloseTo(0.152, 9);
    expect(friction(65)).toBeCloseTo((0.152 + 0.146) / 2, 9);
    expect(gradeRate(60, 'rec')).toBeCloseTo(1 / 180, 12);
    expect(gradeRate(45, 'max')).toBeCloseTo(1 / 110, 12); // 取較高一級（50）偏安全
    expect(minSpiral(60, 150)).toBeCloseTo(216000 / (47 * (0.7 - 0.15) * 150), 6);
  });
  it('設計超高：e = V²/127R − f，上下限', () => {
    expect(designSuper(60, 150, S)).toBeCloseTo(0.037, 9);   // 0.18898 − 0.152 = 0.03698 → 0.037
    expect(designSuper(60, 1200, S)).toBeCloseTo(0.02, 9);   // 大於免設超高半徑 → 正常路拱
    expect(designSuper(60, 400, S)).toBeCloseTo(0.02, 9);    // 計算值小於路拱 → 取路拱
    expect(designSuper(60, 60, S)).toBeCloseTo(0.08, 9);     // 超過 emax → emax
  });
  it('加寬（AASHTO 公式）', () => {
    // Vd=40、R=50、SU、雙車道 3.5 m：Wc ≈ 7.746 → ΔW ≈ 0.75
    expect(widening(40, 50, { ...S, speed: 40 })).toBeCloseTo(0.75, 2);
    expect(widening(60, 500, S)).toBe(0); // 小於 0.5 m 免設
  });
});

describe('超高漸變與斷面', () => {
  const al = buildAlignment({
    name: 'A', startStation: 0, interval: 20, minGap: 2, extraStations: [],
    ips: [{ name: 'BP', x: 0, y: 0, curve: null }, { name: 'IP1', x: 0, y: 400, curve: { kind: 'R', value: 150 } }, { name: 'EP', x: 400, y: 400, curve: null }],
  })!;
  const rw = buildRoadway(al, S)!;
  const cs = rw.curves[0];
  it('右偏：外側（左）由路拱轉成反向，內側（右）加大', () => {
    expect(cs.e).toBeCloseTo(0.037, 9);
    const [a0, a1, a2, a3, a4, a5] = cs.keys;
    expect(rw.stateAt(a0 - 1)).toEqual({ fallL: 2, fallR: 2, widenL: 0, widenR: 0 });
    expect(rw.stateAt(a1).fallL).toBeCloseTo(0, 9);
    expect(rw.stateAt(a1).fallR).toBeCloseTo(2, 9);
    const full = rw.stateAt((a2 + a3) / 2);
    expect(full.fallL).toBeCloseTo(-3.7, 9);
    expect(full.fallR).toBeCloseTo(3.7, 9);
    expect(rw.stateAt(a5 + 1).fallL).toBe(2);
    // 未設緩和曲線：漸變段 70% 在直線上
    expect(a1).toBeCloseTo(al.curves[0].staBC - 0.7 * cs.Le, 9);
    expect(a4 - a3).toBeCloseTo(cs.Le, 9);
  });
  it('斷面套用超高與加寬', () => {
    const ground = Array.from({ length: 61 }, (_, i) => ({ o: -30 + i, z: 100 }));
    const t = { widthL: 3.5, widthR: 3.5, crossfall: 2, cutSlope: 1, fillSlope: 1, ditchWidth: 0, ditchDepth: 0 };
    const r = designSection(ground, 100, t, { fallL: -4, fallR: 4, widenL: 0, widenR: 0.8 });
    const left = r.design.find(p => Math.abs(p.o + 3.5) < 1e-9)!, right = r.design.find(p => Math.abs(p.o - 4.3) < 1e-9)!;
    expect(left.z).toBeCloseTo(100 + 0.14, 9);  // 外側抬高 3.5 × 4%
    expect(right.z).toBeCloseTo(100 - 0.172, 9); // 內側（加寬後 4.3 m）降低 4%
  });
});
