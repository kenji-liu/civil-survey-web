import { describe, it, expect } from 'vitest';
import { parsePointText } from '../src/io/csv';
import { parseDxf, dxfToPoints, numberInText, cleanText, decodeDxf, type DxfImportOptions } from '../src/io/dxf-read';
import { DxfWriter } from '../src/io/dxf-write';

const rule = { zeroIsNull: true, minZ: -500, maxZ: 9000 };

describe('CSV', () => {
  it('欄位順序、標題列、無效高程', () => {
    const txt = '點號,E,N,Z\nA1,243690.52,2687326.91,702.35\nA2,243653.24,2687311.33,0\nA3 243648.40 2687312.59 -9999 TREE\n';
    const r = parsePointText(txt, 'PENZ', rule);
    expect(r.points).toHaveLength(3);
    expect(r.skippedLines).toBe(1);
    expect(r.points[0]).toMatchObject({ name: 'A1', x: 243690.52, y: 2687326.91, z: 702.35 });
    expect(r.points[1].z).toBeNull();
    expect(r.points[2].z).toBeNull();
    expect(r.points[2].code).toBe('TREE');
    const r2 = parsePointText('1,2687326.91,243690.52,702', 'PNEZ', rule);
    expect(r2.points[0].x).toBe(243690.52);
  });
});

describe('DXF', () => {
  it('文字高程判讀', () => {
    expect(numberInText('702.35')).toBe(702.35);
    expect(numberInText('▲702.35')).toBe(702.35);
    expect(numberInText('第3號擋土牆')).toBeNull();
    expect(cleanText('{\\fArial|b0;\\U+9AD8\\U+7A0B}')).toBe('高程');
  });

  it('寫出後讀回：等高線、點、文字', () => {
    const w = new DxfWriter().layer('CONT1', 3).layer('POINTS', 2);
    w.polyline('CONT1', [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 140, y: 110 }], false, 700);
    w.point('POINTS', 110, 130, 703.2);
    w.point('POINTS', 0, 0, 0);          // 飛點，且無高程
    w.point('POINTS', 115, 140, 0);      // 無高程點，旁邊有高程文字
    w.text('POINTS', 115.5, 140.3, 0.5, '704.10');
    w.polyline3d('BRK', [{ x: 100, y: 120, z: 701 }, { x: 140, y: 125, z: 702 }]);
    const { text, encoding } = decodeDxf(new TextEncoder().encode(w.toString()).buffer as ArrayBuffer);
    const data = parseDxf(text, encoding);
    expect(data.version).toBe('AC1009');
    expect([...data.layers.keys()].sort()).toEqual(['BRK', 'CONT1', 'POINTS']);
    const opts: DxfImportOptions = { layers: new Set(data.layers.keys()), usePoints: true, useText: true, usePolylines: true, densify: 5, minDist: 0.1, textRadius: 2, removeOutliers: true, zRule: rule };
    const rep = dxfToPoints(data, opts);
    // 等高線 3 頂點 + 加密（20m→3 點、22.36m→3 點），3D 線 2 頂點 + 加密（40.31m→7 點）
    expect(rep.fromLines).toBe(3 + 3 + 3 + 2 + 7);
    const p = rep.points.find(q => Math.abs(q.x - 115) < 1e-9 && Math.abs(q.y - 140) < 1e-9);
    expect(p?.z).toBeCloseTo(704.1);
    expect(rep.points.some(q => q.x === 0 && q.y === 0)).toBe(false);
    expect(rep.points.filter(q => q.z !== null).every(q => q.z! >= 700 && q.z! <= 705)).toBe(true);
  });

  it('Big5 編碼的舊版 DXF', () => {
    // 「高程」的 Big5 為 B0AA B57B
    const head = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$DWGCODEPAGE\n3\nANSI_950\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\n';
    const tail = '\n10\n1.0\n20\n2.0\n30\n0.0\n1\n100.5\n0\nENDSEC\n0\nEOF\n';
    const enc = new TextEncoder();
    const bytes = new Uint8Array([...enc.encode(head), 0xb0, 0xaa, 0xb5, 0x7b, ...enc.encode(tail)]);
    const { text, encoding } = decodeDxf(bytes.buffer);
    expect(encoding).toBe('big5');
    const data = parseDxf(text, encoding);
    expect([...data.layers.keys()]).toEqual(['高程']);
  });
});
