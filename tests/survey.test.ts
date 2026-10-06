import { describe, it, expect } from 'vitest';
import { computeTraverse, type TraverseInput } from '../src/core/traverse';
import { computeLeveling } from '../src/core/leveling';
import { computeSurvey, parse3DF, to3DF, resect, forwardIntersection, type ControlPoint, type Obs } from '../src/core/survey';
import { fitSimilarity, apply } from '../src/core/transform';
import { azimuth, polar } from '../src/core/geom';
import { DEG, degToDmsNumber } from '../src/core/units';

const ctl = (name: string, x: number, y: number, z: number | null = null): ControlPoint => ({ name, x, y, z });
const row = (name: string, angle: string, dist: number, dh: number | null = null) => ({ name, angle, dist, dh });

describe('導線', () => {
  // 幾何：B(0,−100) → A(0,0) → P1(100,0) → P2(100,100) → E(200,100) → F(200,200)
  const K = [ctl('B', 0, -100), ctl('A', 0, 0, 10), ctl('E', 200, 100, 13), ctl('F', 200, 200)];
  const base: TraverseInput = {
    type: 'link-4', startAz: '', backsight: 'B', foresight: 'F',
    rows: [row('A', '270', 100, 1), row('P1', '90', 100, 1), row('P2', '270', 100, 1), row('E', '90', 0)],
  };
  it('四已知點：無誤差時精確閉合', () => {
    const r = computeTraverse(base, K);
    expect(r.ok).toBe(true);
    expect(r.fAngleSec!).toBeCloseTo(0, 6);
    expect(r.f!).toBeCloseTo(0, 6);
    expect(r.points[1].x).toBeCloseTo(100, 6); expect(r.points[1].y).toBeCloseTo(0, 6);
    expect(r.points[2].x).toBeCloseTo(100, 6); expect(r.points[2].y).toBeCloseTo(100, 6);
    expect(r.points[2].z).toBeCloseTo(12, 6);
  });
  it('四已知點：角度與座標閉合差分配', () => {
    const t = { ...base, rows: [row('A', '270', 100), row('P1', '90.0010', 100.03), row('P2', '270', 100), row('E', '90', 0)] };
    const r = computeTraverse(t, K);
    expect(r.fAngleSec!).toBeCloseTo(10, 4);  // P1 多量 10″
    expect(r.nAngles).toBe(4);
    // 改正後終點必須回到 E
    const last = r.points[r.points.length - 1];
    expect(last.x).toBe(200); expect(last.y).toBe(100);
    const sumC = r.legs.reduce((s, l) => s + l.cE, 0);
    expect(sumC).toBeCloseTo(-r.fE!, 9);
    expect(r.precision!).toBeGreaterThan(1000);
  });
  it('一已知點閉合導線（正方形）', () => {
    const r = computeTraverse({
      type: 'loop-az', startAz: '0', backsight: '', foresight: '',
      rows: [row('A', '', 100), row('P1', '270', 100), row('P2', '270', 100), row('P3', '270', 100), row('A', '270', 0)],
    }, K);
    expect(r.ok).toBe(true);
    expect(r.fAngleSec!).toBeCloseTo(0, 6);
    expect(r.f!).toBeCloseTo(0, 6);
    expect(r.points[2].x).toBeCloseTo(100, 6); expect(r.points[2].y).toBeCloseTo(100, 6);
  });
  it('二已知點閉合導線：未知起始方位，旋轉到兩已知點', () => {
    const r = computeTraverse({ type: 'link-2', startAz: '', backsight: '', foresight: '', rows: [row('A', '', 100), row('P1', '90', 100), row('P2', '270', 100), row('E', '', 0)] }, K);
    expect(r.fLength!).toBeCloseTo(0, 6);
    expect(r.points[1].x).toBeCloseTo(100, 6); expect(r.points[1].y).toBeCloseTo(0, 6);
  });
  it('缺少已知點時給出明確訊息', () => {
    const r = computeTraverse({ ...base, backsight: 'ZZ' }, K);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ZZ');
  });
});

