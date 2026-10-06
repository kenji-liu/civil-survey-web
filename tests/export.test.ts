import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { demoProject } from '../src/store/demo';
import { computeDerived } from '../src/store/derived';
import { buildDxf, volumeCsv, stakeCsv, curveCsv, gridCsv } from '../src/io/exports';
import { gridEarthwork, flatSurface } from '../src/core/earthwork-grid';
import { parseDxf } from '../src/io/dxf-read';

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
  it('方格法：邊界方格幾乎全部計入，取不到地形的面積照實回報', () => {
    const g = gridEarthwork(p.boundary!, p.grid.cell, d.tin!.sample, flatSurface(p.grid.designZ));
    expect(g.totalArea + g.skippedArea).toBeCloseTo(408 * 308, 3);
    expect(g.skippedArea / (408 * 308)).toBeLessThan(0.001);
  });
  it('DXF 匯出可被自己的讀取器讀回，並輸出報表', () => {
    const g = gridEarthwork(p.boundary!, 20, d.tin!.sample, flatSurface(730));
    const dxf = buildDxf(p, d, g, { points: true, labels: true, tin: true, contours: true, boundary: true, alignment: true, stakes: true, grid: true, textHeight: 1 });
    const back = parseDxf(dxf);
    for (const L of ['POINTS', 'CONT1', 'CONT5', 'TIN', 'AXIS', 'STAKE', 'BOUNDARY', 'GRID_CUT']) expect(back.layers.has(L)).toBe(true);
    if (process.env.EXPORT_DIR) {
      writeFileSync(`${process.env.EXPORT_DIR}/demo.dxf`, dxf);
      writeFileSync(`${process.env.EXPORT_DIR}/volume.csv`, volumeCsv(p, d));
      writeFileSync(`${process.env.EXPORT_DIR}/stake.csv`, stakeCsv(p, d));
      writeFileSync(`${process.env.EXPORT_DIR}/curve.csv`, curveCsv(p, d));
      writeFileSync(`${process.env.EXPORT_DIR}/grid.csv`, gridCsv(p, g));
    }
  });
});
