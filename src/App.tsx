import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { XY } from './core/geom';
import { nextPointId } from './core/model';
import type { GridResult } from './core/earthwork-grid';
import { useProject, update, patch, undo, redo, loadSaved, replaceProject } from './store/store';
import { useDerived } from './store/derived';
import { demoProject } from './store/demo';
import { PlanView, type Tool, type Layers } from './ui/PlanView';
import { ProfileChart, SectionChart } from './ui/Charts';
import { DxfDialog } from './ui/DxfDialog';
import { PointTable, StakeTable, VolumeTable, GridTable } from './ui/tables';
import { ProjectPanel, PointsPanel, TerrainPanel, GridPanel, AlignmentPanel, ProfilePanel, SectionPanel, ExportPanel, type PanelCtx } from './ui/panels';
import { decodeDxf, parseDxf, type DxfData } from './io/dxf-read';
import { APP_NAME, APP_SHORT, APP_VERSION } from './config';
import { SurveyPanel, SurveyDrawer, type SurveyTool, type SurveyCtx } from './ui/survey-ui';
import { computeSurvey } from './core/survey';
import { computeTraverse } from './core/traverse';
import { computeLeveling } from './core/leveling';
import type { Overlay } from './ui/PlanView';
import { SamPanel, SamDrawer } from './ui/sam-ui';
import { Guide, type GuideNav } from './ui/Guide';
import { AdvancedDrawer } from './ui/design-ui';
import { PlotPanel, SheetViewer, usePlot, DEFAULT_PLOT } from './ui/plot-ui';
import type { PlotSettings } from './core/sheets';

// 3D 檢視用到 Three.js（約 150 KB），點開時才下載
const Terrain3D = lazy(() => import('./ui/Terrain3D'));

type Tab = 'project' | 'survey' | 'points' | 'sam' | 'terrain' | 'grid' | 'alignment' | 'profile' | 'section' | 'plot' | 'export';
const TABS: Array<[Tab, string]> = [
  ['project', '專案'], ['survey', '測量計算'], ['points', '測點'], ['sam', '自動連線'], ['terrain', '地形'], ['grid', '方格土方'],
  ['alignment', '平曲線'], ['profile', '縱斷面'], ['section', '橫斷面'], ['plot', '出圖'], ['export', '匯出'],
];

const TOOL_HINT: Record<Tool, string> = {
  pan: '拖曳平移・滾輪縮放・點選測點查看・F 全圖',
  boundary: '畫邊界：依序點選頂點，雙擊／右鍵／Enter 完成，Esc 取消',
  ip: '圖上定線：依序點 BP、IP、EP，雙擊／右鍵／Enter 完成，Esc 取消',
  addpt: '補點：在圖上點一下新增測點',
  measure: '',
};

