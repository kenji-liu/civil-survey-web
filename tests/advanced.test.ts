import { describe, it, expect } from 'vitest';
import { evaluate, checkSyntax, lookup, parseAssignments } from '../src/core/expr';
import { designSectionAdv, DEFAULT_ADVANCED, simpleToAdvanced, type AdvancedTemplate } from '../src/core/section-adv';
import { designSection, type SectionTemplate } from '../src/core/section';

const env = { vars: { CH: 2.5, LX: 4, LY: 100, 路寬: 3.5 } };

describe('運算式', () => {
  it('四則、次方、優先順序、比較與邏輯', () => {
    expect(evaluate('1 + 2 * 3 ^ 2', env)).toBe(19);
    expect(evaluate('-(2+3)*2', env)).toBe(-10);
    expect(evaluate('CH*1.5 + lx', env)).toBe(7.75);
    expect(evaluate('路寬 * 2', env)).toBe(7);
    expect(evaluate('CH>2 AND LX<=4', env)).toBe(1);
    expect(evaluate('NOT (CH>3) OR 0', env)).toBe(1);
    expect(evaluate('IF(CH>3, 1, 2)', env)).toBe(2);
    expect(evaluate('MAX(1, 5, 3) + MIN(4,2) + ROUND(1.2345, 2) + ABS(-1)', env)).toBeCloseTo(9.23, 9);
    expect(evaluate('SIN(30) + COS(60) + SQRT(16)', env)).toBeCloseTo(5, 12);
    expect(evaluate('', env, 7)).toBe(7);
  });
  it('錯誤訊息', () => {
    expect(() => evaluate('XX + 1', env)).toThrow('未定義的變數 XX');
    expect(() => evaluate('1/0', env)).toThrow('除以 0');
    expect(checkSyntax('1 + * 2')).not.toBeNull();
    expect(checkSyntax('MAX(1,2')).toContain('缺少');
    expect(checkSyntax('W=1')).toBeNull(); // 等號也是比較運算子
  });
  it('查表 IN（內插）與 TAB（層階）', () => {
    const rows = [{ k: 0, v: 3 }, { k: 100, v: 4 }, { k: 200, v: 6 }];
    expect(lookup('IN', rows, 50)).toBe(3.5);
    expect(lookup('IN', rows, 500)).toBe(6);
    expect(lookup('TAB', rows, 150)).toBe(4);
    expect(lookup('TAB', rows, -5)).toBe(3);
    const e = { vars: { ST: 150 }, table: (k: 'IN' | 'TAB', _n: string, key: number) => lookup(k, rows, key) };
    expect(evaluate('IN(路寬表, ST)', e)).toBe(5);
    expect(evaluate('TAB("路寬表", ST)', e)).toBe(4);
  });
  it('參數設定字串', () => {
    expect(parseAssignments('W=0.6; h = MAX(1, LY-EH(LX+0.4))')).toEqual({ W: '0.6', H: 'MAX(1, LY-EH(LX+0.4))' });
  });
});

const t: SectionTemplate = { widthL: 3, widthR: 3, crossfall: 0, cutSlope: 1, fillSlope: 1.5, ditchWidth: 0, ditchDepth: 0 };
const flat = (z: number) => Array.from({ length: 81 }, (_, i) => ({ o: -40 + i, z }));