describe('水準', () => {
  const rows = [
    { name: 'BM1', bs: 1.5, is: null, fs: null, dist: null },
    { name: 'TP1', bs: 1.8, is: null, fs: 1.2, dist: null },
    { name: '0+020', bs: null, is: 2.0, fs: null, dist: null },
    { name: 'BM2', bs: null, is: null, fs: 0.9, dist: null },
  ];
  it('附合水準：按測站數分配閉合差', () => {
    const r = computeLeveling({ startZ: 100, endMode: 'known', endZ: 101.212, tolC: 20, rows });
    expect(r.ok).toBe(true);
    expect(r.sumBS - r.sumFS).toBeCloseTo(1.2, 9);
    expect(r.f!).toBeCloseTo(-0.012, 9);
    expect(r.rows[1].z!).toBeCloseTo(100.306, 9);
    expect(r.rows[2].z!).toBeCloseTo(100.109, 9);
    expect(r.rows[3].z!).toBeCloseTo(101.212, 9);
    expect(r.allowed).toBeNull(); // 沒填距離
  });
  it('按距離分配與限度檢核', () => {
    const withDist = rows.map((r, i) => ({ ...r, dist: i === 0 ? null : 100 }));
    const r = computeLeveling({ startZ: 100, endMode: 'known', endZ: 101.212, tolC: 20, rows: withDist });
    expect(r.totalDist).toBe(300);
    expect(r.allowed!).toBeCloseTo(0.02 * Math.sqrt(0.3), 9); // 10.95 mm
    expect(r.pass).toBe(false);                                  // 閉合差 12 mm 超限
    expect(computeLeveling({ startZ: 100, endMode: 'known', endZ: 101.212, tolC: 24, rows: withDist }).pass).toBe(true); // 13.1 mm 內
    expect(r.rows[1].corr).toBeCloseTo(0.004, 9);
  });
  it('閉合水準', () => {
    const r = computeLeveling({ startZ: 50, endMode: 'loop', endZ: 0, tolC: 8, rows: [
      { name: 'BM', bs: 1, is: null, fs: null, dist: null }, { name: 'TP', bs: 2, is: null, fs: 0.5, dist: null }, { name: 'BM', bs: null, is: null, fs: 2.503, dist: null },
    ] });
    expect(r.f!).toBeCloseTo(-0.003, 9);
    expect(r.rows[2].z!).toBeCloseTo(50, 9);
  });
});

