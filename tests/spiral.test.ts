import { describe, it, expect } from 'vitest';
import { buildAlignment, spiralElements, clothoidXY, type AlignmentInput } from '../src/core/alignment';

const input = (ls: number, R = 100): AlignmentInput => ({
  name: 'A', startStation: 0, interval: 20, minGap: 2, extraStations: [],
  ips: [
    { name: 'BP', x: 0, y: 0, curve: null },
    { name: 'IP1', x: 0, y: 300, curve: { kind: 'R', value: R }, ls },
    { name: 'EP', x: 300, y: 300, curve: null },
  ],
});

describe('克羅梭緩和曲線', () => {
  it('要素：p ≈ Ls²/24R、k ≈ Ls/2 − Ls³/240R²', () => {
    const e = spiralElements(100, 40, Math.PI / 2);
    expect(e.ths).toBeCloseTo(0.2, 12);
    expect(e.p).toBeCloseTo(1600 / 2400 - 40 ** 4 / (2688 * 100 ** 3), 4);
    expect(e.k).toBeCloseTo(20 - 40 ** 3 / (240 * 100 ** 2), 4);
    expect(e.Lc).toBeCloseTo(100 * (Math.PI / 2 - 0.4), 9);
    // 小角度時 y ≈ l³/6RLs
    expect(clothoidXY(10, 1000, 100).y).toBeCloseTo(1000 / 600000, 9);
  });
  it('幾何連續：TS、SC、CS、ST 位置與方向都接得上，終點落在 EP', () => {
    const al = buildAlignment(input(40))!;
    expect(al.warnings).toEqual([]);
    const c = al.curves[0];
    expect(c.ls).toBe(40);
    const eps = 1e-7;
    for (const sta of [c.staTS, c.staBC, c.staEC, c.staST]) {
      const a = al.pointAt(sta - eps)!, b = al.pointAt(sta + eps)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-5);
      expect(Math.abs(a.az - b.az)).toBeLessThan(1e-6);
    }
    // SC 到圓心距離 = R
    expect(Math.hypot(c.BC.x - c.center.x, c.BC.y - c.center.y)).toBeCloseTo(100, 6);
    // 緩和曲線終點 ST 與由 IP 量切線長得到的 ST 一致
    const st = al.pointAt(c.staST)!;
    expect(st.x).toBeCloseTo(c.ST.x, 6); expect(st.y).toBeCloseTo(c.ST.y, 6);
    const end = al.pointAt(al.endStation)!;
    expect(end.x).toBeCloseTo(300, 6); expect(end.y).toBeCloseTo(300, 6);
    // 全長 = 兩段直線 + 2Ls + Lc
    expect(al.length).toBeCloseTo(2 * (300 - c.T) + 2 * 40 + c.Lc, 6);
  });
  it('樁號：TS、SC、MC、CS、ST', () => {
    const al = buildAlignment(input(40))!;
    expect(al.stakes.filter(s => s.label).map(s => s.label)).toEqual(['BP', 'TS1', 'SC1', 'MC1', 'CS1', 'ST1', 'EP']);
  });
  it('緩和曲線太長時改為單圓曲線並警告', () => {
    const al = buildAlignment(input(400))!;
    expect(al.curves[0].ls).toBe(0);
    expect(al.warnings.some(w => w.includes('緩和曲線太長'))).toBe(true);
  });
  it('左偏也正確', () => {
    const al = buildAlignment({ ...input(30), ips: [{ name: 'BP', x: 0, y: 0, curve: null }, { name: 'IP1', x: 0, y: 300, curve: { kind: 'R', value: 80 }, ls: 30 }, { name: 'EP', x: -300, y: 300, curve: null }] })!;
    const end = al.pointAt(al.endStation)!;
    expect(end.x).toBeCloseTo(-300, 6); expect(end.y).toBeCloseTo(300, 6);
    const c = al.curves[0];
    const a = al.pointAt(c.staBC - 1e-7)!, b = al.pointAt(c.staBC + 1e-7)!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-5);
  });
});
