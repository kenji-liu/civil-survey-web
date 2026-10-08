import { describe, it, expect } from 'vitest';
import { buildProfile, checkProfileSpec, specVcLengths, minVcLength, otherLineZ, parseNotes, parseRanges, fmtGrade } from '../src/core/profile';
import { buildAlignment, reverseIPs, setAllRadius, stationOf, type AlignmentInput } from '../src/core/alignment';
import { buildTin, nearestSharedEdge } from '../src/core/tin';
import { filterElevationOutliers } from '../src/core/cleanup';
import { parseDxf, dxfToPoints } from '../src/io/dxf-read';
import { dxfBackdrop, aciToColor } from '../src/io/backdrop';
import { stakeRowsOf, effectiveVpis } from '../src/store/derived';

describe('落差構造物', () => {
  const p = buildProfile([{ sta: 0, z: 100, L: 0 }, { sta: 100, z: 98, L: 0 }], [{ sta: 40, dz: 2, name: '防砂壩' }]);
  it('落差處上游、下游高程與之後整體下移', () => {
    expect(p.elevBefore(40)!).toBeCloseTo(99.2, 9);
    expect(p.elevAt(40)!).toBeCloseTo(97.2, 9);
    expect(p.elevAt(39)!).toBeCloseTo(99.22, 9);
    expect(p.elevAt(100)!).toBeCloseTo(96, 9);
    expect(p.lineAt(100)!).toBeCloseTo(98, 9);
  });
  it('斷面樁：落差處建立 (上)(下) 兩樁', () => {
    const al = buildAlignment({ name: 'A', startStation: 0, interval: 20, minGap: 2, extraStations: [], ips: [{ name: 'BP', x: 0, y: 0, curve: null }, { name: 'EP', x: 0, y: 100, curve: null }] })!;
    const rows = stakeRowsOf(al, null, p);
    const at40 = rows.filter(r => Math.abs(r.stake.sta - 40) < 1e-9);
    expect(at40.map(r => r.stake.label)).toEqual(['防砂壩(上)', '防砂壩(下)']);
    expect(at40[0].design! - at40[1].design!).toBeCloseTo(2, 9);
  });
});

describe('豎曲線重疊自動縮短', () => {
  it('L 超過可用空間時縮短並警告', () => {
    const p = buildProfile([{ sta: 0, z: 100, L: 0 }, { sta: 50, z: 105, L: 200 }, { sta: 100, z: 100, L: 0 }]);
    expect(p.curves[0].L).toBe(100);
    expect(p.curves[0].reqL).toBe(200);
    expect(p.warnings[0]).toContain('縮短');
  });
});

describe('縱斷面規範檢查', () => {
  it('超過最大縱坡、豎曲線長不足', () => {
    // 40 km/h：最大 11%；凸形 K=4
    const p = buildProfile([{ sta: 0, z: 100, L: 0 }, { sta: 100, z: 112, L: 10 }, { sta: 200, z: 112, L: 0 }]);
    const r = checkProfileSpec(p, 40);
    expect(r.segBad.has(0)).toBe(true);
    expect(r.curveBad.has(1)).toBe(true);
    expect(minVcLength(-12, 40)).toBe(48);
    expect(minVcLength(0.4, 40)).toBeNull();
    const fixed = specVcLengths([{ sta: 0, z: 100, L: 0 }, { sta: 100, z: 112, L: 10 }, { sta: 200, z: 112, L: 0 }], 40);
    expect(fixed[1].L).toBe(50);
  });
  it('坡度顯示格式', () => {
    expect(fmtGrade(0.05, 'pct')).toBe('+5.00%');
    expect(fmtGrade(-0.05, 'ratio')).toBe('-1:20.0');
    expect(fmtGrade(1, 'deg')).toBe('45.00°');
  });
});

describe('其他設計線、備註', () => {
  it('絕對與相對高程、內插', () => {
    const design = (s: number) => 100 - 0.01 * s;
    expect(otherLineZ({ code: 'L1', name: '溝底', color: '#fff', mode: 'abs', visible: true, text: '0, 99\n100, 97' }, 50, design)).toBeCloseTo(98, 9);
    expect(otherLineZ({ code: 'L2', name: '溝底', color: '#fff', mode: 'rel', visible: true, text: '0, -1\n100,-1' }, 50, design)).toBeCloseTo(98.5, 9);
    expect(parseNotes('35, 防砂壩頂\n80，新設固床工\nxx')).toEqual([{ sta: 35, text: '防砂壩頂' }, { sta: 80, text: '新設固床工' }]);
    expect(parseRanges('20, 60, 護岸 H=3m')).toEqual([{ s1: 20, s2: 60, text: '護岸 H=3m' }]);
  });
});

