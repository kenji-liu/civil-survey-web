import { describe, it, expect } from 'vitest';
import { dmsToDeg, degToDmsNumber, degToDmsText, formatStation, parseStation, DEG } from '../src/core/units';
import { polygonArea, clipByConvex, clipByHalfPlane } from '../src/core/geom';
import { buildTin, traceContours } from '../src/core/tin';
import { gridEarthwork, flatSurface } from '../src/core/earthwork-grid';
import { buildAlignment, curveElements, radiusFrom, deflectionToIPs, type AlignmentInput } from '../src/core/alignment';
import { buildProfile } from '../src/core/profile';
import { designSection, areaBetween, averageEndArea, type SectionTemplate } from '../src/core/section';

describe('單位', () => {
  it('度分秒互轉', () => {
    expect(dmsToDeg('13.0257')).toBeCloseTo(13 + 2 / 60 + 57 / 3600, 10);
    expect(dmsToDeg(29.3754)).toBeCloseTo(29 + 37 / 60 + 54 / 3600, 10);
    expect(dmsToDeg('-29.3754')).toBeCloseTo(-(29 + 37 / 60 + 54 / 3600), 10);
    expect(dmsToDeg('90')).toBe(90);
    expect(degToDmsNumber(dmsToDeg('13.0257'))).toBe('13.0257');
    expect(degToDmsText(59.99999)).toBe('60°00′00″');
  });
  it('樁號', () => {
    expect(formatStation(2320.5)).toBe('2K+320.50');
    expect(formatStation(86.68)).toBe('0K+086.68');
    expect(formatStation(999.999)).toBe('1K+000.00');
    expect(parseStation('2K+320.50')).toBeCloseTo(2320.5);
    expect(parseStation('130.81')).toBeCloseTo(130.81);
  });
});

describe('幾何裁切', () => {
  it('凹多邊形以凸視窗裁切後面積正確', () => {
    // L 形：面積 3
    const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    expect(polygonArea(L)).toBeCloseTo(3);
    const win = [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }];
    expect(polygonArea(clipByConvex(L, win))).toBeCloseTo(0.75);
    expect(polygonArea(clipByHalfPlane(L, 1, 0, -1))).toBeCloseTo(1); // x >= 1
  });
});

/** 解析地形：斜面 z = 100 + 0.1x + 0.05y */
const plane = (x: number, y: number) => 100 + 0.1 * x + 0.05 * y;
function gridPts(n: number, step: number, f: (x: number, y: number) => number) {
  const pts = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) pts.push({ x: 243000 + i * step, y: 2687000 + j * step, z: f(243000 + i * step, 2687000 + j * step) });
  return pts;
}

describe('TIN', () => {
  it('平面上內插為精確值（大座標）', () => {
    const tin = buildTin(gridPts(10, 10, (x, y) => plane(x - 243000, y - 2687000)))!;
    expect(tin.tri.length / 3).toBe(200);
    expect(tin.sample(243037.3, 2687061.9)!).toBeCloseTo(plane(37.3, 61.9), 8);
    expect(tin.sample(242000, 2687000)).toBeNull();
  });
  it('邊界外的三角形被剔除、最大邊長生效', () => {
    const pts = gridPts(10, 10, () => 50);
    const tin = buildTin(pts, { boundary: [{ x: 243000, y: 2687000 }, { x: 243050, y: 2687000 }, { x: 243050, y: 2687100 }, { x: 243000, y: 2687100 }] })!;
    expect(tin.tri.length / 3).toBe(100);
    const t2 = buildTin(pts, { maxEdge: 5 });
    expect(t2!.tri.length).toBe(0);
  });
  it('等高線：圓錐的等高線為閉合線', () => {
    const cone = (x: number, y: number) => 100 - Math.hypot(x - 243050, y - 2687050);
    const tin = buildTin(gridPts(20, 5, cone))!;
    const lines = traceContours(tin, 10, 5);
    const at80 = lines.filter(l => l.level === 80);
    expect(at80.length).toBe(1);
    expect(at80[0].closed).toBe(true);
    expect(lines.find(l => l.level === 50)?.major).toBe(true);
  });
});

