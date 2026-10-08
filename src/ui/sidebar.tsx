// 左側面板（v3.4 版面）：1 匯入DXF、2 平曲線/加樁、3 圖層/等高線、4 縱橫斷與土方
import { useMemo, useState } from 'react';
import type { Project } from '../core/model';
import { isValidZ, PF_ROWS } from '../core/model';
import type { Derived } from '../store/derived';
import type { GridResult } from '../core/earthwork-grid';
import { gridEarthwork, flatSurface, slopedSurface } from '../core/earthwork-grid';
import { polygonCentroid } from '../core/geom';
import { DEG, degToDmsText, formatStation, fmtThousands } from '../core/units';
import { extraOf, stationOf, type AlignmentInput } from '../core/alignment';
import { checkProfileSpec, fmtGrade, type OtherLine } from '../core/profile';
import { filterElevationOutliers } from '../core/cleanup';
import { update, patch, replaceProject } from '../store/store';
import { demoProject } from '../store/demo';
import * as A from '../store/actions';
import { COLUMN_ORDER_LABEL, type ColumnOrder } from '../io/csv';
import { curveCsv, stakeCsv, volumeCsv, pointsCsv, gridCsv } from '../io/exports';
import { Card, NumField, TextField, Check, Btn, Kpi, Note, download, stamp, safeName } from './common';
import { CoordTable, DeflTable, CellNum, convexHull } from './panels';
import { RoadwayCard, AdvancedCard } from './design-ui';
import { SamPanel } from './sam-ui';
import type { Tool, Layers } from './PlanView';

export type ViewMode = '2D' | 'PROFILE' | 'CROSS' | '3D' | 'SHEETS';

export interface ImportOpts { removeOutliers: boolean; densify: boolean; step: number; csvOrder: ColumnOrder; keepBackdrop: boolean }

export interface SideCtx {
  p: Project;
  d: Derived;
  tool: Tool; setTool(t: Tool): void;
  layers: Layers; setLayers(l: Layers): void;
  grid: GridResult | null; setGrid(g: GridResult | null): void;
  selectedSta: number | null; setSelectedSta(s: number | null): void;
  status(msg: string, tone?: 'ok' | 'warn'): void;
  refit(): void;
  openFile(): void;
  importFile(f: File): void;
  diag: string | null;
  importOpts: ImportOpts; setImportOpts(o: ImportOpts): void;
  highlight: number | null; focusPoint(id: number): void;
  setView(v: ViewMode): void;
  setCrossMode(m: 'GRID' | 'SINGLE'): void;
  defaultR: number; setDefaultR(r: number): void;
  staName: string; setStaName(s: string): void;
  showIpTable(): void;
  openDrawer(m: 'legend' | 'adv' | null): void;
  newPointZ: number; setNewPointZ(z: number): void;
}

const f2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(d));

