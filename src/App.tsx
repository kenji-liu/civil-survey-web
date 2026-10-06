import { useCallback, useEffect, useRef, useState } from 'react';
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

type Tab = 'project' | 'points' | 'terrain' | 'grid' | 'alignment' | 'profile' | 'section' | 'export';
const TABS: Array<[Tab, string]> = [
  ['project', '專案'], ['points', '測點'], ['terrain', '地形'], ['grid', '方格土方'],
  ['alignment', '平曲線'], ['profile', '縱斷面'], ['section', '橫斷面'], ['export', '匯出'],
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
  const [layers, setLayers] = useState<Layers>({ points: true, labels: true, tin: false, contours: true, contourLabels: true, boundary: true, alignment: true, stakes: true, grid: true });
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
  const toastId = useRef(0);

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
      if (!found) { replaceProject(demoProject()); toast('第一次使用：已載入示範資料，可在「專案」頁建立新專案', 'ok'); }
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

  const drawer = (() => {
    switch (tab) {
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
        title: '橫斷面圖與土石方數量表', body: (
          <div className="split2">
            <SectionChart row={d.sections.find(s => selectedSta !== null && Math.abs(s.stake.sta - selectedSta) < 1e-6) ?? null} />
            <VolumeTable d={d} selected={selectedSta} onSelect={setSelectedSta} />
          </div>
        ),
      };
      default: return null;
    }
  })();

  const Panel = { project: ProjectPanel, points: PointsPanel, terrain: TerrainPanel, grid: GridPanel, alignment: AlignmentPanel, profile: ProfilePanel, section: SectionPanel, export: ExportPanel }[tab];

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
          <div className="side-body"><Panel {...ctx} /></div>
        </aside>
        {!sideOpen && <button type="button" className="side-reopen" onClick={() => setSideOpen(true)} aria-label="展開面板">⟩</button>}
        <div className="stage">
          <div className="plan">
            <PlanView
              points={p.points} zRule={p.zRule} tin={d.tin} contours={layers.contours ? d.contours : []} boundary={p.boundary}
              alignment={d.alignment} grid={grid} layers={layers} tool={tool} draft={draft} selectedSta={selectedSta}
              highlightPoint={highlight} fitKey={fitKey}
              onWorldClick={onWorldClick} onFinishDraft={finishDraft} onCancelDraft={() => { setDraft([]); setToolState('pan'); }}
              onCursor={(w, z) => setCursor(w ? { p: w, z } : null)}
              onPickPoint={id => { setHighlight(id); if (id !== null && tab !== 'points') { const pt = p.points.find(t => t.id === id); if (pt) toast(`點 ${pt.name}：E ${pt.x.toFixed(3)}  N ${pt.y.toFixed(3)}  Z ${pt.z === null ? '無高程' : pt.z.toFixed(3)}`); } }}
            />
            {tool !== 'pan' && <div className="tool-banner">{TOOL_HINT[tool]}{draft.length > 0 && `（已點 ${draft.length} 點）`}</div>}
            <div className="legend">
              <span><i className="lg pt" />測點</span><span><i className="lg null" />無高程</span>
              <span><i className="lg cont" />等高線</span><span><i className="lg axis" />中心線</span>
              {grid && <><span><i className="lg cut" />挖方</span><span><i className="lg fill" />填方</span></>}
            </div>
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