describe('方格法', () => {
  it('斜面對水平面：體積等於解析解', () => {
    // 地面 z = 0.1x（x: 0~100），設計面 z = 5，範圍 100×100
    // 挖方 = ∫(0.1x−5)⁺ = 100 × ∫_50^100 (0.1x−5)dx = 100 × 125 = 12500；填方同為 12500
    const ground = (x: number) => 0.1 * x;
    const bnd = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const r = gridEarthwork(bnd, 7, (x) => ground(x), flatSurface(5));
    expect(r.totalArea).toBeCloseTo(10000, 6);
    expect(r.cut).toBeCloseTo(12500, 4);
    expect(r.fill).toBeCloseTo(12500, 4);
  });
  it('凹形邊界與斜面', () => {
    // L 形範圍面積 7500，地面 z = 10，設計 z = 8 → 挖方 15000
    const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 100 }];
    const r = gridEarthwork(L, 13, () => 10, flatSurface(8));
    expect(r.totalArea).toBeCloseTo(7500, 6);
    expect(r.cut).toBeCloseTo(15000, 4);
    expect(r.fill).toBeCloseTo(0, 6);
  });
  it('地形只涵蓋邊界內時，邊界方格不會被跳過', () => {
    // 地形點與邊界都在 6~94，方格從 0 開始，外圍方格的角點落在地形外
    const pts = [];
    for (let x = 6; x <= 94; x += 4) for (let y = 6; y <= 94; y += 4) pts.push({ x, y, z: 10 });
    const bnd = [{ x: 6, y: 6 }, { x: 94, y: 6 }, { x: 94, y: 94 }, { x: 6, y: 94 }];
    const tin = buildTin(pts, { boundary: bnd })!;
    const r = gridEarthwork(bnd, 10, tin.sample, flatSurface(8));
    expect(r.skipped).toBe(0);
    expect(r.totalArea).toBeCloseTo(88 * 88, 6);
    expect(r.cut).toBeCloseTo(88 * 88 * 2, 4);
  });
  it('角錐體積 = 底面積 × 高 / 3', () => {
    // 以 TIN 建正四角錐（底 100×100、高 30），對 z=0 計算
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 100, z: 0 }, { x: 0, y: 100, z: 0 }, { x: 50, y: 50, z: 30 }];
    const tin = buildTin(pts)!;
    const bnd = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const r = gridEarthwork(bnd, 2, tin.sample, flatSurface(0));
    // 方格對角線與角錐稜線不一致時有方法誤差，驗收標準為 0.1%
    expect(Math.abs(r.cut - 100000) / 100000).toBeLessThan(0.001);
  });
});

describe('平曲線', () => {
  it('曲線要素：Δ=90°、R=100', () => {
    const e = curveElements(100, Math.PI / 2);
    expect(e.T).toBeCloseTo(100);
    expect(e.L).toBeCloseTo(157.0796, 3);
    expect(e.E).toBeCloseTo(41.4214, 3);
    expect(e.M).toBeCloseTo(29.2893, 3);
    expect(radiusFrom({ kind: 'T', value: 100 }, Math.PI / 2)).toBeCloseTo(100);
    expect(radiusFrom({ kind: 'L', value: e.L }, Math.PI / 2)).toBeCloseTo(100);
    expect(radiusFrom({ kind: 'E', value: e.E }, Math.PI / 2)).toBeCloseTo(100);
  });
  const input: AlignmentInput = {
    name: 'A', startStation: 0, interval: 20, minGap: 2, extraStations: [],
    ips: [
      { name: 'BP', x: 0, y: 0, curve: null },
      { name: 'IP1', x: 0, y: 200, curve: { kind: 'R', value: 100 } },
      { name: 'EP', x: 200, y: 200, curve: null },
    ],
  };
  it('中心線長度、BC/EC 與里程', () => {
    const al = buildAlignment(input)!;
    expect(al.curves).toHaveLength(1);
    const c = al.curves[0];
    expect(c.delta / DEG).toBeCloseTo(90); // 右偏
    expect(c.BC.y).toBeCloseTo(100); expect(c.EC.x).toBeCloseTo(100);
    expect(al.length).toBeCloseTo(100 + 157.0796 + 100, 3);
    const mid = al.pointAt(c.staMC)!;
    // 圓心 (100,100)，MC 在 45° 方向
    expect(Math.hypot(mid.x - 100, mid.y - 100)).toBeCloseTo(100, 6);
    expect(mid.x).toBeCloseTo(100 - 100 * Math.SQRT1_2, 6);
    const end = al.pointAt(al.endStation)!;
    expect(end.x).toBeCloseTo(200); expect(end.y).toBeCloseTo(200);
    // 右側偏距
    const p = al.pointAt(50, 5)!;
    expect(p.x).toBeCloseTo(5); expect(p.y).toBeCloseTo(50);
  });
  it('整樁與曲線樁', () => {
    const al = buildAlignment(input)!;
    const labels = al.stakes.map(s => s.label).filter(Boolean);
    expect(labels).toEqual(['BP', 'BC1', 'MC1', 'EC1', 'EP']);
    // 100 剛好是 BC，不重複；整樁每 20m
    expect(al.stakes.filter(s => Math.abs(s.sta - 100) < 1e-6)).toHaveLength(1);
    expect(al.stakes.some(s => Math.abs(s.sta - 180) < 1e-6)).toBe(false); // 距 MC(178.54) < 2m 省略
  });
  it('切線衝突', () => {
    const al = buildAlignment({ ...input, ips: [input.ips[0], { ...input.ips[1], curve: { kind: 'R', value: 300 } }, input.ips[2]] })!;
    expect(al.warnings.some(w => w.includes('切線衝突'))).toBe(true);
  });
  it('偏角法轉座標', () => {
    const ips = deflectionToIPs({ x: 0, y: 0 }, [
      { name: 'BP', angle: '0', dist: 100, curve: null },
      { name: 'IP1', angle: '90', dist: 100, curve: { kind: 'R', value: 30 } },
      { name: 'EP', angle: '0', dist: 0, curve: null },
    ]);
    expect(ips).toHaveLength(3);
    expect(ips[1].name).toBe('IP1'); expect(ips[1].y).toBeCloseTo(100); expect(ips[1].curve?.value).toBe(30);
    expect(ips[2].x).toBeCloseTo(100); expect(ips[2].y).toBeCloseTo(100);
  });
});

