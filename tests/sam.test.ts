import { describe, it, expect } from 'vitest';
import { parseCode, runSam, samBreaklines, DEFAULT_LEGEND, type SamInputPoint } from '../src/core/sam';
import { buildTin } from '../src/core/tin';

const pts = (list: Array<[string, number, number, string, number?]>): SamInputPoint[] =>
  list.map(([name, x, y, code, z]) => ({ name, x, y, z: z ?? 100, code }));
const run = (list: Array<[string, number, number, string, number?]>) => runSam(pts(list), DEFAULT_LEGEND);
const near = (p: { x: number; y: number }, x: number, y: number) => expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(1e-6);
const allOnCircle = (vs: Array<{ x: number; y: number }>, cx: number, cy: number, r: number) =>
  vs.forEach(v => expect(Math.hypot(v.x - cx, v.y - cy)).toBeCloseTo(r, 6));

describe('代碼解析', () => {
  it('英文碼：共點、樓層、附加部份', () => {
    expect(parseCode('BD1L.BW1S.E').tokens.map(t => t.raw)).toEqual(['BD1L', 'BW1S', 'E']);
    const a = parseCode('IC2O3.5').tokens[0];
    expect(a).toMatchObject({ feature: 'IC', lineNo: '2', ctrl: 'O', extra: '3.5' });
    const b = parseCode('BD1L..3R');
    expect(b.note).toBe('3R');
    expect(b.tokens[0]).toMatchObject({ feature: 'BD', ctrl: 'L' });
    expect(parseCode('Q3G105').tokens[0]).toMatchObject({ feature: 'Q', lineNo: '3', ctrl: 'G', extra: '105' });
    expect(parseCode('BD1D-5-1.5+4.5').tokens[0].extra).toBe('-5-1.5+4.5');
    expect(parseCode('BOO').tokens[0]).toMatchObject({ feature: 'BOO', lineNo: null });
  });
  it('數字碼', () => {
    const t = parseCode('1322.10').tokens;
    expect(t[0]).toMatchObject({ feature: '13', lineNo: '2', ctrl: 'L' });
    expect(t[1]).toMatchObject({ feature: '10', lineNo: null });
    expect(parseCode('1310').tokens[0].ctrl).toBe('S');
  });
});

