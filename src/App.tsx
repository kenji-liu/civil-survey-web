import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { XY } from './core/geom';
import { nextPointId, normalizeProject } from './core/model';
import type { GridResult } from './core/earthwork-grid';
import { buildAlignment, stationOf, type IPInput } from './core/alignment';
import { nearestSharedEdge } from './core/tin';
import { useProject, update, patch, undo, redo, loadSaved, replaceProject } from './store/store';
import { useDerived } from './store/derived';
import { demoProject } from './store/demo';
import * as A from './store/actions';
import { PlanView, DEFAULT_LAYERS, type Tool, type Layers, type Overlay } from './ui/PlanView';
import { ProfileFull } from './ui/ProfileFull';
import { CrossFull } from './ui/CrossFull';
import { DxfDialog } from './ui/DxfDialog';
import { ProjectPanel, ExportPanel, type PanelCtx } from './ui/panels';
import { Tab1Import, Tab2Align, Tab3Layers, Tab4Design, type SideCtx, type ViewMode, type ImportOpts } from './ui/sidebar';
import { HudBadges, HudLegend, IpOverlay } from './ui/hud';
import { decodeDxf, parseDxf, type DxfData } from './io/dxf-read';
import { dxfBackdrop } from './io/backdrop';
import { decodeText, parsePointText } from './io/csv';
import { buildDxf, volumeCsv } from './io/exports';
import { APP_NAME, APP_SHORT, APP_VERSION } from './config';
import { SurveyPanel, SurveyDrawer, type SurveyTool, type SurveyCtx } from './ui/survey-ui';
import { computeSurvey } from './core/survey';
import { computeTraverse } from './core/traverse';
import { computeLeveling } from './core/leveling';
import { SamDrawer } from './ui/sam-ui';
import { Guide, type GuideNav } from './ui/Guide';
import { AdvancedDrawer } from './ui/design-ui';
import { PlotPanel, SheetViewer, usePlot, DEFAULT_PLOT } from './ui/plot-ui';
import type { PlotSettings } from './core/sheets';
import { fmtThousands } from './core/units';
import { download, pickFile, stamp, safeName } from './ui/common';

// 3D 檢視用到 Three.js（約 150 KB），點開時才下載
const Terrain3D = lazy(() => import('./ui/Terrain3D'));

type SideTab = 'imp' | 'align' | 'layer' | 'design' | 'survey' | 'proj';
const SIDE_TABS: Array<[SideTab, string]> = [
  ['imp', '1. 匯入DXF'], ['align', '2. 平曲線/加樁'], ['layer', '3. 圖層/等高線'],
  ['design', '4. 縱橫斷與土方'], ['survey', '5. 測量計算'], ['proj', '6. 專案/出圖'],
];

const VIEWS: Array<[ViewMode, string]> = [['2D', '📐 1. 平面定線圖'], ['PROFILE', '📈 2. 縱斷面設計圖'], ['CROSS', '📊 3. 橫斷面設計圖'], ['3D', '🏔️ 4. 3D 地形模擬']];

const TOOL_HINT: Record<Tool, string> = {
  pan: '✋ 平移：左鍵拖曳平移、滾輪縮放、拖曳紅色 IP 點可直接改線、點選測點查看・F 飛回地形',
  axis: '📏 繪中心線：依序點 BP → IP → EP，雙擊／右鍵／Enter 完成，Esc 取消',
  addsta: '📍 圖面加樁：在中心線附近點一下，投影到中心線求樁號並以右側欄「點名」加樁',
  addpt: '➕ 補高程點：在圖上點一下新增測點（高程 0 = 取三角網內插）',
  flip: '🔄 翻網格：點選兩個三角形的共邊，改成另一條對角線（可再點一次翻回）',
  boundary: '畫計算範圍邊界：依序點選頂點，雙擊／右鍵／Enter 完成，Esc 取消',
};

/** 舊版教學的頁名對應到新版分頁與檢視 */
const GUIDE_MAP: Record<string, { tab: SideTab; view?: ViewMode }> = {
  project: { tab: 'proj' }, points: { tab: 'imp' }, survey: { tab: 'survey' }, sam: { tab: 'layer' }, terrain: { tab: 'layer' },
  grid: { tab: 'design' }, alignment: { tab: 'align' }, profile: { tab: 'design', view: 'PROFILE' }, section: { tab: 'design', view: 'CROSS' },
  plot: { tab: 'proj', view: 'SHEETS' }, export: { tab: 'proj' },
};