// ======================== 1. 匯入 DXF ========================
export function Tab1Import(c: SideCtx) {
  const { p, d, importOpts: o, setImportOpts: setO } = c;
  const [over, setOver] = useState(false);
  const zr = p.zRule;
  const excludeZero = zr.zeroIsNull && zr.minZ > 0;
  const list = useMemo(() => p.points.slice(0, 1500), [p.points]);
  return (
    <>
      <Card title="📂 匯入 AutoCAD (.DXF) 或座標點檔 (.CSV)" extra={<span className="badge">支援 POINT 圖塊屬性</span>}>
        <label className={`drop-zone ${over ? 'over' : ''}`}
          onClick={e => { e.preventDefault(); c.openFile(); }}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) c.importFile(f); }}>
          <b>📂 點擊此處選擇 AutoCAD (.DXF) 或 .CSV／.TXT 檔，或直接拖曳進來</b>
          <span className="hint">支援 POINT 圖塊高程屬性（ELEV／PNTS／DESC）、等高線圖層（AC、IDX…），並自動剔除 Z = -9999 無高程點；Big5 舊檔自動判斷。</span>
        </label>
        {c.diag && <div className="diag">{c.diag}</div>}
        <div className="btn-grid">
          <Btn kind="primary" onClick={c.refit}>🎯 飛回地形主區 (F)</Btn>
          <Btn kind="accent" onClick={() => {
            const r = filterElevationOutliers(p.points);
            if (!r.removed) { c.status('沒有發現 Z ≤ 0 或異常高程的點'); return; }
            update(q => ({ ...q, points: r.kept, zRule: r.range ? { ...q.zRule, minZ: r.range[0], maxZ: r.range[1] } : q.zRule }));
            c.refit();
            c.status(`🧹 已濾除 ${r.removed} 個 Z ≤ 0 或異常高程點，保留 ${r.kept.length} 點（Ctrl+Z 可復原）`, 'ok');
          }}>🧹 濾除異常高程點</Btn>
          <Btn onClick={() => { update(q => ({ ...q, points: q.points.map(t => ({ ...t, x: t.y, y: t.x })) })); c.refit(); c.status('⇄ 已對調所有測點的 E／N 座標'); }}>⇄ E/N 座標對調</Btn>
          <Btn onClick={() => { replaceProject(demoProject()); c.setGrid(null); c.refit(); c.status('⛰ 已載入示範河道地形與中心線', 'ok'); }}>⛰ 載入示範河道地形</Btn>
        </div>
      </Card>
      <Card title="⚙️ DXF 智慧高程過濾與加密設定">
        <Check id="o-zero" label="排除 Z ≤ 0 及 Z = -9999 無高程懸測點／圖框" checked={excludeZero}
          onChange={v => patch('zRule', v ? { ...zr, zeroIsNull: true, minZ: Math.max(zr.minZ, 0.001) } : { ...zr, zeroIsNull: false, minZ: Math.min(zr.minZ, -500) })} />
        <Check id="o-out" label="自動剔除偏離主地形之異常點（含 0,0 與圖框）" checked={o.removeOutliers} onChange={v => setO({ ...o, removeOutliers: v })} />
        <Check id="o-den" label="沿 3D 等高線固定間距自動加密補點" checked={o.densify} onChange={v => setO({ ...o, densify: v })} />
        <Check id="o-bd" label="保留原 DXF 線條當彩色底圖" checked={o.keepBackdrop} onChange={v => setO({ ...o, keepBackdrop: v })} />
        <NumField id="o-step" label="加密補點間距 (m)" value={o.step} min={0.5} onChange={v => setO({ ...o, step: v })} disabled={!o.densify} />
        <div className="field">
          <span className="field-label">有效高程範圍 Z (m)</span>
          <span className="row">
            <CellNum value={zr.minZ} onChange={v => patch('zRule', { ...zr, minZ: v })} />
            <span className="muted">~</span>
            <CellNum value={zr.maxZ} onChange={v => patch('zRule', { ...zr, maxZ: v })} />
          </span>
        </div>
        <label className="field" htmlFor="o-csv">
          <span className="field-label">CSV 欄位順序</span>
          <select id="o-csv" value={o.csvOrder} onChange={e => setO({ ...o, csvOrder: e.target.value as ColumnOrder })} style={{ width: 170 }}>
            {Object.entries(COLUMN_ORDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {p.backdrop && <div className="row"><span className="hint" style={{ flex: 1 }}>底圖 {p.backdrop.length} 條線</span><Btn kind="ghost" onClick={() => patch('backdrop', null)}>移除底圖</Btn></div>}
      </Card>
      <Card title="📍 實測地形高程展點表（點擊單列可定位）" extra={<span className="badge">{p.points.length} 點</span>}>
        <div className="table-wrap short">
          <table className="tbl">
            <thead><tr><th>點號</th><th>E (橫座標 X)</th><th>N (縱座標 Y)</th><th>Z (高程)</th><th>代碼</th></tr></thead>
            <tbody>
              {list.map(t => {
                const ok = isValidZ(t.z, p.zRule);
                return (
                  <tr key={t.id} className={t.id === c.highlight ? 'sel' : ''} onClick={() => c.focusPoint(t.id)}>
                    <td>{t.name}</td><td>{t.x.toFixed(2)}</td><td>{t.y.toFixed(2)}</td>
                    <td className={ok ? 'accent' : 'bad'}>{ok ? (t.z as number).toFixed(2) : '無高程'}</td><td className="muted">{t.code ?? ''}</td>
                  </tr>
                );
              })}
              {!p.points.length && <tr><td colSpan={5}>尚無測點</td></tr>}
            </tbody>
          </table>
        </div>
        {p.points.length > 1500 && <p className="hint">表格只列前 1,500 點；全部測點都已用於建網。</p>}
        <div className="kpis">
          <Kpi label="有效高程" value={String(d.validCount)} tone="ok" />
          <Kpi label="無高程（不建網）" value={String(d.nullCount)} tone={d.nullCount ? 'warn' : undefined} />
        </div>
        <div className="btn-grid">
          <Btn active={c.tool === 'addpt'} onClick={() => { c.setView('2D'); c.setTool(c.tool === 'addpt' ? 'pan' : 'addpt'); }}>➕ 補高程點</Btn>
          <Btn kind="danger" disabled={!d.nullCount} onClick={() => { update(q => ({ ...q, points: q.points.filter(t => isValidZ(t.z, q.zRule)) })); c.status(`已刪除 ${d.nullCount} 個無高程點`); }}>刪除無高程點</Btn>
        </div>
        {c.tool === 'addpt' && <NumField id="np-z" label="補點高程 Z（0 = 取三角網高程）" value={c.newPointZ} unit="m" onChange={c.setNewPointZ} />}
        <Btn disabled={!p.points.length} onClick={() => download(`${safeName(p.info.name)}_測點_${stamp()}.csv`, pointsCsv(p), 'text/csv;charset=utf-8')}>📥 匯出展點 (.CSV)</Btn>
      </Card>
    </>
  );
}

// ======================== 2. 平曲線 / 加樁 ========================
const emptyAl = (): AlignmentInput => ({ name: 'A', startStation: 0, interval: 20, minGap: 2, extraStations: [], ips: [] });