describe('連線控制碼（手冊範例）', () => {
  it('S/L/C：房屋閉合；同時施測兩條路邊線與電桿', () => {
    const r = run([
      ['101', 0, 0, 'RD1S'], ['102', 0, 10, 'RD2S'], ['103', 20, 0, 'RD1L.E'], ['104', 20, 10, 'RD2L'],
      ['105', 40, 0, 'RD1E'], ['106', 40, 10, 'RD2E'],
      ['201', 0, 20, 'BD1S'], ['202', 10, 20, 'BD1L'], ['203', 10, 30, 'BD1L..2R'], ['204', 0, 30, 'BD1C'],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.symbols).toHaveLength(1);
    const rd = r.lines.filter(l => l.feature === 'RD');
    expect(rd.map(l => l.pts.length)).toEqual([3, 3]);
    const bd = r.lines.find(l => l.feature === 'BD')!;
    expect(bd.closed).toBe(true);
    expect(bd.label).toBe('2R');
    near(bd.labelAt!, 5, 25);
  });
  it('E 之後再出現 L 會重新起線；N 結束所有線形', () => {
    const r = run([['1', 0, 0, 'BD1S'], ['2', 5, 0, 'BD1E'], ['3', 0, 5, 'BD1L'], ['4', 5, 5, 'BD1L'], ['5', 9, 9, 'BW1S'], ['6', 9, 12, 'N']]);
    // N 不是線形代碼，當作未定義獨立物；BD1 第二條在結尾才結束
    expect(r.lines.filter(l => l.feature === 'BD')).toHaveLength(2);
  });
  it('X：終點直角互交第一直線', () => {
    const r = run([['1', 0, 0, 'BD1S'], ['2', 10, 0, 'BD1L'], ['3', 10, 8, 'BD1X']]);
    const l = r.lines[0];
    expect(l.closed).toBe(true);
    expect(l.pts).toHaveLength(4);
    near(l.pts[3], 0, 8);
  });
  it('Z：終點平行交會第一直線', () => {
    const r = run([['1', 0, 0, 'BD1S'], ['2', 10, 2, 'BD1L'], ['3', 10, 8, 'BD1Z']]);
    const q = r.lines[0].pts[3];
    near(q, 0, 8); // 過起點平行終邊（垂直線 x=0）與終點垂線（y=8）交會
  });
  it('D：直角支距加點（無號延長、+ 右轉、− 左轉）', () => {
    const r = run([['1', 0, 0, 'BD1S'], ['2', 10, 0, 'BD1D2+4-10']]);
    const p = r.lines[0].pts;
    near(p[2], 12, 0);   // 延長 2
    near(p[3], 12, -4);  // 行進方向向東，右轉為南
    near(p[4], 22, -4);  // 行進方向向南，左轉為東
  });
  it('M：三點弧；A：三點弧終點', () => {
    const m = run([['1', -10, 0, 'RD1S'], ['2', 0, 10, 'RD1M'], ['3', 10, 0, 'RD1L']]).lines[0];
    allOnCircle(m.pts, 0, 0, 10);
    expect(m.pts.length).toBeGreaterThan(10);
    const a = run([['1', -10, 0, 'RD1S'], ['2', 0, 10, 'RD1L'], ['3', 10, 0, 'RD1A']]).lines[0];
    allOnCircle(a.pts, 0, 0, 10);
    // 三點弧要經過中間點
    expect(a.pts.some(v => Math.hypot(v.x, v.y - 10) < 0.3)).toBe(true);
  });
  it('B：與前段直線相切的弧', () => {
    const l = run([['1', 0, 0, 'RD1S'], ['2', 10, 0, 'RD1L'], ['3', 20, 10, 'RD1B']]).lines[0];
    allOnCircle(l.pts.slice(1), 10, 10, 10);
  });
  it('F：三點測設圓形駁坎並閉合', () => {
    const l = run([['351', 10, 0, 'GS1S'], ['352', 0, 10, 'GS1M'], ['353', -10, 0, 'GS1F']]).lines[0];
    expect(l.closed).toBe(true);
    allOnCircle(l.pts, 0, 0, 10);
    // 弧長涵蓋整圈
    const ys = l.pts.map(v => v.y);
    expect(Math.min(...ys)).toBeLessThan(-9.9);
  });
  it('T：分叉點與前一點連線，主線跳過', () => {
    const r = run([['1', 0, 0, 'BW1S'], ['2', 10, 0, 'BW1L'], ['3', 10, 5, 'BW1T'], ['4', 20, 0, 'BW1L']]);
    const main = r.lines.find(l => !l.branch)!, br = r.lines.find(l => l.branch)!;
    expect(main.pts.map(v => v.src)).toEqual(['1', '2', '4']);
    expect(br.pts.map(v => v.src)).toEqual(['2', '3']);
  });
  it('G：連接到其他點號；O：圓心加半徑', () => {
    const r = run([['105', 5, 5, 'BD1S'], ['210', 0, 0, 'Q3S'], ['212', 5, 0, 'Q3G105'], ['300', 50, 50, 'IC2O3.5'], ['301', 0, 0, 'Q4G999']]);
    const q = r.lines.find(l => l.feature === 'Q' && l.lineNo === '3')!;
    expect(q.pts.map(v => v.src)).toEqual(['210', '212', '105']);
    expect(r.circles[0]).toMatchObject({ r: 3.5, feature: 'IC' });
    expect(r.errors.some(e => e.msg.includes('999'))).toBe(true);
  });
  it('數字碼與英文碼結果一致', () => {
    const r = run([['1', 0, 0, '1310'], ['2', 10, 0, '1312.10'], ['3', 20, 0, '131E']]);
    expect(r.lines[0].feature).toBe('RD');
    expect(r.lines[0].pts).toHaveLength(3);
    expect(r.symbols[0].feature).toBe('E');
  });
});

describe('斷線', () => {
  it('斷線強制三角形邊，影響內插高程', () => {
    // 菱形：一般三角網會連短對角線 B–D；斷線 A–C 強制改連長對角線
    const P = [{ x: 0, y: 0, z: 10 }, { x: 10, y: -3, z: 0 }, { x: 20, y: 0, z: 10 }, { x: 10, y: 3, z: 0 }];
    expect(buildTin(P)!.sample(10, 0)).toBeCloseTo(0, 9);
    const t = buildTin(P, { breaklines: [[P[0], P[2]]] })!;
    expect(t.nBreakEdges).toBe(1);
    expect(t.sample(10, 0)).toBeCloseTo(10, 9);
  });
  it('由連線結果取出斷線（只用有高程的原始測點）', () => {
    const r = run([['1', 0, 0, 'RD1S', 50], ['2', 10, 0, 'RD1L', 51], ['3', 20, 10, 'RD1B', 52], ['4', 0, 20, 'BD1S'], ['5', 5, 20, 'BD1L']]);
    const b = samBreaklines(r, DEFAULT_LEGEND);
    expect(b).toHaveLength(1); // 房屋不是斷線
    expect(b[0].map(p => p.z)).toEqual([50, 51, 52]);
  });
});
