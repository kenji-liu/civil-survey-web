import { describe, it, expect } from 'vitest';
import { SAMPLE_FILES, demoExpectations } from '../src/io/samples';
import { parsePointText } from '../src/io/csv';
import { parseDxf, decodeDxf, dxfToPoints } from '../src/io/dxf-read';
import { parse3DF, computeSurvey } from '../src/core/survey';
import { runSam, DEFAULT_LEGEND } from '../src/core/sam';
import { computeLeveling } from '../src/core/leveling';
import { demoProject } from '../src/store/demo';

const file = (prefix: string) => SAMPLE_FILES.find(f => f.name.startsWith(prefix))!.make();
const rule = { zeroIsNull: true, minZ: -500, maxZ: 9000 };

describe('範例教學練習檔與課程描述一致', () => {
  const e = demoExpectations();
  it('第 2 課：範例1 有 3 點無高程', () => {
    const r = parsePointText(file('範例1'), 'PENZ', rule);
    expect(r.nullZ).toBe(3);
    expect(r.skippedLines).toBe(1); // 標題列
  });
  it('第 3 課：範例2 DXF 有 4 個圖層，匯入後沒有 0 或 -9999，圖框被排除', () => {
    const { text, encoding } = decodeDxf(new TextEncoder().encode(file('範例2')).buffer as ArrayBuffer);
    const data = parseDxf(text, encoding);
    expect([...data.layers.keys()].sort()).toEqual(['CONT1', 'CONT5', 'FRAME', 'SPOT']);
    const rep = dxfToPoints(data, { layers: new Set(data.layers.keys()), usePoints: true, useText: true, usePolylines: true, densify: 5, minDist: 0.5, textRadius: 3, removeOutliers: true, zRule: rule });
    const zs = rep.points.map(p => p.z);
    expect(zs.every(z => z !== null && z > e.zMin - 1 && z < e.zMax + 1)).toBe(true);
    expect(rep.points.some(p => p.x < 1000)).toBe(false);
    expect(rep.fromText).toBe(0); // 高程文字都配到 SPOT 點位
  });
  it('第 4 課：範例3＋範例4 算出 17 點', () => {
    const ctl = parsePointText(file('範例3'), 'PENZ', { zeroIsNull: false, minZ: -1000, maxZ: 9000 }).points.map(p => ({ name: p.name, x: p.x, y: p.y, z: p.z }));
    const st = parse3DF(file('範例4')).stations;
    const r = computeSurvey(st, ctl);
    expect(r.points).toHaveLength(e.surveyPts);
    expect(e.surveyPts).toBe(17);
  });
  it('第 6 課：範例6 貼上後的水準結果和示範一致', () => {
    const rows = file('範例6').trim().split(/\r?\n/).slice(1).map(l => {
      const c = l.split('\t');
      const num = (s: string) => (s === '' || s === undefined ? null : Number(s));
      return { name: c[0], bs: num(c[1]), is: num(c[2]), fs: num(c[3]), dist: num(c[4]) };
    });
    const p = demoProject();
    const r = computeLeveling({ ...p.level, rows });
    expect(r.f).toBeCloseTo(e.levF, 9);
    expect(r.pass).toBe(true);
  });
  it('第 7 課：範例5 連線碼沒有錯誤', () => {
    const pts = parsePointText(file('範例5'), 'PENZ', rule).points;
    const s = runSam(pts, DEFAULT_LEGEND);
    expect(s.errors).toEqual([]);
    expect(s.lines.length).toBe(e.samLines);
    expect(s.symbols.length).toBe(e.samSymbols);
    expect(s.circles).toHaveLength(1);
  });
  it('第 5、8、9 課的預期數值合理', () => {
    expect(e.travPrecision).toBeGreaterThan(5000);
    expect(e.gridCut).toBeGreaterThan(0);
    expect(e.gridFill).toBeGreaterThan(0);
    expect(e.curves).toBe(2);
    expect(e.travT1Plus20).not.toBe(e.travT1);
  });
});
