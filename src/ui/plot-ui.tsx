// 出圖：圖紙設定、預覽、輸出 PDF（列印）、SVG、DXF
import { useMemo, useState } from 'react';
import type { Project } from '../core/model';
import type { Derived } from '../store/derived';
import { buildSheets, sheetToSvg, PAPERS, DEFAULT_PLOT, type PlotSettings, type Sheet } from '../core/sheets';
import { DxfWriter } from '../io/dxf-write';
import { Card, TextField, Check, Btn, Note, download, stamp, safeName } from './common';

const SCALES = [100, 200, 250, 500, 1000, 1200, 2000, 2500, 5000];

export function usePlot(p: Project, d: Derived, s: PlotSettings, active: boolean) {
  return useMemo(() => (active ? buildSheets(p, d, s) : []), [active, p, d, s]);
}

export function PlotPanel(props: { p: Project; s: PlotSettings; setS(s: PlotSettings): void; sheets: Sheet[]; toast(m: string, t?: 'ok' | 'warn'): void }) {
  const { p, s, setS, sheets } = props;
  const set = (v: Partial<PlotSettings>) => setS({ ...s, ...v });
  const sel = (id: string, label: string, val: number, key: keyof PlotSettings) => (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <select id={id} value={val} onChange={e => set({ [key]: Number(e.target.value) } as Partial<PlotSettings>)}>
        {SCALES.map(v => <option key={v} value={v}>1/{v}</option>)}
      </select>
    </label>
  );
  const base = safeName(p.info.name);
  return (
    <>
      <Card title="圖紙">
        <label className="field" htmlFor="pl-paper">
          <span className="field-label">圖紙大小</span>
          <select id="pl-paper" value={s.paper} onChange={e => set({ paper: e.target.value as PlotSettings['paper'] })}>
            {Object.entries(PAPERS).map(([k, [w, h]]) => <option key={k} value={k}>{k}（{w}×{h} mm）</option>)}
          </select>
        </label>
        <TextField id="pl-org" label="設計單位" value={s.org} placeholder={p.info.owner} onChange={v => set({ org: v })} />
        <TextField id="pl-pre" label="圖號前綴" value={s.prefix} onChange={v => set({ prefix: v })} />
        <p className="hint">標題欄的工程名稱、設計者取自「專案」頁。</p>
      </Card>
      <Card title="圖面內容">
        <Check id="pl-plan" label="平面圖（依比例自動分幅）" checked={s.plan} onChange={v => set({ plan: v })} />
        {s.plan && (
          <>
            {sel('pl-ps', '平面圖比例', s.planScale, 'planScale')}
            <div className="chk-grid">
              <Check id="pl-ct" label="等高線" checked={s.contours} onChange={v => set({ contours: v })} />
              <Check id="pl-pt" label="高程點" checked={s.points} onChange={v => set({ points: v })} />
            </div>
          </>
        )}
        <Check id="pl-prof" label="縱斷面圖（含下方資料表）" checked={s.profile} onChange={v => set({ profile: v })} />
        {s.profile && <div className="two">{sel('pl-ph', '水平比例', s.profileH, 'profileH')}{sel('pl-pv', '垂直比例', s.profileV, 'profileV')}</div>}
        <Check id="pl-sec" label="橫斷面圖（依格排列）" checked={s.section} onChange={v => set({ section: v })} />
        {s.section && sel('pl-ss', '橫斷面比例', s.sectionScale, 'sectionScale')}
      </Card>
      <Card title="輸出" extra={<span className="badge">{sheets.length} 張</span>}>
        {!sheets.length && <Note tone="warn">沒有可出的圖。平面圖需要地形或中心線；縱橫斷面需要中心線、縱坡與地形。</Note>}
        <div className="btn-list">
          <Btn kind="primary" disabled={!sheets.length} onClick={() => printSheets(sheets, s.paper, props.toast)}>列印／另存 PDF（全部）</Btn>
          <Btn disabled={!sheets.length} onClick={() => download(`${base}_出圖_${stamp()}.dxf`, sheetsToDxf(sheets), 'application/dxf')}>下載 DXF（全部圖紙，mm 單位）</Btn>
        </div>
        <p className="hint">PDF：在列印視窗選「另存為 PDF」，紙張選 {s.paper}、橫向、邊界「無」。DXF 的每張圖紙並排放在模型空間，單位為公釐。</p>
      </Card>
    </>
  );
}

export function SheetViewer({ sheets, base }: { sheets: Sheet[]; base: string }) {
  const [i, setI] = useState(0);
  const idx = Math.min(i, Math.max(0, sheets.length - 1));
  const sh = sheets[idx];
  const svg = useMemo(() => (sh ? sheetToSvg(sh) : ''), [sh]);
  if (!sh) return <div className="sheet-viewer"><div className="empty">設定好左側的圖面內容後，這裡會顯示圖紙預覽。</div></div>;
  return (
    <div className="sheet-viewer">
      <div className="sheet-bar">
        <button type="button" className="btn" disabled={idx === 0} onClick={() => setI(idx - 1)}>◀</button>
        <span>{idx + 1} / {sheets.length}　{sh.title}　{sh.scale}</span>
        <button type="button" className="btn" disabled={idx >= sheets.length - 1} onClick={() => setI(idx + 1)}>▶</button>
        <button type="button" className="btn" onClick={() => download(`${base}_${sh.title.replace(/[（）～／\s]/g, '_')}.svg`, svg, 'image/svg+xml')}>下載這張 SVG</button>
      </div>
      <div className="sheet-paper" dangerouslySetInnerHTML={{ __html: svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%" height="100%"') }} />
    </div>
  );
}

function printSheets(sheets: Sheet[], paper: string, toast: (m: string, t?: 'ok' | 'warn') => void) {
  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器擋住了新視窗，請允許此網站開啟彈出式視窗後再試', 'warn'); return; }
  const [pw, ph] = PAPERS[paper];
  w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>出圖</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap" rel="stylesheet">
<style>@page{size:${pw}mm ${ph}mm;margin:0}html,body{margin:0;background:#888}.pg{width:${pw}mm;height:${ph}mm;page-break-after:always;background:#fff;margin:0 auto 8mm}.pg svg{display:block}@media print{body{background:#fff}.pg{margin:0}}</style></head>
<body>${sheets.map(s => `<div class="pg">${sheetToSvg(s)}</div>`).join('')}<script>document.fonts.ready.then(function(){setTimeout(function(){window.print()},300)})</script></body></html>`);
  w.document.close();
}

export function sheetsToDxf(sheets: Sheet[]): string {
  const w = new DxfWriter();
  let ox = 0;
  for (const sh of sheets) {
    for (const q of sh.prims) {
      if (q.k === 'line') {
        if (q.pts.length < 2) continue;
        w.polyline(q.layer, q.pts.map(p => ({ x: p.x + ox, y: p.y })), !!q.closed);
      } else if (q.k === 'circle') w.circle(q.layer, q.x + ox, q.y, q.r);
      else w.text(q.layer, q.x + ox, q.y, q.h, q.s, q.rot ?? 0, 0, q.anchor === 'middle' ? 1 : q.anchor === 'end' ? 2 : 0);
    }
    ox += sh.w + 30;
  }
  return w.toString();
}

export { DEFAULT_PLOT };