describe('縱斷面', () => {
  it('拋物線豎曲線', () => {
    const p = buildProfile([{ sta: 0, z: 100, L: 0 }, { sta: 100, z: 104, L: 40 }, { sta: 200, z: 102, L: 0 }]);
    // g1 = 4%、g2 = −2%、A = −6%，e = A·L/8 = −0.3
    expect(p.curves[0].e).toBeCloseTo(-0.3);
    expect(p.elevAt(100)!).toBeCloseTo(104 - 0.3, 9);
    expect(p.elevAt(80)!).toBeCloseTo(103.2, 9); // BVC
    expect(p.elevAt(50)!).toBeCloseTo(102, 9);
    expect(p.curves[0].type).toBe('crest');
    expect(p.gradeAt(100)!).toBeCloseTo(0.01, 9);
  });
});

describe('橫斷面', () => {
  const t: SectionTemplate = { widthL: 4, widthR: 4, crossfall: 0, cutSlope: 1, fillSlope: 1, ditchWidth: 0, ditchDepth: 0 };
  it('平地全挖：梯形面積', () => {
    // 地面 z=12，設計 z=10，路寬 8，邊坡 1:1 → 梯形 (8 + 12)/2 × 2 = 20
    const ground = Array.from({ length: 61 }, (_, i) => ({ o: -30 + i, z: 12 }));
    const r = designSection(ground, 10, t);
    expect(r.left.mode).toBe('cut');
    expect(r.right.daylight!.o).toBeCloseTo(6);
    expect(r.cutArea).toBeCloseTo(20, 9);
    expect(r.fillArea).toBeCloseTo(0, 9);
  });
  it('橫坡地形：一側挖一側填', () => {
    // 地面 z = 10 + 0.2·o；設計 z=10 平路 → 右挖左填
    const ground = Array.from({ length: 61 }, (_, i) => ({ o: -30 + i, z: 10 + 0.2 * (-30 + i) }));
    const r = designSection(ground, 10, t);
    expect(r.right.mode).toBe('cut');
    expect(r.left.mode).toBe('fill');
    // 右側：路面三角 0.5×4×0.8 = 1.6；邊坡段 daylight 在 o=5（10+(o−4) = 10+0.2o）→ 三角 0.5×1×(1.0−...)
    const right = areaBetween(ground.filter(g => g.o >= 0), r.design.filter(d => d.o >= 0));
    expect(right.cut).toBeCloseTo(1.6 + 0.5 * 1 * 0.8, 6);
    expect(r.cutArea).toBeCloseTo(r.fillArea, 6); // 對稱
  });
  it('平均斷面法', () => {
    const rows = averageEndArea([
      { sta: 0, label: '', cutArea: 10, fillArea: 2, ok: true },
      { sta: 20, label: '', cutArea: 20, fillArea: 0, ok: true },
    ]);
    expect(rows[1].cutVol).toBe(300);
    expect(rows[1].fillVol).toBe(20);
    expect(rows[1].mass).toBe(280);
  });
});