export function Tab2Align(c: SideCtx) {
  const { p, d } = c;
  const al = p.alignment ?? emptyAl();
  const setAl = (v: Partial<AlignmentInput>) => patch('alignment', { ...al, ...v });
  const [sta, setSta] = useState('');
  const [method, setMethod] = useState<'coord' | 'defl'>('coord');
  const W = p.template.widthL + p.template.widthR;
  const extras = al.extraStations.map(extraOf);
  const curves = d.alignment?.curves ?? [];
  return (
    <>
      <Card title="🛣️ 中心線定線與圖面加樁工具" extra={<span className="badge">{al.ips.length} IP</span>}>
        <div className="btn-grid">
          <Btn kind="accent" active={c.tool === 'axis'} onClick={() => { c.setView('2D'); c.setTool(c.tool === 'axis' ? 'pan' : 'axis'); }}>📏 圖面點繪中心線</Btn>
          <Btn active={c.tool === 'addsta'} onClick={() => { c.setView('2D'); c.setTool(c.tool === 'addsta' ? 'pan' : 'addsta'); }}>📍 圖面點擊加樁號</Btn>
        </div>
        <NumField id="a-r" label="點繪新 IP 預設圓曲線半徑 R (m)" value={c.defaultR} min={0} onChange={c.setDefaultR} />
        <div className="btn-grid">
          <Btn onClick={() => c.status(A.setAllIpRadius(0))}>📐 全部設為折點 (R=0)</Btn>
          <Btn onClick={() => c.status(A.setAllIpRadius(c.defaultR))}>🔄 套用預設半徑 R</Btn>
          <Btn onClick={() => c.status(A.reverseAlignment(p, d))}>⇄ 曲線起訖點交換</Btn>
          <Btn onClick={c.showIpTable}>📋 召回圖面曲線表</Btn>
        </div>
        <p className="hint">「✋ 平移/改IP」模式下可直接在圖上拖曳 IP 點改線。</p>
      </Card>
      <Card title="📐 里程樁號與路寬／河寬設定">
        <NumField id="a-s0" label="起點 (BP) 起始樁號 (m, 0=0K+000)" value={al.startStation} onChange={v => setAl({ startStation: v })} />
        <NumField id="a-w" label="路寬／河道設計寬度 W (m)" value={W} min={0.5} onChange={v => patch('template', { ...p.template, widthL: v / 2, widthR: v / 2 })} />
        <NumField id="a-int" label="整樁單距 (m, 公路20/水利50/水保20)" value={al.interval} min={1} onChange={v => setAl({ interval: v })} />
        <NumField id="a-gap" label="單距小於 [?] m 之整樁自動省略" value={al.minGap} min={0} onChange={v => setAl({ minGap: v })} />
        <div className="chk-grid">
          <Check id="a-gf" label="縱斷建立整樁" checked={al.genFull !== false} onChange={v => setAl({ genFull: v })} />
          <Check id="a-gc" label="縱斷建立曲線樁" checked={al.genCurve !== false} onChange={v => setAl({ genCurve: v })} />
        </div>
        <p className="hint">📍 自行加樁號（也可用上方「圖面點擊加樁號」直接在圖上點）：</p>
        <div className="row">
          <input className="tinput" style={{ width: 90 }} type="text" inputMode="decimal" placeholder="里程(如35.5)" value={sta} onChange={e => setSta(e.target.value)} aria-label="加樁里程" />
          <input className="tinput" list="sta-names" type="text" placeholder="點名(如防砂壩)" value={c.staName} onChange={e => c.setStaName(e.target.value)} aria-label="加樁點名" />
          <datalist id="sta-names"><option value="防砂壩" /><option value="固床工" /><option value="構造物" /><option value="加樁" /></datalist>
          <Btn kind="accent" onClick={() => { c.status(A.addCustomStation(Number(sta), c.staName)); setSta(''); }}>加入</Btn>
          <Btn onClick={A.clearCustomStations}>清空</Btn>
        </div>
        {extras.length > 0 && (
          <div className="table-wrap short">
            <table className="tbl"><tbody>
              {extras.map((e, i) => <tr key={i}><td>{e.name}</td><td>{formatStation(e.sta)}</td><td><button type="button" className="x" aria-label="刪除加樁" onClick={() => A.removeCustomStation(i)}>✕</button></td></tr>)}
            </tbody></table>
          </div>
        )}
      </Card>
      <Card title="📋 平曲線 IP 要素表（可直接改半徑 R，0=折點）">
        <div className="table-wrap">
          <table className="tbl edit">
            <thead><tr><th>IP點</th><th>半徑 R</th><th>緩和 Ls</th><th>偏角 θ</th><th>切線 TL</th><th>曲線 CL</th><th>矢距 SL</th><th>BC 樁號</th><th>MC 樁號</th><th>EC 樁號</th></tr></thead>
            <tbody>
              {al.ips.map((ip, i) => {
                const cv = curves.find(k => k.ipIndex === i);
                const end = i === 0 || i === al.ips.length - 1;
                const setIp = (v: Partial<typeof ip>) => setAl({ ips: al.ips.map((q, k) => (k === i ? { ...q, ...v } : q)) });
                return (
                  <tr key={i}>
                    <td style={{ color: 'var(--cyan)' }}>{ip.name}</td>
                    <td>{end ? '—' : <CellNum value={ip.curve?.kind === 'R' ? ip.curve.value : cv ? +cv.R.toFixed(3) : 0} onChange={v => setIp({ curve: v > 0 ? { kind: 'R', value: v } : null })} />}</td>
                    <td>{end || !ip.curve ? '—' : <CellNum value={ip.ls ?? 0} onChange={v => setIp({ ls: v > 0 ? v : 0 })} />}</td>
                    <td>{cv ? `${cv.delta >= 0 ? '右' : '左'}${degToDmsText(Math.abs(cv.delta) / DEG)}` : '—'}</td>
                    <td>{f2(cv?.T, 3)}</td><td>{f2(cv?.L, 3)}</td><td>{f2(cv?.E, 3)}</td>
                    <td>{cv ? formatStation(cv.ls ? cv.staTS : cv.staBC) : '—'}</td><td>{cv ? formatStation(cv.staMC) : '—'}</td><td>{cv ? formatStation(cv.ls ? cv.staST : cv.staEC) : '—'}</td>
                  </tr>
                );
              })}
              {!al.ips.length && <tr><td colSpan={10}>尚未定線：按「📏 圖面點繪中心線」在圖上點 BP→IP→EP。</td></tr>}
            </tbody>
          </table>
        </div>
        {d.alignment?.warnings.map((w, i) => <Note key={i} tone="warn">{w}</Note>)}
        <div className="btn-grid">
          <Btn disabled={!d.alignment} onClick={() => download(`${safeName(p.info.name)}_平曲線資料表_${stamp()}.csv`, curveCsv(p, d), 'text/csv;charset=utf-8')}>曲線資料表 CSV</Btn>
          <Btn disabled={!d.alignment} onClick={() => download(`${safeName(p.info.name)}_樁號座標表_${stamp()}.csv`, stakeCsv(p, d), 'text/csv;charset=utf-8')}>樁號座標表 CSV</Btn>
        </div>
      </Card>
      <details className="more card" style={{ padding: '6px 10px' }}>
        <summary>IP 座標精確輸入（座標法／偏角法）</summary>
        <div className="card-body" style={{ padding: '6px 0 0' }}>
          <div className="seg seg-2">
            <button type="button" className={method === 'coord' ? 'on' : ''} onClick={() => setMethod('coord')}>座標法</button>
            <button type="button" className={method === 'defl' ? 'on' : ''} onClick={() => setMethod('defl')}>偏角法</button>
          </div>
          {method === 'coord' ? <CoordTable ips={al.ips} onChange={ips => setAl({ ips })} /> : <DeflTable ips={al.ips} onApply={ips => { setAl({ ips }); c.refit(); }} />}
        </div>
      </details>
      <RoadwayCard p={p} d={d} />
    </>
  );
}