describe('進階組合斷面', () => {
  it('沒有構造物時與簡易斷面相同', () => {
    const adv: AdvancedTemplate = { ...DEFAULT_ADVANCED, enabled: true, items: [] };
    const g = Array.from({ length: 81 }, (_, i) => ({ o: -40 + i, z: 100 + 0.15 * (-40 + i) }));
    const a = designSectionAdv(g, 100, 0, t, adv);
    const b = designSection(g, 100, t);
    expect(a.cutArea).toBeCloseTo(b.cutArea, 9);
    expect(a.fillArea).toBeCloseTo(b.fillArea, 9);
  });
  it('U 形側溝：挖方側才設（條件 GH>LY），並計算混凝土面積', () => {
    const adv: AdvancedTemplate = { ...DEFAULT_ADVANCED, enabled: true, items: [{ side: 'B', unit: 'DITCH', cond: 'GH>LY', params: 'W=0.5; H=0.6; T=0.15' }] };
    const g = Array.from({ length: 81 }, (_, i) => ({ o: -40 + i, z: 100 + 0.2 * (-40 + i) })); // 右高左低 → 右挖左填
    const r = designSectionAdv(g, 100, 0, t, adv);
    expect(r.errors).toEqual([]);
    expect(r.solids).toHaveLength(1);
    expect(r.solids[0].side).toBe('R');
    // U 形：外框 0.8×0.75 − 內空 0.5×0.6 = 0.6 − 0.3 = 0.3 m²
    expect(r.solids[0].area).toBeCloseTo(0.3, 9);
    // 溝底在路面邊緣下 0.6 m
    expect(r.design.some(p => Math.abs(p.o - 3.15) < 1e-9 && Math.abs(p.z - 99.4) < 1e-9)).toBe(true);
  });
  it('擋土牆高度用 EH 自動算到地面，平地填方', () => {
    // 地面 97、設計 100：牆高 = LY − EH(LX+0.4) = 3
    const adv: AdvancedTemplate = { ...DEFAULT_ADVANCED, enabled: true, items: [{ side: 'R', unit: 'WALL', cond: 'LY-EH(LX+0.4)>1.5', params: 'H=LY-EH(LX+0.4); B=0.4; N=0.3' }] };
    const r = designSectionAdv(flat(97), 100, 0, t, adv);
    expect(r.errors).toEqual([]);
    const wall = r.solids[0];
    // 梯形：頂 0.4、底 0.4+0.9=1.3、高 3 → 2.55 m²
    expect(wall.area).toBeCloseTo(2.55, 9);
    // 右側牆趾就在地面上，不再放坡
    expect(r.right.daylight!.o).toBeCloseTo(3 + 0.4 + 0.9, 9);
    expect(r.right.daylight!.z).toBeCloseTo(97, 9);
    // 左側一般填方邊坡 1:1.5：接地點在 3 + 4.5
    expect(r.left.daylight!.o).toBeCloseTo(-7.5, 9);
  });
  it('邊坡平台：每升 2 m 設 1.5 m 平台', () => {
    const adv: AdvancedTemplate = { ...DEFAULT_ADVANCED, enabled: true, items: [], bermEvery: 2, bermWidth: 1.5 };
    const r = designSectionAdv(flat(105), 100, 0, t, adv); // 挖 5 m，邊坡 1:1
    // 右側：2 m 坡 → 1.5 m 平台 → 2 m 坡 → 1.5 m 平台 → 1 m 坡接地
    expect(r.right.daylight!.o).toBeCloseTo(3 + 2 + 1.5 + 2 + 1.5 + 1, 9);
    expect(r.right.daylight!.z).toBeCloseTo(105, 9);
  });
  it('查表與運算式錯誤會回報，不中斷其他構造物', () => {
    const adv: AdvancedTemplate = { ...DEFAULT_ADVANCED, enabled: true, items: [
      { side: 'R', unit: 'SHOULDER', cond: '', params: 'W=IN(路肩寬, ST)' },
      { side: 'R', unit: 'CURB', cond: 'XX>0', params: '' },
    ], tables: [{ name: '路肩寬', kind: 'IN', data: '0:1, 100:2' }] };
    const r = designSectionAdv(flat(100), 100, 50, t, adv);
    expect(r.design.some(p => Math.abs(p.o - 4.5) < 1e-9)).toBe(true); // 路肩寬內插為 1.5
    expect(r.errors.some(e => e.includes('XX'))).toBe(true);
  });
  it('簡易斷面可轉成進階組合', () => {
    const a = simpleToAdvanced({ ...t, ditchWidth: 0.6, ditchDepth: 0.4 });
    expect(a.items[0]).toMatchObject({ unit: 'DITCH', cond: 'GH>LY' });
  });
});