export default function App() {
  const p = useProject();
  const d = useDerived(p);
  const [tab, setTab] = useState<Tab>('project');
  const [tool, setToolState] = useState<Tool>('pan');
  const [draft, setDraft] = useState<XY[]>([]);
  const [layers, setLayers] = useState<Layers>({ points: true, labels: true, tin: false, contours: true, contourLabels: true, boundary: true, alignment: true, stakes: true, grid: true, sam: true });
  const [grid, setGrid] = useState<GridResult | null>(null);
  const [selectedSta, setSelectedSta] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ p: XY; z: number | null } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; tone?: 'ok' | 'warn' }>>([]);
  const [dxf, setDxf] = useState<{ name: string; data: DxfData; append: boolean } | null>(null);
  const [newPointZ, setNewPointZ] = useState(0);
  const [defaultRadius, setDefaultRadius] = useState(30);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  const [surveyTool, setSurveyTool] = useState<SurveyTool>('ctl');
  const [view3d, setView3d] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [secSub, setSecSub] = useState<'chart' | 'adv'>('chart');
  const [plotS, setPlotS] = useState<PlotSettings>(DEFAULT_PLOT);
  const sheets = usePlot(p, d, plotS, tab === 'plot');
  const [stationIdx, setStationIdx] = useState(0);
  const toastId = useRef(0);

  // 測量計算結果（輸入變動時重算）
  const survey = useMemo(() => computeSurvey(p.stations, p.controls), [p.stations, p.controls]);
  const trav = useMemo(() => computeTraverse(p.traverse, p.controls), [p.traverse, p.controls]);
  const lev = useMemo(() => computeLeveling(p.level), [p.level]);

  const toast = useCallback((msg: string, tone?: 'ok' | 'warn') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'warn' ? 6000 : 3500);
  }, []);
  const refit = useCallback(() => setFitKey(k => k + 1), []);

  // 啟動：讀回上次的專案；第一次使用則載入示範資料
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    loadSaved().then(found => {
      if (!found) { replaceProject(demoProject()); setGuideOpen(true); toast('第一次使用：已載入示範資料，可以跟著「範例教學」操作', 'ok'); }
      refit();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 地形或範圍變動後，舊的方格結果作廢
  useEffect(() => { setGrid(null); }, [d.tin, p.boundary, p.grid]);

  const setTool = (t: Tool) => { setToolState(t); setDraft([]); };

  // 鍵盤：復原／重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 切到橫斷面時自動選第一個樁
  useEffect(() => {
    if ((tab === 'section' || tab === 'profile') && selectedSta === null && d.stakeRows.length) setSelectedSta(d.stakeRows[0].stake.sta);
  }, [tab, d.stakeRows, selectedSta]);

  const onWorldClick = (w: XY) => {
    if (tool === 'boundary' || tool === 'ip') setDraft(dr => [...dr, w]);
    else if (tool === 'addpt') {
      update(q => {
        const id = nextPointId(q.points);
        return { ...q, points: [...q.points, { id, name: `N${id}`, x: round(w.x), y: round(w.y), z: newPointZ, code: 'ADD' }] };
      });
    }
  };

  const finishDraft = () => {
    const pts = draft.filter((q, i) => i === 0 || Math.hypot(q.x - draft[i - 1].x, q.y - draft[i - 1].y) > 1e-6).map(q => ({ x: round(q.x), y: round(q.y) }));
    if (tool === 'boundary') {
      if (pts.length < 3) { toast('邊界至少要 3 個頂點', 'warn'); return; }
      patch('boundary', pts);
      toast(`邊界完成：${pts.length} 個頂點`, 'ok');
    } else if (tool === 'ip') {
      if (pts.length < 2) { toast('中心線至少要 BP 與 EP 兩點', 'warn'); return; }
      const ips = pts.map((q, i) => ({
        name: i === 0 ? 'BP' : i === pts.length - 1 ? 'EP' : `IP${i}`,
        x: q.x, y: q.y,
        curve: i > 0 && i < pts.length - 1 && defaultRadius > 0 ? { kind: 'R' as const, value: defaultRadius } : null,
      }));
      update(q => ({ ...q, alignment: { ...(q.alignment ?? { name: 'A', startStation: 0, interval: 20, minGap: 2, extraStations: [] }), ips } }));
      setSelectedSta(null);
      toast(`中心線完成：${ips.length - 2} 個 IP`, 'ok');
    }
    setToolState('pan');
    setDraft([]);
  };

  const openDxf = async (file: File, append: boolean) => {
    try {
      const { text, encoding } = decodeDxf(await file.arrayBuffer());
      const data = parseDxf(text, encoding);
      if (!data.entities.length) { toast('DXF 的 ENTITIES 區段沒有可用的圖元（二進位 DXF 或 DWG 無法讀取）', 'warn'); return; }
      setDxf({ name: file.name, data, append });
    } catch (e) { toast(`DXF 讀取失敗：${(e as Error).message}`, 'warn'); }
  };

  // 開發模式測試用：可從主控台直接開 DXF 匯入對話框
  if (import.meta.env.DEV) (window as unknown as { __openDxf: typeof openDxf }).__openDxf = openDxf;

  const ctx: PanelCtx = {
    p, d, tool, setTool, grid, setGrid, selectedSta, setSelectedSta, layers, setLayers, toast, refit, openDxf,
    newPointZ, setNewPointZ, defaultRadius, setDefaultRadius,
  };

  const sctx: SurveyCtx = { p, tool: surveyTool, setTool: setSurveyTool, survey, trav, lev, stationIdx: Math.min(stationIdx, Math.max(0, p.stations.length - 1)), setStationIdx, toast, refit };

  // 平面圖疊加：測量計算頁顯示導線、觀測方向
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

  const drawer = (() => {
    switch (tab) {
      case 'survey': return SurveyDrawer(sctx);
      case 'sam': return { title: '圖例庫（地類碼對照）', body: <SamDrawer p={p} d={d} /> };
      case 'points': return { title: '測點座標表', body: <PointTable p={p} highlight={highlight} onPick={id => setHighlight(id)} /> };
      case 'grid': return { title: '方格法計算表', body: <GridTable g={grid} /> };
      case 'alignment': return { title: '樁號座標表', body: <StakeTable d={d} selected={selectedSta} onSelect={setSelectedSta} /> };
      case 'profile': return {
        title: '縱斷面圖（點選樁號）', body: (
          <div className="split2">
            <ProfileChart groundLine={d.groundLine} profile={d.profile} stakeRows={d.stakeRows} selectedSta={selectedSta} onSelect={setSelectedSta} />
            <StakeTable d={d} selected={selectedSta} onSelect={setSelectedSta} compact />
          </div>
        ),
      };
      case 'section': return {
        title: '橫斷面圖與土石方數量表', body: p.advanced.enabled && secSub === 'adv' ? (
          <div className="drawer-sub">
            <div className="seg seg-2 small-seg"><button type="button" onClick={() => setSecSub('chart')}>斷面圖與土方</button><button type="button" className="on">組合設定</button></div>
            <AdvancedDrawer p={p} />
          </div>
        ) : (
          <div className={p.advanced.enabled ? 'drawer-sub' : 'split2'}>
            {p.advanced.enabled && <div className="seg seg-2 small-seg"><button type="button" className="on">斷面圖與土方</button><button type="button" onClick={() => setSecSub('adv')}>組合設定</button></div>}
            <div className="split2">
            <SectionChart row={d.sections.find(s => selectedSta !== null && Math.abs(s.stake.sta - selectedSta) < 1e-6) ?? null} />
            <VolumeTable d={d} selected={selectedSta} onSelect={setSelectedSta} />
            </div>
          </div>
        ),
      };
      default: return null;
    }
  })();

  const Panel = { project: ProjectPanel, survey: ProjectPanel, sam: ProjectPanel, plot: ProjectPanel, points: PointsPanel, terrain: TerrainPanel, grid: GridPanel, alignment: AlignmentPanel, profile: ProfilePanel, section: SectionPanel, export: ExportPanel }[tab];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden="true">{APP_SHORT.slice(0, 2)}</div>
          <div>
            <div className="brand-name">{APP_NAME}</div>
            <div className="brand-sub">{p.info.name || '未命名工程'}</div>
          </div>
        </div>
        <nav className="tabs" aria-label="功能">
          {TABS.map(([k, t], i) => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setSideOpen(true); }}>
              <span className="tab-no">{i}</span>{t}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button type="button" className="guide-btn" onClick={() => setGuideOpen(true)}>範例教學</button>
          <button type="button" className="icon-btn" onClick={undo} title="復原（Ctrl+Z）" aria-label="復原">↶</button>
          <button type="button" className="icon-btn" onClick={redo} title="重做（Ctrl+Y）" aria-label="重做">↷</button>
        </div>
      </header>
      <div className={`main ${sideOpen ? '' : 'side-closed'}`}>
        <aside className="side">
          <div className="side-head">
            <h2>{TABS.find(t => t[0] === tab)![1]}</h2>
            <button type="button" className="icon-btn" onClick={() => setSideOpen(false)} aria-label="收合面板" title="收合面板">⟨</button>
          </div>
          <div className="side-body" key={tab === 'survey' ? `survey-${surveyTool}` : tab}>{tab === 'survey' ? <SurveyPanel {...sctx} /> : tab === 'sam' ? <SamPanel p={p} d={d} toast={toast} /> : tab === 'plot' ? <PlotPanel p={p} s={plotS} setS={setPlotS} sheets={sheets} toast={toast} /> : <Panel {...ctx} />}</div>
        </aside>
        {!sideOpen && <button type="button" className="side-reopen" onClick={() => setSideOpen(true)} aria-label="展開面板">⟩</button>}
        <div className="stage">
          <div className="plan">
            {tab === 'plot' && <SheetViewer sheets={sheets} base={p.info.name || '出圖'} />}
            <PlanView
              points={p.points} zRule={p.zRule} tin={d.tin} contours={layers.contours ? d.contours : []} boundary={p.boundary}
              controls={p.controls} overlays={overlays} sam={d.sam} legend={p.legend}
              alignment={d.alignment} grid={grid} layers={layers} tool={tool} draft={draft} selectedSta={selectedSta}
              highlightPoint={highlight} fitKey={fitKey}
              onWorldClick={onWorldClick} onFinishDraft={finishDraft} onCancelDraft={() => { setDraft([]); setToolState('pan'); }}
              onCursor={(w, z) => setCursor(w ? { p: w, z } : null)}
              onPickPoint={id => { setHighlight(id); if (id !== null && tab !== 'points') { const pt = p.points.find(t => t.id === id); if (pt) toast(`點 ${pt.name}：E ${pt.x.toFixed(3)}  N ${pt.y.toFixed(3)}  Z ${pt.z === null ? '無高程' : pt.z.toFixed(3)}`); } }}
            />
            {!view3d && <button type="button" className="btn primary btn-3d" onClick={() => { if (d.tin) setView3d(true); else toast('沒有三角網，無法顯示 3D 地形', 'warn'); }} title="3D 地形模擬">3D</button>}
            {view3d && d.tin && (
              <Suspense fallback={<div className="view3d"><div className="empty">載入 3D 引擎中…</div></div>}>
                <Terrain3D tin={d.tin} alignment={d.alignment} profile={d.profile} sam={d.sam} legend={p.legend} controls={p.controls} onClose={() => setView3d(false)} />
              </Suspense>
            )}
            {tool !== 'pan' && <div className="tool-banner">{TOOL_HINT[tool]}{draft.length > 0 && `（已點 ${draft.length} 點）`}</div>}
            {!view3d && <div className="legend">
              <span><i className="lg pt" />測點</span><span><i className="lg null" />無高程</span>
              <span><i className="lg cont" />等高線</span><span><i className="lg axis" />中心線</span>
              {grid && <><span><i className="lg cut" />挖方</span><span><i className="lg fill" />填方</span></>}
            </div>}
          </div>
          {drawer && (
            <section className={`drawer ${drawerOpen ? '' : 'closed'}`}>
              <header className="drawer-head">
                <h3>{drawer.title}</h3>
                <button type="button" className="icon-btn" onClick={() => setDrawerOpen(o => !o)} aria-label={drawerOpen ? '收合' : '展開'}>{drawerOpen ? '▾' : '▴'}</button>
              </header>
              {drawerOpen && <div className="drawer-body">{drawer.body}</div>}
            </section>
          )}
        </div>
      </div>
      <footer className="status">
        <span className="hint-txt">{TOOL_HINT[tool]}</span>
        <span className="coords">
          {cursor ? <>E {cursor.p.x.toFixed(3)}　N {cursor.p.y.toFixed(3)}　Z {cursor.z === null ? '—' : cursor.z.toFixed(3)}</> : '—'}
        </span>
        <span className="muted">{p.points.length} 點・{d.tin ? d.tin.tri.length / 3 : 0} 三角形・v{APP_VERSION}</span>
      </footer>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.msg}</div>)}
      </div>
      {guideOpen && (
        <Guide onClose={() => setGuideOpen(false)} go={(nav: GuideNav, demo: boolean) => {
          if (demo) { replaceProject(demoProject()); setGrid(null); setSelectedSta(null); refit(); }
          setTab(nav.tab as Tab);
          if (nav.sub) setSurveyTool(nav.sub as SurveyTool);
          setSideOpen(true); setView3d(false); setGuideOpen(false);
        }} />
      )}
      {dxf && (
        <DxfDialog fileName={dxf.name} data={dxf.data} zRule={p.zRule} onCancel={() => setDxf(null)}
          onImport={pts => {
            const append = dxf.append;
            update(q => {
              let id = append ? nextPointId(q.points) : 1;
              const mapped = pts.map(t => ({ ...t, id: id++ }));
              return { ...q, points: append ? [...q.points, ...mapped] : mapped, boundary: append ? q.boundary : null };
            });
            setDxf(null); setTab('terrain'); refit();
            toast(`已匯入 ${pts.length} 點`, 'ok');
          }} />
      )}
    </div>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;
