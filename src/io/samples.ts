// 範例教學用的練習檔：由示範專案產生，內容和教學中的預期結果一致
import { demoProject } from '../store/demo';
import { computeDerived } from '../store/derived';
import { to3DF } from '../core/survey';
import { toCsv } from './csv';
import { DxfWriter } from './dxf-write';
import { buildTin, traceContours } from '../core/tin';
import { computeTraverse } from '../core/traverse';
import { computeLeveling } from '../core/leveling';
import { computeSurvey } from '../core/survey';
import { gridEarthwork, flatSurface } from '../core/earthwork-grid';
import { dmsToDeg, degToDmsNumber } from '../core/units';

export interface SampleFile { name: string; desc: string; mime: string; make(): string }

const fix = (v: number, d = 3) => v.toFixed(d);

export const SAMPLE_FILES: SampleFile[] = [
  {
    name: '範例1_測點.csv',
    desc: '點號、E、N、Z、代碼。最後 3 列故意放了高程 0、-9999 與空白，練習高程檢查。',
    mime: 'text/csv;charset=utf-8',
    make() {
      const p = demoProject();
      const rows: Array<Array<string | number>> = [['點號', 'E', 'N', 'Z', '代碼']];
      p.points.filter(q => q.code === 'GND').forEach(q => rows.push([q.name, fix(q.x), fix(q.y), q.z === null ? '' : fix(q.z), 'GND']));
      rows.push(['X1', '243210.000', '2687040.000', '0', 'BAD'], ['X2', '243230.000', '2687060.000', '-9999', 'BAD'], ['X3', '243250.000', '2687080.000', '', 'BAD']);
      return toCsv(rows);
    },
  },
  {
    name: '範例2_地形等高線.dxf',
    desc: 'AutoCAD R12：首曲線、計曲線、高程點（點位 Z=0、旁邊有高程文字）與從 (0,0) 起畫的圖框，練習 DXF 匯入的圖層挑選與飛點剔除。',
    mime: 'application/dxf',
    make() {
      const p = demoProject();
      const valid = p.points.filter(q => q.z !== null && q.code === 'GND').map(q => ({ x: q.x, y: q.y, z: q.z as number }));
      const tin = buildTin(valid, { boundary: p.boundary })!;
      const w = new DxfWriter().layer('CONT1', 33).layer('CONT5', 30).layer('SPOT', 7).layer('FRAME', 8);
      for (const l of traceContours(tin, 1, 5)) w.polyline(l.major ? 'CONT5' : 'CONT1', l.pts, l.closed, l.level);
      // 高程點：點位本身 Z=0（常見的舊圖畫法），高程寫在旁邊的文字
      valid.filter((_, i) => i % 23 === 0).forEach(q => { w.point('SPOT', q.x, q.y, 0); w.text('SPOT', q.x + 0.6, q.y + 0.3, 1.2, q.z.toFixed(2)); });
      w.polyline('FRAME', [{ x: 0, y: 0 }, { x: 243500, y: 0 }, { x: 243500, y: 2687400 }, { x: 0, y: 2687400 }], true, 0);
      w.text('FRAME', 243010, 2687390, 4, '範例地形圖 1/500');
      return w.toString();
    },
  },
  {
    name: '範例3_控制點.csv',
    desc: '四個已知控制點 K1～K4（點號、E、N、Z），觀測手簿、導線、水準都會用到。',
    mime: 'text/csv;charset=utf-8',
    make() {
      return toCsv([['點號', 'E', 'N', 'Z'], ...demoProject().controls.map(c => [c.name, fix(c.x, 4), fix(c.y, 4), c.z === null ? '' : fix(c.z, 4)])]);
    },
  },
  {
    name: '範例4_外業觀測.3df',
    desc: '兩個測站：K1 後視 K2 觀測 10 個碎部點與轉站點 T1，再由 T1 後視 K1 觀測 6 點（斜距＋天頂距）。',
    mime: 'text/plain;charset=utf-8',
    make() { return to3DF(demoProject().stations); },
  },
  {
    name: '範例5_連線碼測點.csv',
    desc: '帶自動連線代碼的外業測點：溪流水線、兩條路邊線、兩棟房屋（含 X 碼與樓層）、圍牆、電桿、樹、消防栓、圓形花圃。',
    mime: 'text/csv;charset=utf-8',
    make() {
      const p = demoProject();
      const rows: Array<Array<string | number>> = [['點號', 'E', 'N', 'Z', '代碼']];
      p.points.filter(q => q.code && q.code !== 'GND' && q.code !== 'NOZ').forEach(q => rows.push([q.name, fix(q.x), fix(q.y), q.z === null ? '' : fix(q.z), q.code!]));
      return toCsv(rows);
    },
  },
  {
    name: '範例6_水準手簿.txt',
    desc: '沿中心線的直接水準（Tab 分隔，可整塊複製貼到水準表格）：點號、後視、中間視、前視、距離。',
    mime: 'text/plain;charset=utf-8',
    make() {
      const p = demoProject();
      const s = (v: number | null) => (v === null ? '' : String(v));
      return ['點號\t後視\t中間視\t前視\t距離', ...p.level.rows.map(r => [r.name, s(r.bs), s(r.is), s(r.fs), s(r.dist)].join('\t'))].join('\r\n') + '\r\n';
    },
  },
];

/** 教學中「應該看到的結果」：直接由示範資料計算，保證和程式一致 */
export function demoExpectations() {
  const p = demoProject();
  const d = computeDerived(p);
  const last = d.volumes[d.volumes.length - 1];
  const trav = computeTraverse(p.traverse, p.controls);
  const lev = computeLeveling(p.level);
  const sv = computeSurvey(p.stations, p.controls);
  const grid = d.tin && p.boundary ? gridEarthwork(p.boundary, p.grid.cell, d.tin.sample, flatSurface(p.grid.designZ)) : null;
  const t1 = p.traverse.rows.find(r => r.name === 'T1')?.angle ?? '0';
  return {
    travT1: t1,
    travT1Plus20: degToDmsNumber(dmsToDeg(t1) + 20 / 3600),
    travAngle: trav.fAngleSec ?? 0,
    travF: trav.f ?? 0,
    travPrecision: trav.precision ?? 0,
    levF: lev.f ?? 0,
    levAllowed: lev.allowed ?? 0,
    surveyPts: sv.points.length,
    gridCut: grid?.cut ?? 0,
    gridFill: grid?.fill ?? 0,
    gridZ: p.grid.designZ,
    points: p.points.length,
    nullPts: d.nullCount,
    tri: d.tin ? d.tin.tri.length / 3 : 0,
    zMin: d.tin?.minZ ?? 0,
    zMax: d.tin?.maxZ ?? 0,
    alLength: d.alignment?.length ?? 0,
    curves: d.alignment?.curves.length ?? 0,
    stakes: d.alignment?.stakes.length ?? 0,
    cut: last?.cumCut ?? 0,
    fill: last?.cumFill ?? 0,
    samLines: d.sam?.lines.length ?? 0,
    samSymbols: d.sam?.symbols.length ?? 0,
    breakEdges: d.tin?.nBreakEdges ?? 0,
  };
}