describe('測站計算、轉站、交會、自由測站', () => {
  // K1 架站後視 K2（正北），觀測一般點、轉站點 T1，再由 T1 架站
  const K = [ctl('K1', 1000, 1000, 100), ctl('K2', 1000, 1100, 101)];
  const target = { x: 1080, y: 1060 };
  const T1 = { x: 1050, y: 950 };
  const obsTo = (from: { x: number; y: number }, p: { x: number; y: number }, ori: number, name: string, code = ''): Obs => {
    const az = azimuth(from, p);
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    return { name, ht: 1.5, hz: degToDmsNumber(((az - ori) / DEG + 360) % 360, 2), v: '90', dist: Math.round(d * 1e4) / 1e4, code };
  };
  it('一般點、轉站點、第二站與前方交會', () => {
    const r = computeSurvey([
      { name: 'K1', bs: 'K2', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [obsTo(K[0], { x: 1050, y: 1000 }, 0, '1'), obsTo(K[0], T1, 0, 'T1'), obsTo(K[0], target, 0, 'X', '99999.X')] },
      { name: 'T1', bs: 'K1', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [obsTo(T1, { x: 1050, y: 900 }, azimuth(T1, K[0]), '2'), obsTo(T1, target, azimuth(T1, K[0]), 'X', '99999.X')] },
    ], K);
    expect(r.stations.every(s => s.ok)).toBe(true);
    const p1 = r.points.find(p => p.name === '1')!;
    expect(p1.x).toBeCloseTo(1050, 3); expect(p1.y).toBeCloseTo(1000, 3); expect(p1.z).toBeCloseTo(100, 6);
    const p2 = r.points.find(p => p.name === '2')!;
    expect(p2.x).toBeCloseTo(1050, 3); expect(p2.y).toBeCloseTo(900, 3);
    const x = r.points.find(p => p.kind === 'intersection')!;
    expect(x.x).toBeCloseTo(1080, 3); expect(x.y).toBeCloseTo(1060, 3);
    expect(r.newControls.map(c => c.name).sort()).toEqual(['T1', 'X']);
  });
  it('測站順序顛倒也能算（第二輪才有轉站點）', () => {
    const r = computeSurvey([
      { name: 'T1', bs: 'K1', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [obsTo(T1, { x: 1050, y: 900 }, azimuth(T1, K[0]), '2')] },
      { name: 'K1', bs: 'K2', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [obsTo(K[0], T1, 0, 'T1')] },
    ], K);
    expect(r.stations.every(s => s.ok)).toBe(true);
  });
  it('覘標高 0 的點不計高程；缺控制點時回報原因', () => {
    const r = computeSurvey([
      { name: 'K1', bs: 'K2', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [{ ...obsTo(K[0], { x: 1010, y: 1000 }, 0, '9'), ht: 0 }] },
      { name: 'Q9', bs: 'K1', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [] },
    ], K);
    expect(r.points[0].z).toBeNull();
    expect(r.stations[1].ok).toBe(false);
    expect(r.stations[1].message).toContain('Q9');
  });
  it('自由測站（後方交會）', () => {
    const S = { x: 50, y: 50 };
    const pts = [ctl('A', 150, 50, 20), ctl('B', 50, 150, 22), ctl('C', -20, 0, 18)];
    const ori = 30 * DEG;
    const list = pts.map(pt => ({ obs: { ...obsTo(S, pt, ori, pt.name, 'BS'), v: '90' }, pt }));
    const r = resect(1.5, 'SD', list);
    expect(r.x).toBeCloseTo(50, 3); expect(r.y).toBeCloseTo(50, 3);
    expect(r.orientation / DEG).toBeCloseTo(30, 3);
    expect(r.rms).toBeLessThan(1e-3);
    expect(r.z!).toBeCloseTo(20, 6); // 天頂距 90°：測站高 = 20 + 1.5 − 1.5 − 0（三點高程不同，取平均）
    // 經由 computeSurvey：測站不在控制點中、有 BS 觀測
    const s = computeSurvey([{ name: 'S1', bs: '', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [...list.map(l => l.obs), obsTo(S, { x: 60, y: 60 }, ori, '5')] }], pts);
    const p5 = s.points.find(p => p.name === '5')!;
    expect(p5.x).toBeCloseTo(60, 3); expect(p5.y).toBeCloseTo(60, 3);
  });
  it('前方交會計算器', () => {
    const A = { x: 0, y: 0 }, B = { x: 100, y: 0 }, P = { x: 40, y: 70 };
    const p = forwardIntersection(A, B, '0', degToDmsNumber(((azimuth(A, P) - azimuth(A, B)) / DEG + 360) % 360, 3), '10', degToDmsNumber(((azimuth(B, P) - azimuth(B, A)) / DEG + 10 + 360) % 360, 3))!;
    expect(p.x).toBeCloseTo(40, 3); expect(p.y).toBeCloseTo(70, 3);
  });
});

describe('3DF', () => {
  it('解析手冊範例並可寫回', () => {
    const txt = 'ST:T1 T0 1.540 0.0000\nSD:1 1.500 32.5935 94.3641 8.865 PCODE\nSD:2,1.500,34.1847,93.5154,15.587\nST:T2 T1 1.490\nHD:12 1.500 0.0000 -0.354 32.955\nrubbish\n';
    const r = parse3DF(txt);
    expect(r.stations).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.stations[0]).toMatchObject({ name: 'T1', bs: 'T0', hi: 1.54, bsAngle: '0.0000', mode: 'SD' });
    expect(r.stations[0].obs[0]).toMatchObject({ name: '1', ht: 1.5, hz: '32.5935', v: '94.3641', dist: 8.865, code: 'PCODE' });
    expect(r.stations[1]).toMatchObject({ name: 'T2', bs: 'T1', hi: 1.49, mode: 'HD' });
    const back = parse3DF(to3DF(r.stations));
    expect(back.stations).toEqual(r.stations);
  });
});

describe('座標轉換', () => {
  it('相似轉換可還原參數', () => {
    const t = { a: 1.0001 * Math.cos(0.3), b: 1.0001 * Math.sin(0.3), tx: 500, ty: -200 };
    const from = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 30, y: 80 }];
    const s = fitSimilarity(from.map(f => ({ from: f, to: apply(t, f) })), false)!;
    expect(s.scale).toBeCloseTo(1.0001, 9);
    expect(s.rotation).toBeCloseTo(0.3, 9);
    expect(s.rms).toBeLessThan(1e-9);
    const rigid = fitSimilarity(from.map(f => ({ from: f, to: apply(t, f) })), true)!;
    expect(rigid.scale).toBeCloseTo(1, 12);
    expect(polar({ x: 0, y: 0 }, 0, 1).y).toBe(1);
  });
});