// ======================== 3. 圖層 / 等高線 ========================
const LAYER_LIST: Array<[keyof Layers, string]> = [
  ['backdrop', '🗺 原 DXF 彩色向量底圖'], ['ipTable', '📋 圖面 IP 曲線表（可拖曳）'], ['axis', '平曲線中心線'], ['stakes', '樁號標註'],
  ['roadEdge', '左右路寬／河寬邊線'], ['ipTangents', 'IP 切線與點號（可拖曳改線）'], ['centipede', '整樁與加樁橫斷面線'], ['curveCentipede', '曲線樁剖線'],
  ['cont1', '首曲線 CONT1'], ['cont5', '計曲線 CONT5'], ['contLabel', '計曲線高程標註'], ['tin', 'TIN 三角網線'],
  ['points', '實測高程點十字'], ['ptZ', '實測點高程文字'], ['slopeShade', '坡度陰影分析'], ['grid', '方格法挖填網格'],
  ['sam', '自動連線地物'], ['boundary', '計算範圍邊界'], ['controls', '控制點'],
];

export function Tab3Layers(c: SideCtx) {
  const { p, d, layers, setLayers } = c;
  const t = p.tin;
  const major = p.contour.interval * p.contour.majorEvery;
  return (
    <>
      <Card title="👁️ 2D 平面圖層顯示開關">
        <div className="chk-grid">
          {LAYER_LIST.map(([k, label]) => <Check key={k} id={`ly-${k}`} label={label} checked={layers[k]} onChange={v => setLayers({ ...layers, [k]: v })} />)}
        </div>
        {layers.slopeShade && <p className="hint">坡度：綠 &lt;15°、黃 15～30°、橙 30～45°、紅 &gt;45°</p>}
      </Card>
      <Card title="📐 TIN 三角網邊界與等高線設定">
        <NumField id="t-c1" label="首曲線間距 CONT1 (m)" value={p.contour.interval} min={0.1} onChange={v => patch('contour', { ...p.contour, interval: v, majorEvery: Math.max(1, Math.round(major / v)) })} />
        <NumField id="t-c5" label="計曲線間距 CONT5 (m)" value={major} min={0.5} onChange={v => patch('contour', { ...p.contour, majorEvery: Math.max(1, Math.round(v / p.contour.interval)) })} />
        <Check id="t-hs" label="隱藏外圍過長連線與銳角三角網（由外往內剝除，不挖內部）" checked={t.hideSliver} onChange={v => patch('tin', { ...t, hideSliver: v })} />
        <NumField id="t-me" label="最大容許三角網邊長 (m，0=不限)" value={t.maxEdge} min={0} onChange={v => patch('tin', { ...t, maxEdge: v })} />
        <NumField id="t-ma" label="最小銳角門檻 (度)" value={t.minAngle} min={0} max={30} onChange={v => patch('tin', { ...t, minAngle: v })} disabled={!t.hideSliver} />
        <Check id="t-ub" label="只在計算範圍邊界內建網" checked={t.useBoundary} onChange={v => patch('tin', { ...t, useBoundary: v })} />
        <div className="btn-grid">
          <Btn active={c.tool === 'boundary'} onClick={() => { c.setView('2D'); c.setTool(c.tool === 'boundary' ? 'pan' : 'boundary'); }}>畫計算範圍邊界</Btn>
          <Btn onClick={() => { const h = convexHull(p.points); if (h.length >= 3) { patch('boundary', h); c.status('已用測點外框建立邊界'); } }}>用測點外框</Btn>
          <Btn kind="accent" active={c.tool === 'flip'} onClick={() => { c.setView('2D'); c.setTool(c.tool === 'flip' ? 'pan' : 'flip'); setLayers({ ...layers, tin: true }); }}>🔄 翻轉網格共邊</Btn>
          <Btn kind="danger" disabled={!p.boundary && !t.flips.length} onClick={() => { update(q => ({ ...q, boundary: null, tin: { ...q.tin, flips: [] } })); c.status('已清除邊界與翻轉紀錄'); }}>清除邊界／翻轉</Btn>
        </div>
        <div className="kpis">
          <Kpi label="三角形" value={d.tin ? fmtThousands(d.tin.tri.length / 3, 0) : '0'} />
          <Kpi label="高程範圍" value={d.tin ? `${d.tin.minZ.toFixed(1)}～${d.tin.maxZ.toFixed(1)}` : '—'} />
          <Kpi label="等高線" value={`${d.contours.length} 條`} />
          <Kpi label="翻轉共邊" value={`${t.flips.length} 處`} />
        </div>
      </Card>
      <SamPanel p={p} d={d} toast={c.status} />
      <Btn onClick={() => c.openDrawer('legend')}>📝 編輯圖例庫（下方表格）</Btn>
    </>
  );
}

