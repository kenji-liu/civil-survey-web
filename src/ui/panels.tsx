// 左側功能面板
import { useMemo, useState } from 'react';
import type { Project } from '../core/model';
import { newProject, normalizeProject, isValidZ, nextPointId } from '../core/model';
import type { Derived } from '../store/derived';
import type { XY } from '../core/geom';
import { azimuth, dist, polygonCentroid, wrapPi } from '../core/geom';
import { gridEarthwork, flatSurface, slopedSurface, type GridResult } from '../core/earthwork-grid';
import type { CurveKind, CurveSpec, IPInput, AlignmentInput } from '../core/alignment';
import { deflectionToIPs } from '../core/alignment';
import { DEG, degToDmsNumber, degToDmsText, formatStation, parseStation, fmtThousands } from '../core/units';
import { update, patch, replaceProject, useSaveStatus } from '../store/store';
import { demoProject } from '../store/demo';
import { COLUMN_ORDER_LABEL, decodeText, parsePointText, type ColumnOrder } from '../io/csv';
import { buildDxf, pointsCsv, gridCsv, curveCsv, stakeCsv, volumeCsv, type DxfLayersOpt } from '../io/exports';
import { Card, NumField, TextField, Check, Btn, Kpi, Note, download, pickFile, stamp, safeName } from './common';
import type { Tool, Layers } from './PlanView';

export interface PanelCtx {
  p: Project;
  d: Derived;
  tool: Tool;
  setTool(t: Tool): void;
  grid: GridResult | null;
  setGrid(g: GridResult | null): void;
  selectedSta: number | null;
  setSelectedSta(s: number | null): void;
  layers: Layers;
  setLayers(l: Layers): void;
  toast(msg: string, tone?: 'ok' | 'warn'): void;
  refit(): void;
  openDxf(file: File, append: boolean): void;
  newPointZ: number;
  setNewPointZ(z: number): void;
  defaultRadius: number;
  setDefaultRadius(r: number): void;
}

// ---------------- 專案 ----------------
export function ProjectPanel({ p, toast, refit, setGrid }: PanelCtx) {
  const status = useSaveStatus();
  const [confirmNew, setConfirmNew] = useState(false);
  const setInfo = (k: keyof Project['info'], v: string) => update(q => ({ ...q, info: { ...q.info, [k]: v } }));
  return (
    <>
      <Card title="工程資料" extra={<span className={`save ${status}`}>{status === 'saved' ? '已自動儲存' : status === 'saving' ? '儲存中…' : status === 'error' ? '儲存失敗' : ''}</span>}>
        <TextField id="pj-name" label="工程名稱" value={p.info.name} onChange={v => setInfo('name', v)} />
        <TextField id="pj-code" label="工程編號" value={p.info.code} onChange={v => setInfo('code', v)} />
        <TextField id="pj-owner" label="業主" value={p.info.owner} onChange={v => setInfo('owner', v)} />
        <TextField id="pj-site" label="施工地點" value={p.info.site} onChange={v => setInfo('site', v)} />
        <TextField id="pj-designer" label="設計者" value={p.info.designer} onChange={v => setInfo('designer', v)} />
        <p className="hint">工程資料會帶進各報表的抬頭。</p>
      </Card>
      <Card title="專案檔">
        <div className="btn-grid">
          <Btn onClick={async () => {
            const f = await pickFile('.json,.cwp');
            if (!f) return;
            try {
              const proj = normalizeProject(JSON.parse(decodeText(await f.arrayBuffer())));
              replaceProject(proj); setGrid(null); refit();
              toast(`已開啟「${proj.info.name}」`, 'ok');
            } catch (e) { toast(`無法開啟：${(e as Error).message}`, 'warn'); }
          }}>開啟專案檔</Btn>
          <Btn kind="primary" onClick={() => download(`${safeName(p.info.name)}_${stamp()}.json`, JSON.stringify(p), 'application/json')}>下載專案檔</Btn>
          <Btn kind={confirmNew ? 'danger' : undefined} onClick={() => {
            if (!confirmNew) { setConfirmNew(true); setTimeout(() => setConfirmNew(false), 4000); return; }
            replaceProject(newProject()); setGrid(null); setConfirmNew(false); toast('已建立新專案（可按 Ctrl+Z 復原）');
          }}>{confirmNew ? '再按一次確認清空' : '新專案'}</Btn>
          <Btn kind="accent" onClick={() => { replaceProject(demoProject()); setGrid(null); refit(); toast('已載入示範資料', 'ok'); }}>載入示範資料</Btn>
        </div>
        <Note>資料只存在你這台電腦的瀏覽器裡，不會上傳。清除瀏覽器資料會一併刪除，重要的專案請定期「下載專案檔」備份。</Note>
      </Card>
      <Card title="操作流程" extra={<span className="badge">第一次使用？請按右上角「範例教學」</span>}>
        <ol className="flow">
          <li><b>測量計算</b>：控制點、觀測手簿、導線、水準、交會、座標轉換</li>
          <li><b>測點</b>：匯入 CSV／TXT 點檔或 DXF 地形圖</li>
          <li><b>自動連線</b>：依連線代碼畫出房屋、道路等地物，地形線當作斷線</li>
          <li><b>地形</b>：設定邊界，產生三角網與等高線</li>
          <li><b>方格土方</b>：整地挖填計算</li>
          <li><b>平曲線</b>：座標法、偏角法或在圖上定線，產生里程樁</li>
          <li><b>縱斷面</b>：設定縱坡交點與豎曲線</li>
          <li><b>橫斷面</b>：設定標準斷面，計算平均斷面法土方</li>
          <li><b>匯出</b>：AutoCAD DXF 圖檔與 CSV 報表</li>
        </ol>
      </Card>
    </>
  );
}