describe('平曲線操作與加樁', () => {
  const base: AlignmentInput = {
    name: 'A', startStation: 0, interval: 20, minGap: 2,
    extraStations: [{ sta: 35, name: '防砂壩' }, 55],
    ips: [{ name: 'BP', x: 0, y: 0, curve: null }, { name: 'IP1', x: 0, y: 100, curve: { kind: 'R', value: 30 } }, { name: 'EP', x: 100, y: 100, curve: null }],
  };
  it('具名加樁與舊格式數字加樁', () => {
    const al = buildAlignment(base)!;
    expect(al.stakes.find(s => Math.abs(s.sta - 35) < 1e-9)?.label).toBe('防砂壩');
    expect(al.stakes.find(s => Math.abs(s.sta - 55) < 1e-9)?.label).toBe('加樁');
  });
  it('可關閉整樁或曲線樁', () => {
    const noFull = buildAlignment({ ...base, genFull: false })!;
    expect(noFull.stakes.some(s => s.kind === 'full')).toBe(false);
    const noCurve = buildAlignment({ ...base, genCurve: false })!;
    expect(noCurve.stakes.some(s => s.kind === 'BC')).toBe(false);
  });
  it('曲線起訖交換、全部半徑', () => {
    const r = reverseIPs(base.ips);
    expect(r.map(q => q.name)).toEqual(['BP', 'IP1', 'EP']);
    expect(r[0]).toMatchObject({ x: 100, y: 100 });
    expect(r[1].curve?.value).toBe(30);
    expect(setAllRadius(base.ips, 0)[1].curve).toBeNull();
    expect(setAllRadius(base.ips, 50)[1].curve).toEqual({ kind: 'R', value: 50 });
  });
  it('單一坡度模式', () => {
    const al = buildAlignment(base)!;
    const v = effectiveVpis({ vpis: [], pfSimple: { z0: 100, slope: -2 } }, al);
    expect(v).toHaveLength(2);
    expect(v[1].z).toBeCloseTo(100 - 0.02 * al.length, 9);
  });
});

describe('三角網外圍剝除', () => {
  it('只剝外圍細長三角形，內部不挖洞', () => {
    const pts = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push({ x: i * 10, y: j * 10, z: 0 });
    pts.push({ x: 300, y: 50, z: 0 });
    const all = buildTin(pts)!;
    const peeled = buildTin(pts, { peel: { maxEdge: 45, minAngle: 8 } })!;
    expect(all.tri.length / 3).toBeGreaterThan(200);
    expect(peeled.tri.length / 3).toBe(200);
    expect(peeled.sample(55, 55)).toBe(0);
  });
});

describe('翻網格與投影', () => {
  it('翻轉共邊改變內插結果，找最近共邊', () => {
    const P = [{ x: 0, y: 0, z: 10 }, { x: 10, y: -3, z: 0 }, { x: 20, y: 0, z: 10 }, { x: 10, y: 3, z: 0 }];
    const t0 = buildTin(P)!;
    expect(t0.sample(10, 0)).toBeCloseTo(0, 9);       // 原本連 B–D
    const e = nearestSharedEdge(t0, 10, 0)!;
    expect([e[1], e[3]].sort()).toEqual([-3, 3]);
    const t1 = buildTin(P, { flips: [e] })!;
    expect(t1.sample(10, 0)).toBeCloseTo(10, 9);      // 翻成 A–C
  });
  it('平面點投影到中心線求樁號與偏距', () => {
    const al = buildAlignment({ name: 'A', startStation: 100, interval: 20, minGap: 2, extraStations: [], ips: [{ name: 'BP', x: 0, y: 0, curve: null }, { name: 'IP1', x: 0, y: 100, curve: { kind: 'R', value: 30 } }, { name: 'EP', x: 100, y: 100, curve: null }] })!;
    const r = stationOf(al, 5, 40);
    expect(r.sta).toBeCloseTo(140, 4);
    expect(r.offset).toBeCloseTo(5, 4);   // 往北走，右側為東
  });
});

describe('清理與 DXF', () => {
  it('剔除 Z ≤ 0 與高程異常', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ id: i, name: String(i), x: i, y: 0, z: 200 + (i % 7) }));
    pts.push({ id: 90, name: 'a', x: 0, y: 0, z: 0 }, { id: 91, name: 'b', x: 0, y: 0, z: -9999 }, { id: 92, name: 'c', x: 0, y: 0, z: 5000 });
    const r = filterElevationOutliers(pts);
    expect(r.removed).toBe(3);
    expect(r.range).toEqual([198, 208]);
  });
  it('POINT 圖塊屬性 ELEV／PNTS／DESC 與底圖顏色', () => {
    const dxf = [
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '0', 'LAYER', '2', 'AC', '62', '3', '0', 'ENDTAB', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '8', 'PT', '2', 'POINT', '66', '1', '10', '100', '20', '200', '30', '0',
      '0', 'ATTRIB', '8', 'PT', '2', 'PNTS', '1', 'A15', '0', 'ATTRIB', '8', 'PT', '2', 'ELEV', '1', '725.31', '0', 'ATTRIB', '8', 'PT', '2', 'DESC', '1', 'TREE', '0', 'SEQEND',
      '0', 'LWPOLYLINE', '8', 'AC', '90', '2', '70', '0', '38', '720', '10', '0', '20', '0', '10', '10', '20', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const data = parseDxf(dxf);
    const rep = dxfToPoints(data, { layers: new Set(['PT']), usePoints: true, useText: true, usePolylines: true, densify: 0, minDist: 0, textRadius: 3, removeOutliers: false, zRule: { zeroIsNull: true, minZ: -500, maxZ: 9000 } });
    expect(rep.points[0]).toMatchObject({ name: 'A15', z: 725.31, code: 'TREE' });
    const bd = dxfBackdrop(data, new Set(['AC']));
    expect(bd.items[0].c).toBe(aciToColor(3));
    expect(bd.items[0].pts).toEqual([0, 0, 10, 0]);
  });
});