// ======================== 4. 縱橫斷與土方 ========================
export function Tab4Design(c: SideCtx) {
  const { p, d, grid } = c;
  const al = d.alignment;
  const last = d.volumes[d.volumes.length - 1];
  const vipMode = p.vpis.length >= 2;
  const vp = A.currentVpis(p, d);
  const spec = useMemo(() => checkProfileSpec(d.profile, p.pf.speed), [d.profile, p.pf.speed]);
  const [drop, setDrop] = useState({ sta: '', dz: '2', name: '防砂壩' });
  const [seq, setSeq] = useState({ g: '', len: '' });
  const [lnIdx, setLnIdx] = useState(0);
  const t = p.template, g = p.grid;
  const pf = p.pf;
  const setPf = (v: Partial<typeof pf>) => patch('pf', { ...pf, ...v });
  const ln = pf.lines[lnIdx];
  const setLn = (v: Partial<OtherLine>) => setPf({ lines: pf.lines.map((x, i) => (i === lnIdx ? { ...x, ...v } : x)) });
  const run = () => {
    if (!p.boundary) { c.status('請先在「3. 圖層/等高線」設定計算範圍邊界', 'warn'); return; }
    if (!d.tin) { c.status('沒有三角網', 'warn'); return; }
    const design = g.designMode === 'flat' ? flatSurface(g.designZ)
      : g.designMode === 'slope' ? slopedSurface(polygonCentroid(p.boundary), g.designZ, g.slopePct, g.slopeAzDeg * DEG)
      : (x: number, y: number) => (al ? d.profile.elevAt(stationOf(al, x, y).sta) : null);
    try {
      const r = gridEarthwork(p.boundary, g.cell, d.tin.sample, design);
      c.setGrid(r); c.setLayers({ ...c.layers, grid: true });
      c.status(`方格法完成：${r.cells.length} 格，挖 ${fmtThousands(r.cut, 0)} m³、填 ${fmtThousands(r.fill, 0)} m³`, 'ok');
    } catch (e) { c.status((e as Error).message, 'warn'); }
  };
  return (
    <>
      <Card title="📊 土石方數量計算總表（平均斷面法＆方格法）">
        <div className="kpis">
          <Kpi label="斷面法總挖方 (Cut)" value={`${fmtThousands(last?.cumCut ?? 0, 0)} m³`} tone="cut" />
          <Kpi label="斷面法總填方 (Fill)" value={`${fmtThousands(last?.cumFill ?? 0, 0)} m³`} tone="fill" />
          <Kpi label="方格法總挖方 (Cut)" value={grid ? `${fmtThousands(grid.cut, 0)} m³` : '未計算'} tone="cut" />
          <Kpi label="方格法總填方 (Fill)" value={grid ? `${fmtThousands(grid.fill, 0)} m³` : '未計算'} tone="fill" />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>斷面淨土方（挖−填）：<b style={{ color: 'var(--amber)' }}>{fmtThousands(last?.mass ?? 0, 0)} m³</b></span>
          <span>總長：<b style={{ color: 'var(--cyan)' }}>{(al?.length ?? 0).toFixed(1)}</b> m</span>
        </div>
        <div className="btn-grid">
          <Btn kind="primary" onClick={() => c.setView('PROFILE')}>📈 看全螢幕縱斷面</Btn>
          <Btn kind="accent" onClick={() => { c.setCrossMode('GRID'); c.setView('CROSS'); }}>📊 看全螢幕橫斷面</Btn>
        </div>
        {d.quantities.length > 0 && <div className="kpis">{d.quantities.map((q, i) => <Kpi key={i} label={`${q.unit}（${q.material}）`} value={`${q.volume.toFixed(1)} m³`} />)}</div>}
        <div className="btn-grid">
          <Btn disabled={!d.volumes.length} onClick={() => download(`${safeName(p.info.name)}_土石方數量計算表_${stamp()}.csv`, volumeCsv(p, d), 'text/csv;charset=utf-8')}>土石方計算表 CSV</Btn>
          <Btn disabled={!grid} onClick={() => grid && download(`${safeName(p.info.name)}_方格法土方_${stamp()}.csv`, gridCsv(p, grid), 'text/csv;charset=utf-8')}>方格法計算表 CSV</Btn>
        </div>
      </Card>
      <Card title="🏗️ 縱橫斷面設計參數" extra={<Btn kind="accent" onClick={() => c.status(A.alignHeadTail(p, d))}>🔗 頭尾對齊地面高</Btn>}>
        <NumField id="d-z0" label="起點 (BP) 中心設計高程 (m)" value={p.pfSimple.z0} onChange={v => patch('pfSimple', { ...p.pfSimple, z0: v })} disabled={vipMode} />
        <NumField id="d-sl" label="設計縱向坡度 (%)" value={p.pfSimple.slope} onChange={v => patch('pfSimple', { ...p.pfSimple, slope: v })} disabled={vipMode} />
        <NumField id="d-w" label="設計路基／河底寬度 W (m)" value={t.widthL + t.widthR} min={0.5} onChange={v => patch('template', { ...t, widthL: v / 2, widthR: v / 2 })} />
        <div className="two">
          <NumField id="d-cs" label="挖方邊坡 1 :" value={t.cutSlope} min={0.01} onChange={v => patch('template', { ...t, cutSlope: v })} />
          <NumField id="d-fs" label="填方／護岸邊坡 1 :" value={t.fillSlope} min={0.01} onChange={v => patch('template', { ...t, fillSlope: v })} />
        </div>
        <div className="two">
          <NumField id="d-cf" label="路拱橫坡 %" value={t.crossfall} onChange={v => patch('template', { ...t, crossfall: v })} disabled={p.roadway.enabled} />
          <NumField id="d-hw" label="橫斷面單側採樣寬度 (m)" value={p.sectionSample.halfWidth} min={2} onChange={v => patch('sectionSample', { ...p.sectionSample, halfWidth: v })} />
        </div>
        {!p.advanced.enabled && (
          <div className="two">
            <NumField id="d-dw" label="側溝寬（挖方側）" value={t.ditchWidth} unit="m" min={0} onChange={v => patch('template', { ...t, ditchWidth: v })} />
            <NumField id="d-dd" label="側溝深" value={t.ditchDepth} unit="m" min={0} onChange={v => patch('template', { ...t, ditchDepth: v })} />
          </div>
        )}
        <label className="field" htmlFor="d-gs">
          <span className="field-label">縱斷面地面高來源</span>
          <select id="d-gs" value={p.profileGround.source} onChange={e => patch('profileGround', { ...p.profileGround, source: e.target.value as 'tin' | 'level' })}>
            <option value="tin">由三角網切取</option>
            <option value="level" disabled={p.profileGround.pts.length < 2}>水準成果（{p.profileGround.pts.length} 樁）</option>
          </select>
        </label>
      </Card>
      <AdvancedCard p={p} d={d} />
      {p.advanced.enabled && <Btn onClick={() => c.openDrawer('adv')}>📝 編輯構造物組合（下方表格）</Btn>}
      <Card title="📈 縱斷面多段變坡點 VIP・拋物線豎曲線 L" extra={<span className="badge">{vipMode ? `多段 ${vp.length} VIP` : '單一坡度'}</span>}>
        <div className="row">
          <Btn kind="primary" onClick={() => c.status(A.addVip(p, d))}>＋ 新增 VIP</Btn>
          <Btn onClick={() => A.initVipsFromSimple(p, d)} disabled={vipMode}>單坡 → VIP</Btn>
          <Btn onClick={A.clearVips} disabled={!vipMode}>清除回單坡</Btn>
        </div>
        <div className="table-wrap short">
          <table className="tbl edit">
            <thead><tr><th>VIP</th><th>樁號(m)</th><th>高程Z</th><th>豎曲線L</th><th>後坡%</th><th>坡長</th><th>Y</th><th>R(m)</th><th /></tr></thead>
            <tbody>
              {vipMode ? vp.map((v, i) => {
                const end = i === 0 || i === vp.length - 1;
                const cv = d.profile.curves.find(k => k.index === i);
                const gOut = d.profile.grades[i];
                return (
                  <tr key={i}>
                    <td style={{ color: spec.curveBad.has(i) ? 'var(--red)' : 'var(--cyan)' }}>{i === 0 ? 'BP' : end ? 'EP' : `VIP${i}`}</td>
                    <td>{end ? v.sta.toFixed(2) : <CellNum value={v.sta} onChange={x => A.updateVip(p, d, i, 'sta', x)} />}</td>
                    <td><CellNum value={v.z} onChange={x => A.updateVip(p, d, i, 'z', x)} /></td>
                    <td>{end ? '0' : <CellNum value={v.L} onChange={x => A.updateVip(p, d, i, 'L', x)} />}{cv && cv.L < cv.reqL - 1e-6 && <span className="bad small"> →{cv.L.toFixed(1)}</span>}</td>
                    <td>{i < vp.length - 1 ? <CellNum value={+(gOut * 100).toFixed(3)} onChange={x => A.updateVipGrade(p, d, i, x)} /> : '-'}</td>
                    <td>{i < vp.length - 1 ? (vp[i + 1].sta - v.sta).toFixed(2) : '-'}</td>
                    <td>{cv ? Math.abs(cv.e).toFixed(3) : '-'}</td>
                    <td>{cv ? Math.round(cv.L / Math.abs(cv.A)) : '-'}</td>
                    <td>{!end && <button type="button" className="x" aria-label="刪除 VIP" onClick={() => c.status(A.removeVip(p, d, i))}>✕</button>}</td>
                  </tr>
                );
              }) : <tr><td colSpan={9} className="muted">單一坡度模式。按「＋ 新增 VIP」或「單坡 → VIP」啟用多段變坡。</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="hint">L=0 為折坡；z = z<sub>BVC</sub> + g₁x + (g₂−g₁)x²/(2L)，L 過大時自動縮短（紅字）。全螢幕縱斷面可直接拖曳 VIP、<b>Shift+點擊</b>新增。</p>
      </Card>
      <Card title="🧱 防砂壩／固床工 垂直跌水落差 ΔZ">
        <div className="row">
          <input className="tinput" style={{ width: 70 }} placeholder="樁號(m)" inputMode="decimal" value={drop.sta} onChange={e => setDrop({ ...drop, sta: e.target.value })} aria-label="落差樁號" />
          <input className="tinput" style={{ width: 52 }} title="落差 ΔZ（沿樁號增加方向，正值=下降）" inputMode="decimal" value={drop.dz} onChange={e => setDrop({ ...drop, dz: e.target.value })} aria-label="落差 ΔZ" />
          <input className="tinput" list="drop-names" value={drop.name} onChange={e => setDrop({ ...drop, name: e.target.value })} aria-label="名稱" />
          <datalist id="drop-names"><option value="防砂壩" /><option value="固床工" /><option value="潛壩" /><option value="跌水工" /></datalist>
          <Btn kind="accent" onClick={() => c.status(A.addDrop(Number(drop.sta), Number(drop.dz), drop.name))}>加入</Btn>
        </div>
        {p.drops.length > 0 && (
          <div className="table-wrap short">
            <table className="tbl edit">
              <thead><tr><th>名稱</th><th>樁號(m)</th><th>ΔZ(m)</th><th>上游高</th><th>下游高</th><th /></tr></thead>
              <tbody>
                {p.drops.map((x, i) => (
                  <tr key={i}>
                    <td><input className="cell" style={{ textAlign: 'left' }} value={x.name} onChange={e => A.updateDrop(i, { name: e.target.value })} aria-label="名稱" /></td>
                    <td><CellNum value={x.sta} onChange={v => A.updateDrop(i, { sta: v })} /></td>
                    <td><CellNum value={x.dz} onChange={v => A.updateDrop(i, { dz: v })} /></td>
                    <td style={{ color: 'var(--cyan)' }}>{f2(d.profile.elevBefore(x.sta))}</td>
                    <td style={{ color: 'var(--amber)' }}>{f2(d.profile.elevAt(x.sta))}</td>
                    <td><button type="button" className="x" aria-label="刪除" onClick={() => A.removeDrop(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">ΔZ＝沿樁號增加方向的垂直落差（正=下降）。落差之後的設計高程整體下移；縱橫斷面於落差處自動建立「(上)」「(下)」兩個斷面樁。全螢幕縱斷面 <b>Alt+點擊</b> 也可新增。</p>
      </Card>
      <Card title="🧮 縱坡輸入輔助・按規範檢查縱斷設計線">
        <div className="row">
          <input className="tinput" style={{ width: 70 }} placeholder="坡度%" inputMode="decimal" value={seq.g} onChange={e => setSeq({ ...seq, g: e.target.value })} aria-label="坡度" />
          <input className="tinput" style={{ width: 70 }} placeholder="坡長m" inputMode="decimal" value={seq.len} onChange={e => setSeq({ ...seq, len: e.target.value })} aria-label="坡長" />
          <Btn kind="accent" onClick={() => c.status(A.addVipByGrade(p, d, Number(seq.g), Number(seq.len)))}>坡度＋距離 → 接續新增 VIP</Btn>
        </div>
        <Btn onClick={() => {
          const r = d.stakeRows.find(x => c.selectedSta !== null && Math.abs(x.stake.sta - c.selectedSta) < 1e-6);
          if (!r || r.ground === null) { c.status('請先在縱斷面圖或樁號表選取一個有地面高的樁號', 'warn'); return; }
          c.status(A.addVip(p, d, r.stake.sta, r.ground));
        }}>📌 以目前選取樁號之地面高設為 VIP</Btn>
        <label className="field" htmlFor="d-spd">
          <span className="field-label">規範等級（設計速率）</span>
          <select id="d-spd" value={pf.speed} onChange={e => setPf({ speed: Number(e.target.value) })}>
            {[30, 40, 50, 60, 70, 80].map(v => <option key={v} value={v}>{v} km/h</option>)}
          </select>
        </label>
        <Btn kind="primary" onClick={() => c.status(A.autoSpecL(p, d))}>按規範計算豎曲線長（&gt;0.5% 坡差者）</Btn>
        <div>{spec.lines.map((l, i) => <div key={i} className={l.ok ? 'spec-ok' : 'spec-bad'}>{l.ok ? '✔' : '✖'} {l.text}</div>)}</div>
        <p className="hint">限值（最大縱坡、凸／凹形 K 值、Lmin = max(K·A, 0.6V)）為內建參考值，正式設計請依適用規範核對。</p>
      </Card>
      <Card title="🖼️ 縱斷面圖面設定・下部資料框">
        <TextField id="pf-t" label="圖名" value={pf.title} onChange={v => setPf({ title: v || '縱斷面圖' })} />
        <NumField id="pf-v" label="垂直誇大倍率（0=自動填滿）" value={pf.vEx} min={0} onChange={v => setPf({ vEx: v })} />
        <label className="field" htmlFor="pf-sf">
          <span className="field-label">坡度顯示方式</span>
          <select id="pf-sf" value={pf.slopeFmt} onChange={e => setPf({ slopeFmt: e.target.value as typeof pf.slopeFmt })}>
            <option value="pct">百分比 %</option><option value="ratio">比例值 1:n</option><option value="deg">角度 °</option>
          </select>
        </label>
        <NumField id="pf-fo" label="左右田高距中心線 (m)" value={pf.fieldOff} min={0.5} onChange={v => setPf({ fieldOff: v })} />
        <NumField id="pf-lh" label="備註引線高（px，0=自動取齊）" value={pf.leaderH} min={0} onChange={v => setPf({ leaderH: v })} />
        <div className="chk-grid">
          <Check id="pf-a" label="標示縱坡交高差 A%" checked={pf.showA} onChange={v => setPf({ showA: v })} />
          <Check id="pf-f" label="繪出左右田面線" checked={pf.showField} onChange={v => setPf({ showField: v })} />
        </div>
        <span className="field-label">下部資料框顯示列：</span>
        <div className="chk-grid">
          {PF_ROWS.map(([k, label]) => <Check key={k} id={`pfr-${k}`} label={label} checked={pf.rows.includes(k)} onChange={v => setPf({ rows: PF_ROWS.map(r => r[0]).filter(x => (x === k ? v : pf.rows.includes(x))) })} />)}
        </div>
      </Card>
      <Card title="🧷 其他設計線・備註・區間備註">
        <div className="row">
          <select aria-label="其他設計線" value={lnIdx} onChange={e => setLnIdx(Number(e.target.value))} style={{ flex: 1 }}>
            {pf.lines.map((l, i) => <option key={i} value={i}>{l.code} {l.name}</option>)}
            {!pf.lines.length && <option value={0}>（尚無其他設計線）</option>}
          </select>
          <Btn kind="accent" onClick={() => { const n = pf.lines.length; setPf({ lines: [...pf.lines, { code: `L${n + 1}`, name: '溝底線', color: ['#ff9e64', '#7dd3fc', '#a3e635', '#f0abfc', '#fde047'][n % 5], mode: 'abs', visible: true, text: '' }] }); setLnIdx(n); }}>＋ 新增</Btn>
          <Btn disabled={!ln} onClick={() => { setPf({ lines: pf.lines.filter((_, i) => i !== lnIdx) }); setLnIdx(Math.max(0, lnIdx - 1)); }}>刪除</Btn>
        </div>
        {ln && (
          <>
            <div className="row">
              <input className="tinput" style={{ width: 60 }} value={ln.code} onChange={e => setLn({ code: e.target.value })} aria-label="代碼" />
              <input className="tinput" value={ln.name} onChange={e => setLn({ name: e.target.value })} aria-label="說明" />
              <input type="color" className="cell-color" value={ln.color} onChange={e => setLn({ color: e.target.value })} aria-label="顏色" />
            </div>
            <div className="row">
              <select aria-label="數據方式" value={ln.mode} onChange={e => setLn({ mode: e.target.value as 'abs' | 'rel' })} style={{ flex: 1 }}>
                <option value="abs">絕對高程</option><option value="rel">相對中心設計高（±m）</option>
              </select>
              <Check id="ln-v" label="展繪" checked={ln.visible} onChange={v => setLn({ visible: v })} />
            </div>
            <textarea className="pf-ta" placeholder={'每行：樁號, 數據（線性內插）\n例：20, 105.2'} value={ln.text} onChange={e => setLn({ text: e.target.value })} aria-label="設計線資料" />
          </>
        )}
        <span className="field-label">備註（每行：樁號, 文字）</span>
        <textarea className="pf-ta" placeholder={'例：35, 防砂壩頂\n80, 新設固床工'} value={pf.notes} onChange={e => setPf({ notes: e.target.value })} aria-label="備註" />
        <span className="field-label">區間備註（每行：起樁號, 迄樁號, 文字）</span>
        <textarea className="pf-ta" placeholder="例：20, 60, 護岸 H=3m" value={pf.ranges} onChange={e => setPf({ ranges: e.target.value })} aria-label="區間備註" />
      </Card>
      <Card title="📍 縱斷面里程樁號表（點擊直接看該樁橫斷面）" extra={<span className="badge">{d.stakeRows.length} 樁</span>}>
        <div className="table-wrap short">
          <table className="tbl">
            <thead><tr><th>里程樁號</th><th>點名</th><th>地面高</th><th>設計高</th><th>挖方㎡</th><th>填方㎡</th></tr></thead>
            <tbody>
              {d.sections.map((s, i) => {
                const row = d.stakeRows[i];
                const sel = c.selectedSta !== null && Math.abs(c.selectedSta - s.stake.sta) < 1e-6;
                return (
                  <tr key={i} className={sel ? 'sel' : ''} onClick={() => { c.setSelectedSta(s.stake.sta); c.setCrossMode('SINGLE'); c.setView('CROSS'); }}>
                    <td>{formatStation(s.stake.sta)}</td><td className="accent">{s.stake.label}</td>
                    <td>{f2(row?.ground)}</td><td style={{ color: '#93c5fd' }}>{f2(row?.design)}</td>
                    <td className="cut">{s.result ? s.result.cutArea.toFixed(2) : '—'}</td><td className="fill">{s.result ? s.result.fillArea.toFixed(2) : '—'}</td>
                  </tr>
                );
              })}
              {!d.sections.length && <tr><td colSpan={6}>尚未建立中心線</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="▦ 方格法整地土方">
        {!p.boundary && <Note tone="warn">需要計算範圍邊界（「3. 圖層/等高線」頁）。</Note>}
        <NumField id="g-cell" label="方格法計算邊長尺寸 (m)" value={g.cell} min={0.5} onChange={v => patch('grid', { ...g, cell: v })} />
        <label className="field" htmlFor="g-mode">
          <span className="field-label">設計面</span>
          <select id="g-mode" value={g.designMode} onChange={e => patch('grid', { ...g, designMode: e.target.value as typeof g.designMode })}>
            <option value="flat">水平面（整地高程）</option>
            <option value="slope">單向斜面</option>
            <option value="profile" disabled={!al}>依中心線縱斷設計高</option>
          </select>
        </label>
        {g.designMode !== 'profile' && <NumField id="g-z" label={g.designMode === 'flat' ? '設計高程' : '範圍形心處設計高程'} value={g.designZ} unit="m" onChange={v => patch('grid', { ...g, designZ: v })} />}
        {g.designMode === 'slope' && (
          <div className="two">
            <NumField id="g-sp" label="坡度 %" value={g.slopePct} onChange={v => patch('grid', { ...g, slopePct: v })} />
            <NumField id="g-az" label="坡向方位角 °" value={g.slopeAzDeg} onChange={v => patch('grid', { ...g, slopeAzDeg: v })} />
          </div>
        )}
        {g.designMode === 'profile' && <p className="hint">每個方格角點投影到中心線求樁號，取該樁號的縱斷設計高（含落差）。</p>}
        <Btn kind="primary" wide onClick={run}>計算方格法土方</Btn>
        {grid && grid.skipped > 0 && <Note tone="warn">邊界內有 {grid.skippedArea.toFixed(1)} m² 沒有地形資料，未列入計算。</Note>}
      </Card>
    </>
  );
}

export { fmtGrade };
