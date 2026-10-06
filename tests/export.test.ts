import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { demoProject } from '../src/store/demo';
import { computeDerived } from '../src/store/derived';
import { buildDxf, volumeCsv, stakeCsv, curveCsv, gridCsv } from '../src/io/exports';
import { gridEarthwork, flatSurface } from '../src/core/earthwork-grid';
import { parseDxf } from '../src/io/dxf-read';
import { computeTraverse } from '../src/core/traverse';
import { computeLeveling } from '../src/core/leveling';
import { computeSurvey } from '../src/core/survey';

describe('示範專案完整流程', () => {
  const p = demoProject();
  const d = computeDerived(p);
  it('地形、中心線、斷面都算得出來', () => {
    expect(d.nullCount).toBe(2);
    expect(d.tin!.tri.length / 3).toBeGreaterThan(3000);
    expect(d.contours.length).toBeGreaterThan(20);
    expect(d.alignment!.curves).toHaveLength(2);
    expect(d.alignment!.warnings).toEqual([]);
    expect(d.sections.every(s => s.result)).toBe(true);
    const last = d.volumes[d.volumes.length - 1];
    expect(last.cumCut).toBeGreaterThan(0);
  });
  it('自動連線示範：農舍、道路、圍牆、溪流斷線', () => {
    const s = d.sam!;
    expect(s.errors).toEqual([]);
    expect(s.lines.filter(l => l.feature === 'BD').every(l => l.closed)).toBe(true);
    expect(s.lines.filter(l => l.feature === 'RD')).toHaveLength(2);
    expect(s.symbols.filter(x => x.feature === 'E')).toHaveLength(2);
    expect(s.circles).toHaveLength(1);
    expect(d.tin!.nBreakEdges).toBeGreaterThan(80); // 溪流水線 85 點
    expect(d.tin!.warning).toBeNull();
  });
  it('測量計算示範資料：導線、水準、手簿都能算且精度合理', () => {
    const t = computeTraverse(p.traverse, p.controls);
    expect(t.ok).toBe(true);
    expect(Math.abs(t.fAngleSec!)).toBeLessThan(15);
    expect(t.precision!).toBeGreaterThan(5000);
    // 導線點 T1 與真值差 < 1 cm
    const T1 = t.points.find(q => q.name === 'T1')!;
    expect(Math.hypot(T1.x - (243000 + 140), T1.y - (2687000 + 266))).toBeLessThan(0.01);
    const lv = computeLeveling(p.level);
    expect(lv.ok).toBe(true);
    expect(lv.pass).toBe(true);
    expect(lv.rows.some(r => r.kind === 'is')).toBe(true);
    const s = computeSurvey(p.stations, p.controls);
    expect(s.stations.every(st => st.ok)).toBe(true);
    expect(s.points).toHaveLength(17);
    const q = s.points.find(pt => pt.name === '601')!;
    expect(Math.abs(q.z! - d.tin!.sample(q.x, q.y)!)).toBeLessThan(0.3); // 和地形面一致（TIN 內插誤差內）
  });
  it('方格法：邊界方格幾乎全部計入，取不到地形的面積照實回報', () => {
    const g = gridEarthwork(p.boundary!, p.grid.cell, d.tin!.sample, flatSurface(p.grid.designZ));
    expect(g.totalArea + g.skippedArea).toBeCloseTo(408 * 308, 3);
    expect(g.skippedArea / (408 * 308)).toBeLessThan(0.001);
  });
  it('DXF 匯出可被自己的讀取器讀回，並輸出報表', () => {
    const g = gridEarthwork(p.boundary!, 20, d.tin!.sample, flatSurface(730));
    const dxf = buildDxf(p, d, g, { sam: true, points: true, labels: true, tin: true, contours: true, boundary: true, alignment: true, stakes: true, grid: true, textHeight: 1 });
    const back = parseDxf(dxf);
    for (const L of ['POINTS', 'CONT1', 'CONT5', 'TIN', 'AXIS', 'STAKE', 'BOUNDARY', 'GRID_CUT', 'SAM_BLDG', 'SAM_RIVER', 'SAM_POLE']) expect(back.layers.has(L)).toBe(true);
    if (process.env.EXPORT_DIR) {
      writeFileSync(`${process.env.EXPORT_DIR}/demo.dxf`, dxf);
      writeFileSync(`${process.env.EXPORT_DIR}/volume.csv`, volumeCsv(p, d));
      writeFileSync(`${process.env.EXPORT_DIR}/stake.csv`, stakeCsv(p, d));
      writeFileSync(`${process.env.EXPORT_DIR}/curve.csv`, curveCsv(p, d));
      writeFileSync(`${process.env.EXPORT_DIR}/grid.csv`, gridCsv(p, g));
    }
  });
});