// ---------------- 測點 ----------------
export function PointsPanel(c: PanelCtx) {
  const { p, d, toast, refit, openDxf } = c;
  const [order, setOrder] = useState<ColumnOrder>('PENZ');
  const [append, setAppend] = useState(false);
  const importText = async () => {
    const f = await pickFile('.csv,.txt,.pnt,.xyz,.dat');
    if (!f) return;
    const r = parsePointText(decodeText(await f.arrayBuffer()), order, p.zRule);
    if (!r.points.length) { toast('檔案裡沒有讀到座標，請確認欄位順序', 'warn'); return; }
    update(q => {
      let id = append ? nextPointId(q.points) : 1;
      const pts = r.points.map(t => ({ ...t, id: id++ }));
      return { ...q, points: append ? [...q.points, ...pts] : pts };
    });
    refit();
    toast(`匯入 ${r.points.length} 點${r.nullZ ? `，其中 ${r.nullZ} 點無有效高程` : ''}${r.skippedLines ? `，略過 ${r.skippedLines} 行` : ''}`, 'ok');
  };
  return (
    <>
      <Card title="匯入測點">
        <label className="field" htmlFor="csv-order">
          <span className="field-label">點檔欄位順序</span>
          <select id="csv-order" value={order} onChange={e => setOrder(e.target.value as ColumnOrder)}>
            {Object.entries(COLUMN_ORDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="radio-row">
          <label><input type="radio" name="imp-mode" checked={!append} onChange={() => setAppend(false)} /> 取代現有測點</label>
          <label><input type="radio" name="imp-mode" checked={append} onChange={() => setAppend(true)} /> 加到現有測點</label>
        </div>
        <div className="btn-grid">
          <Btn kind="primary" onClick={importText}>匯入 CSV／TXT</Btn>
          <Btn kind="primary" onClick={async () => { const f = await pickFile('.dxf'); if (f) openDxf(f, append); }}>匯入 DXF</Btn>
        </div>
        <p className="hint">分隔符號可以是逗號、Tab 或空白；標題列會自動略過。DXF 可讀點、圖塊、高程文字、等高線與 3D 線。</p>
      </Card>
      <Card title="高程檢查">
        <Check id="z-zero" label="高程 0 視為無資料" checked={p.zRule.zeroIsNull} onChange={v => patch('zRule', { ...p.zRule, zeroIsNull: v })} />
        <NumField id="z-min" label="合理高程下限" value={p.zRule.minZ} unit="m" onChange={v => patch('zRule', { ...p.zRule, minZ: v })} />
        <NumField id="z-max" label="合理高程上限" value={p.zRule.maxZ} unit="m" onChange={v => patch('zRule', { ...p.zRule, maxZ: v })} />
        <div className="kpis">
          <Kpi label="測點總數" value={String(p.points.length)} />
          <Kpi label="有效高程" value={String(d.validCount)} tone="ok" />
          <Kpi label="無高程（不建網）" value={String(d.nullCount)} tone={d.nullCount ? 'warn' : undefined} />
        </div>
        {d.nullCount > 0 && (
          <Btn kind="danger" onClick={() => { update(q => ({ ...q, points: q.points.filter(t => isValidZ(t.z, q.zRule)) })); toast(`已刪除 ${d.nullCount} 個無高程點（Ctrl+Z 可復原）`); }}>刪除無高程點</Btn>
        )}
      </Card>
      <Card title="補點">
        <NumField id="new-z" label="新點高程" value={c.newPointZ} unit="m" onChange={c.setNewPointZ} />
        <Btn active={c.tool === 'addpt'} onClick={() => c.setTool(c.tool === 'addpt' ? 'pan' : 'addpt')}>{c.tool === 'addpt' ? '結束補點' : '在圖上點選補點'}</Btn>
        <p className="hint">在平面圖上點一下就新增一點。點選既有測點可在下方表格看到資料。</p>
      </Card>
      <Card title="輸出">
        <Btn onClick={() => download(`${safeName(p.info.name)}_測點_${stamp()}.csv`, pointsCsv(p), 'text/csv;charset=utf-8')} disabled={!p.points.length}>匯出測點 CSV</Btn>
      </Card>
    </>
  );
}

// ---------------- 地形 ----------------
export function TerrainPanel(c: PanelCtx) {
  const { p, d, layers, setLayers, setTool, tool, toast } = c;
  const L = (k: keyof Layers, label: string) => <Check id={`ly-${k}`} label={label} checked={layers[k]} onChange={v => setLayers({ ...layers, [k]: v })} />;
  return (
    <>
      <Card title="三角網 TIN">
        <NumField id="tin-max" label="最大邊長（0 = 不限）" value={p.tin.maxEdge} unit="m" min={0} onChange={v => patch('tin', { ...p.tin, maxEdge: v })} />
        <Check id="tin-bnd" label="只在邊界內建網" checked={p.tin.useBoundary} onChange={v => patch('tin', { ...p.tin, useBoundary: v })} />
        <div className="kpis">
          <Kpi label="建網點數" value={d.tin ? String(d.tin.nPts) : '0'} />
          <Kpi label="三角形" value={d.tin ? String(d.tin.tri.length / 3) : '0'} />
          <Kpi label="高程範圍" value={d.tin ? `${d.tin.minZ.toFixed(2)} ~ ${d.tin.maxZ.toFixed(2)}` : '—'} />
        </div>
        <p className="hint">地形外圍或凹進去的地方被拉出細長三角形時，設定最大邊長或畫邊界就能排除。</p>
      </Card>
      <Card title="計算範圍邊界">
        <div className="btn-grid">
          <Btn active={tool === 'boundary'} onClick={() => setTool(tool === 'boundary' ? 'pan' : 'boundary')}>{tool === 'boundary' ? '取消繪製' : '在圖上畫邊界'}</Btn>
          <Btn onClick={() => {
            const h = convexHull(p.points);
            if (h.length < 3) { toast('測點不足，無法建立外框', 'warn'); return; }
            patch('boundary', h); toast('已用測點外框建立邊界', 'ok');
          }}>用測點外框</Btn>
          <Btn kind="danger" disabled={!p.boundary} onClick={() => patch('boundary', null)}>清除邊界</Btn>
        </div>
        <p className="hint">{tool === 'boundary' ? '依序點選邊界頂點，雙擊、按右鍵或 Enter 完成，Esc 取消。' : p.boundary ? `目前邊界 ${p.boundary.length} 個頂點。邊界同時是方格法的計算範圍。` : '尚未設定邊界。'}</p>
      </Card>
      <Card title="等高線">
        <NumField id="ct-int" label="首曲線間距" value={p.contour.interval} unit="m" min={0.01} onChange={v => patch('contour', { ...p.contour, interval: v })} />
        <NumField id="ct-major" label="每幾條為計曲線" value={p.contour.majorEvery} min={1} onChange={v => patch('contour', { ...p.contour, majorEvery: Math.round(v) })} />
        <p className="hint">目前 {d.contours.length} 條等高線。</p>
      </Card>
      <Card title="圖層">
        <div className="chk-grid">
          {L('points', '測點')}{L('labels', '高程標註')}{L('tin', '三角網')}{L('contours', '等高線')}
          {L('contourLabels', '等高線高程')}{L('sam', '自動連線地物')}{L('boundary', '邊界')}{L('alignment', '中心線')}{L('stakes', '樁號')}{L('grid', '方格土方')}
        </div>
      </Card>
    </>
  );
}

function convexHull(pts: XY[]): XY[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (s.length < 3) return [];
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [], upper: XY[] = [];
  for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of s.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(p => ({ x: p.x, y: p.y }));
}

// ---------------- 方格土方 ----------------
export function GridPanel(c: PanelCtx) {
  const { p, d, grid, setGrid, toast, layers, setLayers } = c;
  const g = p.grid;
  const setG = (k: keyof Project['grid'], v: number | string) => patch('grid', { ...g, [k]: v });
  const run = () => {
    if (!p.boundary) { toast('請先在「地形」頁設定計算範圍邊界', 'warn'); return; }
    if (!d.tin) { toast('沒有三角網，請先匯入有高程的測點', 'warn'); return; }
    try {
      const design = g.designMode === 'flat' ? flatSurface(g.designZ) : slopedSurface(polygonCentroid(p.boundary), g.designZ, g.slopePct, g.slopeAzDeg * DEG);
      const r = gridEarthwork(p.boundary, g.cell, d.tin.sample, design);
      setGrid(r);
      setLayers({ ...layers, grid: true });
      toast(`計算完成：${r.cells.length} 格`, 'ok');
    } catch (e) { toast((e as Error).message, 'warn'); }
  };
  return (
    <>
      <Card title="方格法設定">
        {!p.boundary && <Note tone="warn">尚未設定計算範圍。請到「地形」頁畫邊界或用測點外框。</Note>}
        <NumField id="g-cell" label="方格邊長" value={g.cell} unit="m" min={0.1} onChange={v => setG('cell', v)} />
        <label className="field" htmlFor="g-mode">
          <span className="field-label">設計面</span>
          <select id="g-mode" value={g.designMode} onChange={e => setG('designMode', e.target.value)}>
            <option value="flat">水平面（整地高程）</option>
            <option value="slope">單向斜面</option>
          </select>
        </label>
        <NumField id="g-z" label={g.designMode === 'flat' ? '設計高程' : '範圍形心處設計高程'} value={g.designZ} unit="m" onChange={v => setG('designZ', v)} />
        {g.designMode === 'slope' && (
          <>
            <NumField id="g-slope" label="坡度（往下為負）" value={g.slopePct} unit="%" onChange={v => setG('slopePct', v)} />
            <NumField id="g-az" label="坡向方位角" value={g.slopeAzDeg} unit="°" onChange={v => setG('slopeAzDeg', v)} />
          </>
        )}
        {d.tin && <p className="hint">地形高程 {d.tin.minZ.toFixed(2)} ~ {d.tin.maxZ.toFixed(2)} m</p>}
        <Btn kind="primary" wide onClick={run}>計算土方</Btn>
      </Card>
      {grid && (
        <Card title="計算結果">
          <div className="kpis">
            <Kpi label="計算面積" value={`${fmtThousands(grid.totalArea)} m²`} />
            <Kpi label="方格數" value={String(grid.cells.length)} />
            <Kpi label="挖方" value={`${fmtThousands(grid.cut)} m³`} tone="cut" />
            <Kpi label="填方" value={`${fmtThousands(grid.fill)} m³`} tone="fill" />
            <Kpi label="淨土方（挖−填）" value={`${fmtThousands(grid.cut - grid.fill)} m³`} />
          </div>
          {grid.skipped > 0 && <Note tone="warn">邊界內有 {grid.skipped} 格、共 {grid.skippedArea.toFixed(1)} m² 沒有地形資料，未列入計算。可加大邊界外的測點範圍，或把邊界往內縮。</Note>}
          <p className="hint">方格切成兩個三角形，挖填交界依 0 線分開計算；邊界方格只算邊界內的面積。</p>
          <div className="btn-grid">
            <Btn onClick={() => download(`${safeName(p.info.name)}_方格法土方_${stamp()}.csv`, gridCsv(p, grid), 'text/csv;charset=utf-8')}>匯出計算表 CSV</Btn>
            <Btn kind="ghost" onClick={() => setGrid(null)}>清除結果</Btn>
          </div>
        </Card>
      )}
    </>
  );
}

// ---------------- 平曲線 ----------------
const KINDS: Array<[CurveKind, string]> = [['R', '半徑 R'], ['T', '切線長 T'], ['L', '曲線長 L'], ['E', '外矢距 E']];

function emptyAlignment(): AlignmentInput {
  return { name: 'A', startStation: 0, interval: 20, minGap: 2, extraStations: [], ips: [] };
}

export function AlignmentPanel(c: PanelCtx) {
  const { p, d, tool, setTool, toast, refit } = c;
  const [method, setMethod] = useState<'coord' | 'defl' | 'draw'>('coord');
  const al = p.alignment ?? emptyAlignment();
  const setAl = (a: AlignmentInput | null) => patch('alignment', a);
  const setIps = (ips: IPInput[]) => setAl({ ...al, ips });
  const [extra, setExtra] = useState(al.extraStations.map(s => formatStation(s)).join(', '));

  return (
    <>
      <Card title="定線方式">
        <div className="seg">
          {([['coord', '座標法'], ['defl', '偏角法'], ['draw', '圖上定線']] as const).map(([k, t]) => (
            <button key={k} type="button" className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{t}</button>
          ))}
        </div>
        {method === 'coord' && <CoordTable ips={al.ips} onChange={setIps} />}
        {method === 'defl' && <DeflTable ips={al.ips} onApply={ips => { setIps(ips); refit(); toast('已依偏角法建立 IP 座標', 'ok'); }} />}
        {method === 'draw' && (
          <>
            <NumField id="def-r" label="新曲線預設半徑" value={c.defaultRadius} unit="m" min={0} onChange={c.setDefaultRadius} />
            <Btn kind="primary" active={tool === 'ip'} onClick={() => setTool(tool === 'ip' ? 'pan' : 'ip')}>{tool === 'ip' ? '取消定線' : '開始在圖上點選 IP'}</Btn>
            <p className="hint">依序點 BP、各 IP、EP；雙擊、右鍵或 Enter 完成。完成後可切到「座標法」修改各 IP 的曲線要素。</p>
          </>
        )}
      </Card>
      <Card title="里程設定">
        <TextField id="al-name" label="路線名稱" value={al.name} onChange={v => setAl({ ...al, name: v })} />
        <TextField id="al-start" label="起點樁號" value={formatStation(al.startStation)} onChange={v => { const s = parseStation(v); if (isFinite(s)) setAl({ ...al, startStation: s }); }} />
        <NumField id="al-int" label="整樁單距" value={al.interval} unit="m" min={1} onChange={v => setAl({ ...al, interval: v })} />
        <NumField id="al-gap" label="距曲線樁小於此值省略" value={al.minGap} unit="m" min={0} onChange={v => setAl({ ...al, minGap: v })} />
        <label className="field" htmlFor="al-extra">
          <span className="field-label">加樁（逗號分隔）</span>
          <span className="field-input"><input id="al-extra" type="text" value={extra} placeholder="0K+035, 0K+112.5"
            onChange={e => setExtra(e.target.value)}
            onBlur={() => setAl({ ...al, extraStations: extra.split(/[,，\s]+/).filter(Boolean).map(parseStation).filter(isFinite) })} /></span>
        </label>
        <p className="hint">整樁單距慣例：公路 20 m、灌溉 25 m、水利 50 m。</p>
      </Card>
      {d.alignment && (
        <Card title="曲線資料" extra={<span className="badge">全長 {d.alignment.length.toFixed(3)} m</span>}>
          {d.alignment.warnings.map((w, i) => <Note key={i} tone="warn">{w}</Note>)}
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>IP</th><th>偏角 Δ</th><th>R</th><th>T</th><th>L</th><th>E</th><th>BC</th><th>EC</th></tr></thead>
              <tbody>
                {d.alignment.curves.map(cv => (
                  <tr key={cv.ipIndex}>
                    <td>{cv.name}</td><td>{cv.delta >= 0 ? '右' : '左'} {degToDmsText(Math.abs(cv.delta) / DEG)}</td>
                    <td>{cv.R.toFixed(3)}</td><td>{cv.T.toFixed(3)}</td><td>{cv.L.toFixed(3)}</td><td>{cv.E.toFixed(3)}</td>
                    <td>{formatStation(cv.staBC)}</td><td>{formatStation(cv.staEC)}</td>
                  </tr>
                ))}
                {!d.alignment.curves.length && <tr><td colSpan={8}>沒有曲線（各 IP 未設曲線要素）</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="btn-grid">
            <Btn onClick={() => download(`${safeName(p.info.name)}_平曲線資料表_${stamp()}.csv`, curveCsv(p, d), 'text/csv;charset=utf-8')}>曲線資料表 CSV</Btn>
            <Btn onClick={() => download(`${safeName(p.info.name)}_樁號座標表_${stamp()}.csv`, stakeCsv(p, d), 'text/csv;charset=utf-8')}>樁號座標表 CSV</Btn>
            <Btn kind="danger" onClick={() => { setAl(null); toast('已刪除中心線（Ctrl+Z 可復原）'); }}>刪除中心線</Btn>
          </div>
        </Card>
      )}
    </>
  );
}

function CurveCell({ curve, onChange, disabled }: { curve: CurveSpec | null; onChange(c: CurveSpec | null): void; disabled?: boolean }) {
  if (disabled) return <td colSpan={2} className="muted">—</td>;
  return (
    <>
      <td>
        <select aria-label="曲線要素" value={curve?.kind ?? ''} onChange={e => onChange(e.target.value ? { kind: e.target.value as CurveKind, value: curve?.value ?? 0 } : null)}>
          <option value="">不設</option>
          {KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </td>
      <td><CellNum value={curve?.value ?? 0} disabled={!curve} onChange={v => curve && onChange({ ...curve, value: v })} /></td>
    </>
  );
}

function CellNum({ value, onChange, disabled, digits }: { value: number; onChange(v: number): void; disabled?: boolean; digits?: number }) {
  const shown = digits !== undefined ? value.toFixed(digits) : String(value);
  const [t, setT] = useState<string | null>(null);
  return (
    <input className="cell" type="text" inputMode="decimal" disabled={disabled} value={t ?? shown}
      onChange={e => setT(e.target.value)}
      onBlur={() => { if (t !== null) { const v = Number(t); if (t.trim() !== '' && isFinite(v)) onChange(v); setT(null); } }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function CellText({ value, onChange }: { value: string; onChange(v: string): void }) {
  const [t, setT] = useState<string | null>(null);
  return (
    <input className="cell" type="text" value={t ?? value}
      onChange={e => setT(e.target.value)}
      onBlur={() => { if (t !== null) { onChange(t); setT(null); } }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function CoordTable({ ips, onChange }: { ips: IPInput[]; onChange(ips: IPInput[]): void }) {
  const set = (i: number, v: Partial<IPInput>) => onChange(ips.map((q, k) => (k === i ? { ...q, ...v } : q)));
  const add = () => {
    const last = ips[ips.length - 1];
    const nIp = ips.length;
    const row: IPInput = last ? { name: 'EP', x: last.x + 50, y: last.y, curve: null } : { name: 'BP', x: 0, y: 0, curve: null };
    if (!last) { onChange([row]); return; }
    // 原本的終點變成 IP
    const prev = ips.map((q, k) => (k === nIp - 1 && nIp > 1 ? { ...q, name: q.name === 'EP' ? `IP${nIp - 1}` : q.name, curve: q.curve ?? { kind: 'R' as CurveKind, value: 50 } } : q));
    onChange([...prev, row]);
  };
  return (
    <>
      <div className="table-wrap">
        <table className="tbl edit">
          <thead><tr><th>點名</th><th>E (X)</th><th>N (Y)</th><th>曲線要素</th><th>數值</th><th /></tr></thead>
          <tbody>
            {ips.map((q, i) => (
              <tr key={i}>
                <td><CellText value={q.name} onChange={v => set(i, { name: v })} /></td>
                <td><CellNum value={q.x} digits={3} onChange={v => set(i, { x: v })} /></td>
                <td><CellNum value={q.y} digits={3} onChange={v => set(i, { y: v })} /></td>
                <CurveCell curve={q.curve} disabled={i === 0 || i === ips.length - 1} onChange={cv => set(i, { curve: cv })} />
                <td><button type="button" className="x" aria-label="刪除此列" onClick={() => onChange(ips.filter((_, k) => k !== i))}>×</button></td>
              </tr>
            ))}
            {!ips.length && <tr><td colSpan={6}>尚無資料，按「新增一列」開始輸入 BP。</td></tr>}
          </tbody>
        </table>
      </div>
      <Btn onClick={add}>新增一列</Btn>
      <p className="hint">第一列為起點 BP、最後一列為終點 EP。曲線要素給 R、T、L、E 其中一項即可，其餘自動計算。</p>
    </>
  );
}

interface DRow { name: string; angle: string; dist: number; curve: CurveSpec | null }

function ipsToDefl(ips: IPInput[]): { bp: XY; rows: DRow[] } {
  if (ips.length < 2) return { bp: ips[0] ?? { x: 0, y: 0 }, rows: [{ name: 'BP', angle: '0', dist: 0, curve: null }, { name: 'EP', angle: '0', dist: 0, curve: null }] };
  const rows: DRow[] = [];
  for (let i = 0; i < ips.length; i++) {
    const az = i < ips.length - 1 ? azimuth(ips[i], ips[i + 1]) : 0;
    let ang = 0;
    if (i === 0) ang = az / DEG;
    else if (i < ips.length - 1) ang = wrapPi(az - azimuth(ips[i - 1], ips[i])) / DEG;
    rows.push({ name: ips[i].name, angle: i < ips.length - 1 ? degToDmsNumber(ang) : '0', dist: i < ips.length - 1 ? Math.round(dist(ips[i], ips[i + 1]) * 1000) / 1000 : 0, curve: ips[i].curve });
  }
  return { bp: ips[0], rows };
}

function DeflTable({ ips, onApply }: { ips: IPInput[]; onApply(ips: IPInput[]): void }) {
  const init = useMemo(() => ipsToDefl(ips), [ips]);
  const [bp, setBp] = useState<XY>(init.bp);
  const [rows, setRows] = useState<DRow[]>(init.rows);
  const set = (i: number, v: Partial<DRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...v } : r)));
  return (
    <>
      <div className="two">
        <NumField id="df-bpx" label="BP 的 E" value={bp.x} onChange={v => setBp({ ...bp, x: v })} />
        <NumField id="df-bpy" label="BP 的 N" value={bp.y} onChange={v => setBp({ ...bp, y: v })} />
      </div>
      <div className="table-wrap">
        <table className="tbl edit">
          <thead><tr><th>點名</th><th>方位角／偏角</th><th>到下一點距離</th><th>曲線要素</th><th>數值</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><CellText value={r.name} onChange={v => set(i, { name: v })} /></td>
                <td>{i === rows.length - 1 ? <span className="muted">—</span> : <CellText value={r.angle} onChange={v => set(i, { angle: v })} />}</td>
                <td>{i === rows.length - 1 ? <span className="muted">—</span> : <CellNum value={r.dist} onChange={v => set(i, { dist: v })} />}</td>
                <CurveCell curve={r.curve} disabled={i === 0 || i === rows.length - 1} onChange={cv => set(i, { curve: cv })} />
                <td><button type="button" className="x" aria-label="刪除此列" onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-grid">
        <Btn onClick={() => { const r = [...rows]; r.splice(Math.max(1, r.length - 1), 0, { name: `IP${r.length - 1}`, angle: '0', dist: 0, curve: { kind: 'R', value: 50 } }); setRows(r); }}>插入 IP</Btn>
        <Btn kind="primary" onClick={() => onApply(deflectionToIPs(bp, rows))}>計算並套用</Btn>
      </div>
      <p className="hint">角度用 ddd.mmss 寫法（13.0257 = 13°02′57″）。BP 列填 BP→IP1 的方位角；各 IP 列填偏角，右偏為正、左偏為負。</p>
    </>
  );
}

// ---------------- 縱斷面 ----------------
export function ProfilePanel(c: PanelCtx) {
  const { p, d, selectedSta, toast } = c;
  const set = (i: number, v: Partial<Project['vpis'][number]>) => patch('vpis', p.vpis.map((q, k) => (k === i ? { ...q, ...v } : q)));
  const al = d.alignment;
  const auto = () => {
    if (!al) { toast('請先建立中心線', 'warn'); return; }
    const z0 = d.stakeRows[0]?.ground, z1 = d.stakeRows[d.stakeRows.length - 1]?.ground;
    if (z0 == null || z1 == null) { toast('起終點不在地形範圍內，無法取地面高', 'warn'); return; }
    patch('vpis', [{ sta: al.startStation, z: round3(z0), L: 0 }, { sta: round3(al.endStation), z: round3(z1), L: 0 }]);
    toast('已依地面高建立起終點', 'ok');
  };
  const addSel = () => {
    if (selectedSta === null) { toast('請先在縱斷面圖上點選樁號', 'warn'); return; }
    const row = d.stakeRows.find(r => Math.abs(r.stake.sta - selectedSta) < 1e-6);
    const z = row?.design ?? row?.ground ?? 0;
    patch('vpis', [...p.vpis, { sta: round3(selectedSta), z: round3(z), L: 0 }].sort((a, b) => a.sta - b.sta));
  };
  return (
    <>
      <Card title="原地面資料">
        <label className="field" htmlFor="pg-src">
          <span className="field-label">縱斷面地面高來源</span>
          <select id="pg-src" value={p.profileGround.source} onChange={e => patch('profileGround', { ...p.profileGround, source: e.target.value as 'tin' | 'level' })}>
            <option value="tin">由三角網切取</option>
            <option value="level" disabled={p.profileGround.pts.length < 2}>水準測量成果（{p.profileGround.pts.length} 樁）</option>
          </select>
        </label>
        <p className="hint">水準成果由「測量計算 → 水準」寫入，樁號之間以直線內插。橫斷面仍由三角網切取。</p>
      </Card>
      <Card title="縱坡交點 VPI">
        {!al && <Note tone="warn">請先在「平曲線」頁建立中心線。</Note>}
        <div className="table-wrap">
          <table className="tbl edit">
            <thead><tr><th>#</th><th>樁號</th><th>交點高程</th><th>豎曲線長 L</th><th>坡度（往後）</th><th /></tr></thead>
            <tbody>
              {p.vpis.map((v, i) => (
                <tr key={i}>
                  <td>{i === 0 ? '起' : i === p.vpis.length - 1 ? '終' : i}</td>
                  <td><CellText value={formatStation(v.sta)} onChange={t => { const s = parseStation(t); if (isFinite(s)) set(i, { sta: s }); }} /></td>
                  <td><CellNum value={v.z} digits={3} onChange={z => set(i, { z })} /></td>
                  <td>{i === 0 || i === p.vpis.length - 1 ? <span className="muted">—</span> : <CellNum value={v.L} onChange={L => set(i, { L })} />}</td>
                  <td>{d.profile.grades[i] !== undefined ? `${(d.profile.grades[i] * 100).toFixed(3)}%` : ''}</td>
                  <td><button type="button" className="x" aria-label="刪除此列" onClick={() => patch('vpis', p.vpis.filter((_, k) => k !== i))}>×</button></td>
                </tr>
              ))}
              {!p.vpis.length && <tr><td colSpan={6}>尚無縱坡資料</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="btn-grid">
          <Btn onClick={auto}>依地面建立起終點</Btn>
          <Btn onClick={addSel}>加入選取樁號為交點</Btn>
        </div>
        {d.profile.warnings.map((w, i) => <Note key={i} tone="warn">{w}</Note>)}
        <p className="hint">豎曲線為拋物線，中距 e = A·L/8（A 為前後坡度差）。在下方縱斷面圖點一下可以選取樁號。</p>
      </Card>
      {d.profile.curves.length > 0 && (
        <Card title="豎曲線">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>VPI</th><th>型式</th><th>g1</th><th>g2</th><th>L</th><th>e</th><th>BVC</th><th>EVC</th></tr></thead>
              <tbody>
                {d.profile.curves.map(cv => (
                  <tr key={cv.index}><td>{cv.index}</td><td>{cv.type === 'crest' ? '凸形' : '凹形'}</td><td>{(cv.g1 * 100).toFixed(2)}%</td><td>{(cv.g2 * 100).toFixed(2)}%</td><td>{cv.L}</td><td>{cv.e.toFixed(3)}</td><td>{formatStation(cv.bvc)}</td><td>{formatStation(cv.evc)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card title="輸出">
        <Btn disabled={!al} onClick={() => download(`${safeName(p.info.name)}_縱斷面資料表_${stamp()}.csv`, stakeCsv(p, d), 'text/csv;charset=utf-8')}>縱斷面資料表 CSV</Btn>
      </Card>
    </>
  );
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------------- 橫斷面 ----------------
export function SectionPanel(c: PanelCtx) {
  const { p, d, selectedSta, setSelectedSta } = c;
  const t = p.template;
  const setT = (k: keyof Project['template'], v: number) => patch('template', { ...t, [k]: v });
  const last = d.volumes[d.volumes.length - 1];
  const idx = selectedSta === null ? -1 : d.sections.findIndex(s => Math.abs(s.stake.sta - selectedSta) < 1e-6);
  const go = (k: number) => { const s = d.sections[k]; if (s) setSelectedSta(s.stake.sta); };
  return (
    <>
      <Card title="標準斷面">
        <div className="two">
          <NumField id="t-wl" label="左路面寬" value={t.widthL} unit="m" min={0} onChange={v => setT('widthL', v)} />
          <NumField id="t-wr" label="右路面寬" value={t.widthR} unit="m" min={0} onChange={v => setT('widthR', v)} />
        </div>
        <NumField id="t-cf" label="路拱橫坡（向外下降）" value={t.crossfall} unit="%" onChange={v => setT('crossfall', v)} />
        <div className="two">
          <NumField id="t-cut" label="挖方邊坡 1 :" value={t.cutSlope} min={0.01} onChange={v => setT('cutSlope', v)} />
          <NumField id="t-fill" label="填方邊坡 1 :" value={t.fillSlope} min={0.01} onChange={v => setT('fillSlope', v)} />
        </div>
        <div className="two">
          <NumField id="t-dw" label="側溝寬（挖方側）" value={t.ditchWidth} unit="m" min={0} onChange={v => setT('ditchWidth', v)} />
          <NumField id="t-dd" label="側溝深" value={t.ditchDepth} unit="m" min={0} onChange={v => setT('ditchDepth', v)} />
        </div>
        <div className="two">
          <NumField id="s-hw" label="橫斷取樣半寬" value={p.sectionSample.halfWidth} unit="m" min={1} onChange={v => patch('sectionSample', { ...p.sectionSample, halfWidth: v })} />
          <NumField id="s-st" label="取樣間距" value={p.sectionSample.step} unit="m" min={0.1} onChange={v => patch('sectionSample', { ...p.sectionSample, step: v })} />
        </div>
        <p className="hint">邊坡 1:m 表示垂直 1、水平 m。側溝設 0 表示不設。</p>
      </Card>
      <Card title="檢視斷面">
        <div className="btn-grid">
          <Btn disabled={idx <= 0} onClick={() => go(idx - 1)}>◀ 上一樁</Btn>
          <Btn disabled={idx >= d.sections.length - 1} onClick={() => go(idx < 0 ? 0 : idx + 1)}>下一樁 ▶</Btn>
        </div>
        <label className="field" htmlFor="sec-sel">
          <span className="field-label">樁號</span>
          <select id="sec-sel" value={idx} onChange={e => go(Number(e.target.value))}>
            <option value={-1} disabled>請選擇</option>
            {d.sections.map((s, i) => <option key={i} value={i}>{formatStation(s.stake.sta)} {s.stake.label}</option>)}
          </select>
        </label>
      </Card>
      {last && (
        <Card title="平均斷面法土方">
          <div className="kpis">
            <Kpi label="總挖方" value={`${fmtThousands(last.cumCut)} m³`} tone="cut" />
            <Kpi label="總填方" value={`${fmtThousands(last.cumFill)} m³`} tone="fill" />
            <Kpi label={last.mass >= 0 ? '餘土（棄土）' : '缺土（借土）'} value={`${fmtThousands(Math.abs(last.mass))} m³`} />
          </div>
          {d.sections.some(s => !s.result) && <Note tone="warn">有 {d.sections.filter(s => !s.result).length} 個樁號無法計算（超出地形或沒有設計高），相鄰區間不計入。</Note>}
          <Btn onClick={() => download(`${safeName(p.info.name)}_土石方數量計算表_${stamp()}.csv`, volumeCsv(p, d), 'text/csv;charset=utf-8')}>土石方數量計算表 CSV</Btn>
        </Card>
      )}
    </>
  );
}

// ---------------- 匯出 ----------------
export function ExportPanel(c: PanelCtx) {
  const { p, d, grid } = c;
  const [o, setO] = useState<DxfLayersOpt>({ sam: true, points: true, labels: true, tin: false, contours: true, boundary: true, alignment: true, stakes: true, grid: !!grid, textHeight: 1 });
  const L = (k: keyof Omit<DxfLayersOpt, 'textHeight'>, label: string, disabled = false) => (
    <Check id={`dx-${k}`} label={label + (disabled ? '（無資料）' : '')} checked={o[k] && !disabled} onChange={v => setO({ ...o, [k]: v })} />
  );
  const base = safeName(p.info.name);
  return (
    <>
      <Card title="AutoCAD 圖檔 DXF">
        <div className="chk-grid">
          {L('sam', '自動連線地物 SAM_*', !d.sam)}{L('points', '測點 POINTS')}{L('labels', '點號與高程文字')}{L('contours', '等高線 CONT1/CONT5', !d.contours.length)}
          {L('tin', '三角網 TIN（3DFACE）', !d.tin)}{L('boundary', '邊界', !p.boundary)}{L('alignment', '中心線 AXIS', !d.alignment)}
          {L('stakes', '樁號 STAKE', !d.alignment)}{L('grid', '方格土方', !grid)}
        </div>
        <NumField id="dx-th" label="文字高度" value={o.textHeight} unit="m" min={0.05} onChange={v => setO({ ...o, textHeight: v })} />
        <Btn kind="primary" wide onClick={() => download(`${base}_${stamp()}.dxf`, buildDxf(p, d, grid, {
          ...o, sam: o.sam && !!d.sam, contours: o.contours && d.contours.length > 0, tin: o.tin && !!d.tin, boundary: o.boundary && !!p.boundary,
          alignment: o.alignment && !!d.alignment, stakes: o.stakes && !!d.alignment, grid: o.grid && !!grid,
        }), 'application/dxf')}>下載 DXF</Btn>
        <p className="hint">AutoCAD R12 格式，各類圖元分圖層，任何版本的 AutoCAD 都能開啟。</p>
      </Card>
      <Card title="報表 CSV（Excel 可直接開啟）">
        <div className="btn-list">
          <Btn disabled={!p.points.length} onClick={() => download(`${base}_測點_${stamp()}.csv`, pointsCsv(p), 'text/csv;charset=utf-8')}>測點座標表</Btn>
          <Btn disabled={!grid} onClick={() => grid && download(`${base}_方格法土方_${stamp()}.csv`, gridCsv(p, grid), 'text/csv;charset=utf-8')}>方格法土方計算表</Btn>
          <Btn disabled={!d.alignment} onClick={() => download(`${base}_平曲線資料表_${stamp()}.csv`, curveCsv(p, d), 'text/csv;charset=utf-8')}>平曲線資料表</Btn>
          <Btn disabled={!d.alignment} onClick={() => download(`${base}_樁號座標表_${stamp()}.csv`, stakeCsv(p, d), 'text/csv;charset=utf-8')}>樁號座標及縱斷面資料表</Btn>
          <Btn disabled={!d.volumes.length} onClick={() => download(`${base}_土石方數量計算表_${stamp()}.csv`, volumeCsv(p, d), 'text/csv;charset=utf-8')}>土石方數量計算表</Btn>
        </div>
      </Card>
      <Card title="專案檔">
        <Btn onClick={() => download(`${base}_${stamp()}.json`, JSON.stringify(p), 'application/json')}>下載專案檔</Btn>
        <p className="hint">專案檔包含全部輸入資料，可以在其他電腦用「開啟專案檔」接著做。</p>
      </Card>
    </>
  );
}