const round = (v: number) => Math.round(v * 1000) / 1000;

export default function App() {
  const p = useProject();
  const d = useDerived(p);
  const [tab, setTab] = useState<SideTab>('imp');
  const [view, setViewState] = useState<ViewMode>('2D');
  const [crossMode, setCrossMode] = useState<'GRID' | 'SINGLE'>('GRID');
  const [tool, setToolState] = useState<Tool>('pan');
  const [draft, setDraft] = useState<XY[]>([]);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [grid, setGrid] = useState<GridResult | null>(null);
  const [selectedSta, setSelectedSta] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ p: XY; z: number | null } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [focus, setFocus] = useState<{ x: number; y: number; key: number } | null>(null);
  const [cmd, setCmd] = useState<{ msg: string; tone?: 'ok' | 'warn' }>({ msg: '系統就緒。請匯入 DXF／CSV 地形，或載入示範河道地形。' });
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; tone?: 'ok' | 'warn' }>>([]);
  const [dxf, setDxf] = useState<{ name: string; data: DxfData } | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [importOpts, setImportOpts] = useState<ImportOpts>({ removeOutliers: true, densify: true, step: 5, csvOrder: 'PENZ', keepBackdrop: true });
  const [newPointZ, setNewPointZ] = useState(0);
  const [defaultR, setDefaultR] = useState(30);
  const [polyOnly, setPolyOnly] = useState(false);
  const [staName, setStaName] = useState('加樁');
  const [drawer, setDrawer] = useState<'legend' | 'adv' | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  const [surveyTool, setSurveyTool] = useState<SurveyTool>('ctl');
  const [guideOpen, setGuideOpen] = useState(false);
  const [plotS, setPlotS] = useState<PlotSettings>(DEFAULT_PLOT);
  const sheets = usePlot(p, d, plotS, view === 'SHEETS');
  const [stationIdx, setStationIdx] = useState(0);
  const [dragIps, setDragIps] = useState<IPInput[] | null>(null);
  const toastId = useRef(0);

  const survey = useMemo(() => computeSurvey(p.stations, p.controls), [p.stations, p.controls]);
  const trav = useMemo(() => computeTraverse(p.traverse, p.controls), [p.traverse, p.controls]);
  const lev = useMemo(() => computeLeveling(p.level), [p.level]);

  /** 狀態列 COMMAND 訊息；有語氣（ok／warn）時也跳出提示 */
  const status = useCallback((msg: string, tone?: 'ok' | 'warn') => {
    if (!msg) return;
    setCmd({ msg, tone });
    if (!tone) return;
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'warn' ? 6000 : 3500);
  }, []);
  const refit = useCallback(() => setFitKey(k => k + 1), []);
  const setView = (v: ViewMode) => {
    if (v === '3D' && !d.tin) { status('沒有三角網，無法顯示 3D 地形', 'warn'); return; }
    setViewState(v);
  };

  // 啟動：讀回上次的專案；第一次使用則載入示範資料
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    loadSaved().then(found => {
      if (!found) { replaceProject(demoProject()); setGuideOpen(true); status('第一次使用：已載入示範河道地形，可以跟著「範例教學」操作', 'ok'); }
      refit();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 地形或範圍變動後，舊的方格結果作廢
  useEffect(() => { setGrid(null); }, [d.tin, p.boundary, p.grid, d.profile]);

  const setTool = (t: Tool) => { setToolState(t); setDraft([]); };

  // 鍵盤：復原／重做、F 飛回地形、Esc 結束工具
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') { setViewState('2D'); refit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refit]);

  // 縱橫斷面檢視時自動選第一個樁
  useEffect(() => {
    if ((view === 'PROFILE' || view === 'CROSS') && selectedSta === null && d.stakeRows.length) setSelectedSta(d.stakeRows[0].stake.sta);
  }, [view, d.stakeRows, selectedSta]);

  // ---------------- 圖面操作 ----------------
  const onWorldClick = (w: XY) => {
    if (tool === 'boundary' || tool === 'axis') setDraft(dr => [...dr, w]);
    else if (tool === 'addpt') {
      const z = newPointZ !== 0 ? newPointZ : d.tin?.sample(w.x, w.y) ?? null;
      update(q => {
        const id = nextPointId(q.points);
        return { ...q, points: [...q.points, { id, name: `N${id}`, x: round(w.x), y: round(w.y), z: z === null ? null : round(z), code: 'ADD' }] };
      });
      status(`➕ 已補點 E ${w.x.toFixed(2)} N ${w.y.toFixed(2)} Z ${z === null ? '無高程' : z.toFixed(2)}`);
    } else if (tool === 'addsta') {
      if (!d.alignment) { status('請先繪製中心線', 'warn'); return; }
      const r = stationOf(d.alignment, w.x, w.y);
      if (r.sta <= d.alignment.startStation + 1e-6 || r.sta >= d.alignment.endStation - 1e-6) { status('點擊位置投影不到中心線範圍內', 'warn'); return; }
      status(A.addCustomStation(r.sta, staName));
    } else if (tool === 'flip') {
      if (!d.tin) return;
      const e = nearestSharedEdge(d.tin, w.x, w.y);
      if (!e) { status('找不到可翻轉的共邊', 'warn'); return; }
      update(q => ({ ...q, tin: { ...q.tin, flips: [...q.tin.flips, e] } }));
      status(`🔄 已翻轉共邊 (${e[0].toFixed(1)}, ${e[1].toFixed(1)}) — (${e[2].toFixed(1)}, ${e[3].toFixed(1)})`);
    }
  };

  const finishDraft = () => {
    const pts = draft.filter((q, i) => i === 0 || Math.hypot(q.x - draft[i - 1].x, q.y - draft[i - 1].y) > 1e-6).map(q => ({ x: round(q.x), y: round(q.y) }));
    if (tool === 'boundary') {
      if (pts.length < 3) { status('邊界至少要 3 個頂點', 'warn'); return; }
      patch('boundary', pts);
      status(`邊界完成：${pts.length} 個頂點`, 'ok');
    } else if (tool === 'axis') {
      if (pts.length < 2) { status('中心線至少要 BP 與 EP 兩點', 'warn'); return; }
      const R = polyOnly ? 0 : defaultR;
      const ips = pts.map((q, i) => ({
        name: i === 0 ? 'BP' : i === pts.length - 1 ? 'EP' : `IP${i}`,
        x: q.x, y: q.y,
        curve: i > 0 && i < pts.length - 1 && R > 0 ? { kind: 'R' as const, value: R } : null,
      }));
      update(q => ({ ...q, vpis: [], drops: [], alignment: { ...(q.alignment ?? { name: 'A', startStation: 0, interval: 20, minGap: 2 }), extraStations: [], ips } }));
      setSelectedSta(null);
      status(`📏 中心線完成：${ips.length - 2} 個 IP${R > 0 ? `，R=${R} m` : '（純折線）'}`, 'ok');
    }
    setToolState('pan');
    setDraft([]);
  };

  const onIpDrag = (i: number, w: XY, end: boolean) => {
    const al = p.alignment;
    if (!al) return;
    const next = al.ips.map((ip, k) => (k === i ? { ...ip, x: round(w.x), y: round(w.y) } : ip));
    if (end) { patch('alignment', { ...al, ips: next }); setDragIps(null); status(`✋ ${al.ips[i].name} 已移到 E ${w.x.toFixed(2)} N ${w.y.toFixed(2)}`); }
    else setDragIps(next);
  };
  const dragAl = useMemo(() => (dragIps && p.alignment ? buildAlignment({ ...p.alignment, ips: dragIps }) : null), [dragIps, p.alignment]);

  // ---------------- 檔案 ----------------
  const openDxf = async (file: File) => {
    try {
      const { text, encoding } = decodeDxf(await file.arrayBuffer());
      const data = parseDxf(text, encoding);
      if (!data.entities.length) { status('DXF 的 ENTITIES 區段沒有可用的圖元（二進位 DXF 或 DWG 無法讀取）', 'warn'); return; }
      setDxf({ name: file.name, data });
    } catch (e) { status(`DXF 讀取失敗：${(e as Error).message}`, 'warn'); }
  };

  const importFile = async (f: File) => {
    const ext = f.name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'dxf') { openDxf(f); return; }
    const buf = await f.arrayBuffer();
    if (ext === 'json' || ext === 'cwp') {
      try { const proj = normalizeProject(JSON.parse(decodeText(buf))); replaceProject(proj); setGrid(null); refit(); status(`已開啟專案「${proj.info.name}」`, 'ok'); }
      catch (e) { status(`無法開啟：${(e as Error).message}`, 'warn'); }
      return;
    }
    const r = parsePointText(decodeText(buf), importOpts.csvOrder, p.zRule);
    if (!r.points.length) { status('檔案裡沒有讀到座標，請確認 CSV 欄位順序', 'warn'); return; }
    update(q => ({ ...q, points: r.points.map((t, i) => ({ ...t, id: i + 1 })), boundary: null, backdrop: null }));
    setViewState('2D'); refit();
    const msg = `✅ ${f.name}：讀入 ${r.points.length} 點${r.nullZ ? `，其中 ${r.nullZ} 點無有效高程（紅點，不建網）` : ''}${r.skippedLines ? `，略過 ${r.skippedLines} 行` : ''}`;
    setDiag(msg); status(msg, 'ok');
  };
  const openFile = async () => { const f = await pickFile('.dxf,.csv,.txt,.pnt,.xyz,.dat,.json'); if (f) importFile(f); };

  // 開發模式測試用
  if (import.meta.env.DEV) Object.assign(window, { __openDxf: openDxf, __importFile: importFile });

  const exportDxf = () => download(`${safeName(p.info.name)}_${stamp()}.dxf`, buildDxf(p, d, grid, {
    sam: !!d.sam, points: true, labels: true, tin: false, contours: d.contours.length > 0, boundary: !!p.boundary,
    alignment: !!d.alignment, stakes: !!d.alignment, grid: !!grid, textHeight: 1,
  }), 'application/dxf');
  const exportCsv = () => {
    if (!d.volumes.length) { status('尚無土石方資料：請先建立中心線與地形', 'warn'); return; }
    download(`${safeName(p.info.name)}_土石方數量計算表_${stamp()}.csv`, volumeCsv(p, d), 'text/csv;charset=utf-8');
  };

  // ---------------- 面板 ----------------
  const sctx: SurveyCtx = { p, tool: surveyTool, setTool: setSurveyTool, survey, trav, lev, stationIdx: Math.min(stationIdx, Math.max(0, p.stations.length - 1)), setStationIdx, toast: status, refit };
  const pctx: PanelCtx = { p, d, grid, setGrid, toast: status, refit };
  const side: SideCtx = {
    p, d, tool, setTool, layers, setLayers, grid, setGrid, selectedSta, setSelectedSta, status, refit, openFile, importFile, diag,
    importOpts, setImportOpts, highlight,
    focusPoint: id => { const t = p.points.find(q => q.id === id); setHighlight(id); if (t) { setViewState('2D'); setFocus({ x: t.x, y: t.y, key: Date.now() }); status(`📍 ${t.name}：E ${t.x.toFixed(3)} N ${t.y.toFixed(3)} Z ${t.z === null ? '無高程' : t.z.toFixed(3)}`); } },
    setView, setCrossMode, defaultR, setDefaultR, staName, setStaName,
    showIpTable: () => { setLayers(l => ({ ...l, ipTable: true })); setViewState('2D'); status('📋 已召回圖面曲線表（可拖曳標題列移動）'); },
    openDrawer: m => { setDrawer(m); setDrawerOpen(true); setViewState('2D'); },
    newPointZ, setNewPointZ,
  };

  const overlays = useMemo<Overlay[]>(() => {
    if (tab !== 'survey') return [];
    if (surveyTool === 'trav' && trav.ok) return [{ pts: trav.points, color: '#ffe066', width: 2, labels: trav.points.map(q => q.name) }];
    if (surveyTool === 'book') {
      const out: Overlay[] = [];
      for (const st of survey.stations) {
        if (!st.ok || st.x === undefined) continue;
        for (const q of survey.points.filter(t => t.station === st.name)) out.push({ pts: [{ x: st.x, y: st.y! }, q], color: 'rgba(255,224,102,0.35)', width: 1 });
      }
      return out;
    }
    return [];
  }, [tab, surveyTool, trav, survey]);

  const drawerContent = view !== '2D' ? null
    : tab === 'survey' ? SurveyDrawer(sctx)
    : drawer === 'legend' ? { title: '圖例庫（地類碼對照）', body: <SamDrawer p={p} d={d} /> }
    : drawer === 'adv' ? { title: '橫斷面構造物組合設定', body: <AdvancedDrawer p={p} /> }
    : null;

  const al = dragAl ?? d.alignment;
  const last = d.volumes[d.volumes.length - 1];
  const W = p.template.widthL + p.template.widthR;
  const sideBody = (() => {
    switch (tab) {
      case 'imp': return <Tab1Import {...side} />;
      case 'align': return <Tab2Align {...side} />;
      case 'layer': return <Tab3Layers {...side} />;
      case 'design': return <Tab4Design {...side} />;
      case 'survey': return <SurveyPanel {...sctx} />;
      case 'proj': return (
        <>
          <ProjectPanel {...pctx} />
          <PlotPanel p={p} s={plotS} setS={setPlotS} sheets={sheets} toast={status} />
          <button type="button" className={`btn ${view === 'SHEETS' ? 'active' : 'primary'} wide`} onClick={() => setViewState(view === 'SHEETS' ? '2D' : 'SHEETS')}>{view === 'SHEETS' ? '關閉圖紙預覽' : '🖨 開啟圖紙預覽'}</button>
          <ExportPanel {...pctx} />
        </>
      );
    }
  })();

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden="true">{APP_SHORT.slice(0, 2)}</div>
          <div>
            <div className="brand-name">{APP_NAME}</div>
            <div className="brand-sub">{p.info.name || '未命名工程'}・v{APP_VERSION}</div>
          </div>
        </div>
        <button type="button" className="btn green" onClick={openFile} title="開啟 DXF、CSV／TXT 點檔或專案檔">📂 開啟 AutoCAD (.DXF/.CSV)</button>
        <div className="tgroup" role="group" aria-label="檢視模式">
          {VIEWS.map(([v, t]) => <button key={v} type="button" className={`btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{t}</button>)}
        </div>
        {view === '2D' && (
          <div className="tgroup" role="group" aria-label="平面工具">
            <button type="button" className="btn primary" onClick={refit} title="飛回地形主區（F）">🎯 尋找地形(F)</button>
            <button type="button" className={`btn ${tool === 'pan' ? 'active' : ''}`} onClick={() => setTool('pan')}>✋ 平移/改IP</button>
            <button type="button" className={`btn amber ${tool === 'axis' ? 'active' : ''}`} onClick={() => setTool(tool === 'axis' ? 'pan' : 'axis')}>📏 繪中心線</button>
            <span className="lbl">R</span>
            <input className="mini" type="number" min={0} value={defaultR} disabled={polyOnly} onChange={e => setDefaultR(Math.max(0, Number(e.target.value) || 0))} aria-label="預設半徑 R" />
            <button type="button" className={`btn ${polyOnly ? 'active' : ''}`} onClick={() => setPolyOnly(v => !v)} title="新繪中心線不設圓曲線（R=0）">純折線</button>
            <button type="button" className={`btn magenta ${tool === 'addsta' ? 'active' : ''}`} onClick={() => setTool(tool === 'addsta' ? 'pan' : 'addsta')}>📍 圖面點擊加樁</button>
            <button type="button" className={`btn ${tool === 'addpt' ? 'active' : ''}`} onClick={() => setTool(tool === 'addpt' ? 'pan' : 'addpt')}>➕ 補高程點</button>
            <button type="button" className={`btn ${tool === 'flip' ? 'active' : ''}`} onClick={() => { setTool(tool === 'flip' ? 'pan' : 'flip'); setLayers(l => ({ ...l, tin: true })); }}>🔄 翻網格</button>
          </div>
        )}
        <div className="tgroup" role="group" aria-label="匯出">
          <button type="button" className="btn" onClick={exportCsv}>📊 匯出報表(.CSV)</button>
          <button type="button" className="btn" onClick={exportDxf}>💾 匯出(.DXF)</button>
        </div>
        <div className="top-actions">
          <button type="button" className="guide-btn" onClick={() => setGuideOpen(true)}>範例教學</button>
          <button type="button" className="icon-btn" onClick={undo} title="復原（Ctrl+Z）" aria-label="復原">↶</button>
          <button type="button" className="icon-btn" onClick={redo} title="重做（Ctrl+Y）" aria-label="重做">↷</button>
        </div>
      </header>
      <div className={`main ${sideOpen ? '' : 'side-closed'}`}>
        <aside className="side">
          <nav className="side-tabs" aria-label="功能分頁">
            {SIDE_TABS.map(([k, t]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}
          </nav>
          <div className="side-body" key={tab === 'survey' ? `survey-${surveyTool}` : tab}>{sideBody}</div>
          <button type="button" className="btn ghost" style={{ margin: 6 }} onClick={() => setSideOpen(false)}>⟨ 收合側欄</button>
        </aside>
        {!sideOpen && <button type="button" className="side-reopen" onClick={() => setSideOpen(true)} aria-label="展開面板">⟩</button>}
        <div className="stage">
          <div className="plan">
            {view === '2D' && <>
              <PlanView
                points={p.points} zRule={p.zRule} tin={d.tin} contours={d.contours} boundary={p.boundary} backdrop={p.backdrop}
                controls={p.controls} overlays={overlays} sam={d.sam} legend={p.legend}
                alignment={al} road={{ L: p.template.widthL, R: p.template.widthR, half: p.sectionSample.halfWidth }}
                grid={grid} layers={layers} tool={tool} draft={draft} selectedSta={selectedSta}
                highlightPoint={highlight} fitKey={fitKey} focus={focus}
                onWorldClick={onWorldClick} onFinishDraft={finishDraft} onCancelDraft={() => { setDraft([]); setToolState('pan'); }}
                onCursor={(w, z) => setCursor(w ? { p: w, z } : null)}
                onPickPoint={id => { setHighlight(id); if (id !== null) { const t = p.points.find(q => q.id === id); if (t) status(`📍 ${t.name}：E ${t.x.toFixed(3)} N ${t.y.toFixed(3)} Z ${t.z === null ? '無高程' : t.z.toFixed(3)}`); } }}
                onIpDrag={onIpDrag}
              />
              <HudBadges lines={[
                { text: `📐 平面定線圖｜${fmtThousands(p.points.length, 0)} 點・${d.tin ? fmtThousands(d.tin.tri.length / 3, 0) : 0} 三角網・等高線 ${p.contour.interval}/${p.contour.interval * p.contour.majorEvery} m` },
                ...(al ? [{ text: `🛣 中心線 ${al.length.toFixed(1)} m・${Math.max(0, al.input.ips.length - 2)} IP・${d.stakeRows.length} 樁・W=${W} m` }] : [{ text: '尚未定線：按「📏 繪中心線」在圖上點 BP→IP→EP', tip: true }]),
                ...(d.tin?.warning ? [{ text: `⚠ ${d.tin.warning}`, tip: true }] : []),
              ]} />
              <HudLegend grid={!!grid && layers.grid} />
              {al && layers.ipTable && <IpOverlay al={al} onClose={() => setLayers(l => ({ ...l, ipTable: false }))} />}
              {tool !== 'pan' && <div className="tool-banner">{TOOL_HINT[tool]}{draft.length > 0 && `（已點 ${draft.length} 點）`}</div>}
            </>}
            {view === 'PROFILE' && (
              <ProfileFull d={d} vpis={A.currentVpis(p, d)} pf={p.pf} selectedSta={selectedSta} onSelect={setSelectedSta}
                onVipChange={(i, sta, z) => { const v = A.currentVpis(p, d); v[i] = { ...v[i], sta, z }; A.setVpis(v); }}
                onAddVip={(sta, z) => status(A.addVip(p, d, sta, z))}
                onRemoveVip={i => status(A.removeVip(p, d, i))}
                onAddDrop={sta => status(A.addDrop(sta, 2, '防砂壩'))}
                onAlignHeadTail={() => status(A.alignHeadTail(p, d))}
                status={m => status(m)} />
            )}
            {view === 'CROSS' && <CrossFull sections={d.sections} selectedSta={selectedSta} onSelect={setSelectedSta} mode={crossMode} setMode={setCrossMode} />}
            {view === '3D' && d.tin && (
              <Suspense fallback={<div className="view3d"><div className="empty">載入 3D 引擎中…</div></div>}>
                <Terrain3D tin={d.tin} alignment={d.alignment} profile={d.profile} sam={d.sam} legend={p.legend} controls={p.controls} onClose={() => setViewState('2D')} />
              </Suspense>
            )}
            {view === 'SHEETS' && <SheetViewer sheets={sheets} base={p.info.name || '出圖'} />}
          </div>
          {drawerContent && (
            <section className={`drawer ${drawerOpen ? '' : 'closed'}`}>
              <header className="drawer-head">
                <h3>{drawerContent.title}</h3>
                <span>
                  <button type="button" className="icon-btn" onClick={() => setDrawerOpen(o => !o)} aria-label={drawerOpen ? '收合' : '展開'}>{drawerOpen ? '▾' : '▴'}</button>
                  {tab !== 'survey' && <button type="button" className="icon-btn" onClick={() => setDrawer(null)} aria-label="關閉">✕</button>}
                </span>
              </header>
              {drawerOpen && <div className="drawer-body">{drawerContent.body}</div>}
            </section>
          )}
        </div>
      </div>
      <footer className="status">
        <span className="cmd"><span>COMMAND:</span><span className={cmd.tone === 'warn' ? 'warn' : ''}>{cmd.msg}</span></span>
        <span className="coords">
          <span>挖方: <b className="cut">{fmtThousands(last?.cumCut ?? 0, 0)}</b> m³</span>
          <span>填方: <b className="fill">{fmtThousands(last?.cumFill ?? 0, 0)}</b> m³</span>
          <span>E: <b>{cursor ? cursor.p.x.toFixed(3) : '—'}</b></span>
          <span>N: <b>{cursor ? cursor.p.y.toFixed(3) : '—'}</b></span>
          <span>Z: <b>{cursor && cursor.z !== null ? cursor.z.toFixed(3) : '—'}</b></span>
        </span>
      </footer>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.msg}</div>)}
      </div>
      {guideOpen && (
        <Guide onClose={() => setGuideOpen(false)} go={(nav: GuideNav, demo: boolean) => {
          if (demo) { replaceProject(demoProject()); setGrid(null); setSelectedSta(null); refit(); }
          const m = GUIDE_MAP[nav.tab] ?? { tab: nav.tab as SideTab };
          setTab(m.tab); setViewState(m.view ?? '2D');
          if (nav.sub) setSurveyTool(nav.sub as SurveyTool);
          setSideOpen(true); setGuideOpen(false);
        }} />
      )}
      {dxf && (
        <DxfDialog fileName={dxf.name} data={dxf.data} zRule={p.zRule} onCancel={() => setDxf(null)}
          init={{ densify: importOpts.densify ? importOpts.step : 0, removeOutliers: importOpts.removeOutliers, keepBackdrop: importOpts.keepBackdrop }}
          onImport={(pts, bdLayers) => {
            const bd = bdLayers ? dxfBackdrop(dxf.data, bdLayers) : null;
            update(q => ({ ...q, points: pts.map((t, i) => ({ ...t, id: i + 1 })), boundary: null, backdrop: bd && bd.items.length ? bd.items : null }));
            const zs = pts.filter(t => t.z !== null).map(t => t.z as number);
            const zr = zs.length ? `，高程 ${zs.reduce((a, b) => Math.min(a, b), Infinity).toFixed(2)}～${zs.reduce((a, b) => Math.max(a, b), -Infinity).toFixed(2)} m` : '';
            const msg = `✅ ${dxf.name}：匯入 ${fmtThousands(pts.length, 0)} 點${zr}${bd ? `，底圖 ${fmtThousands(bd.items.length, 0)} 條線${bd.truncated ? '（過多已截斷）' : ''}` : ''}`;
            setDxf(null); setTab('imp'); setViewState('2D'); refit(); setDiag(msg); status(msg, 'ok');
          }} />
      )}
    </div>
  );
}
