import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { demoProject } from '../src/store/demo';
import { computeDerived } from '../src/store/derived';
import { buildSheets, sheetToSvg, DEFAULT_PLOT } from '../src/core/sheets';
import { sheetsToDxf } from '../src/ui/plot-ui';
import { parseDxf } from '../src/io/dxf-read';

describe('出圖', () => {
  const p = demoProject();
  const d = computeDerived(p);
  const sheets = buildSheets(p, d, DEFAULT_PLOT);
  it('產生平面、縱斷、橫斷三類圖紙，圖號連續', () => {
    const kinds = new Set(sheets.map(s => s.kind));
    expect([...kinds].sort()).toEqual(['plan', 'profile', 'section']);
    const nums = sheets.map(s => s.prims.find(q => q.k === 'text' && q.s.startsWith('D-'))!);
    expect(nums.map(t => (t as { s: string }).s)).toEqual(sheets.map((_, i) => `D-${i + 1}／${sheets.length}`));
  });
  it('圖元都在圖紙內', () => {
    for (const sh of sheets) for (const q of sh.prims) {
      const pts = q.k === 'line' ? q.pts : [{ x: q.x, y: q.y }];
      for (const pt of pts) { expect(pt.x).toBeGreaterThanOrEqual(-1); expect(pt.x).toBeLessThanOrEqual(sh.w + 1); expect(pt.y).toBeGreaterThanOrEqual(-1); expect(pt.y).toBeLessThanOrEqual(sh.h + 1); }
    }
  });
  it('橫斷面圖包含每個可計算的樁號', () => {
    const n = sheets.filter(s => s.kind === 'section').reduce((c, s) => c + s.prims.filter(q => q.k === 'text' && q.s.includes('At=')).length, 0);
    expect(n).toBe(d.sections.filter(s => s.result).length);
  });
  it('SVG 與 DXF 輸出', () => {
    const svg = sheetToSvg(sheets[0]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('平面圖');
    const dxf = sheetsToDxf(sheets);
    const back = parseDxf(dxf);
    expect(back.layers.has('FRAME')).toBe(true);
    expect(back.layers.has('PROF_DESIGN')).toBe(true);
    if (process.env.EXPORT_DIR) writeFileSync(`${process.env.EXPORT_DIR}/sheets.dxf`, dxf);
  });
});
