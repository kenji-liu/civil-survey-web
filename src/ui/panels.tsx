// 共用面板：專案、匯出，以及 IP 座標法／偏角法表格
import { useMemo, useState } from 'react';
import type { Project } from '../core/model';
import { newProject, normalizeProject } from '../core/model';
import type { Derived } from '../store/derived';
import type { XY } from '../core/geom';
import { azimuth, dist, wrapPi } from '../core/geom';
import type { GridResult } from '../core/earthwork-grid';
import type { CurveKind, CurveSpec, IPInput } from '../core/alignment';
import { deflectionToIPs } from '../core/alignment';
import { DEG, degToDmsNumber } from '../core/units';
import { update, replaceProject, useSaveStatus } from '../store/store';
import { demoProject } from '../store/demo';
import { decodeText } from '../io/csv';
import { buildDxf, pointsCsv, gridCsv, curveCsv, stakeCsv, volumeCsv, type DxfLayersOpt } from '../io/exports';
import { Card, NumField, TextField, Check, Btn, Note, download, pickFile, stamp, safeName } from './common';

export interface PanelCtx {
  p: Project;
  d: Derived;
  grid: GridResult | null;
  setGrid(g: GridResult | null): void;
  toast(msg: string, tone?: 'ok' | 'warn'): void;
  refit(): void;
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
          <li><b>1. 匯入DXF</b>：開啟 DXF 地形圖或 CSV 點檔，濾除異常高程</li>
          <li><b>2. 平曲線/加樁</b>：圖上點繪中心線、拖曳 IP 改線、圖面加樁</li>
          <li><b>3. 圖層/等高線</b>：圖層開關、三角網邊界、翻網格、自動連線</li>
          <li><b>4. 縱橫斷與土方</b>：VIP 變坡、防砂壩落差、規範檢查、土方</li>
          <li><b>5. 測量計算</b>：控制點、手簿、導線、水準、交會、轉換</li>
          <li><b>6. 專案/出圖</b>：圖紙出圖、DXF 與 CSV 匯出、專案檔</li>
        </ol>
      </Card>
    </>
  );
}


export function convexHull(pts: XY[]): XY[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (s.length < 3) return [];
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [], upper: XY[] = [];
  for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of s.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(p => ({ x: p.x, y: p.y }));
}


// ---------------- 平曲線 ----------------
const KINDS: Array<[CurveKind, string]> = [['R', '半徑 R'], ['T', '切線長 T'], ['L', '曲線長 L'], ['E', '外矢距 E']];

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

export function CellNum({ value, onChange, disabled, digits }: { value: number; onChange(v: number): void; disabled?: boolean; digits?: number }) {
  const shown = digits !== undefined ? value.toFixed(digits) : String(value);
  const [t, setT] = useState<string | null>(null);
  return (
    <input className="cell" type="text" inputMode="decimal" disabled={disabled} value={t ?? shown}
      onChange={e => setT(e.target.value)}
      onBlur={() => { if (t !== null) { const v = Number(t); if (t.trim() !== '' && isFinite(v)) onChange(v); setT(null); } }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

export function CellText({ value, onChange }: { value: string; onChange(v: string): void }) {
  const [t, setT] = useState<string | null>(null);
  return (
    <input className="cell" type="text" value={t ?? value}
      onChange={e => setT(e.target.value)}
      onBlur={() => { if (t !== null) { onChange(t); setT(null); } }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

export function CoordTable({ ips, onChange }: { ips: IPInput[]; onChange(ips: IPInput[]): void }) {
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
          <thead><tr><th>點名</th><th>E (X)</th><th>N (Y)</th><th>曲線要素</th><th>數值</th><th>緩和 Ls</th><th /></tr></thead>
          <tbody>
            {ips.map((q, i) => (
              <tr key={i}>
                <td><CellText value={q.name} onChange={v => set(i, { name: v })} /></td>
                <td><CellNum value={q.x} digits={3} onChange={v => set(i, { x: v })} /></td>
                <td><CellNum value={q.y} digits={3} onChange={v => set(i, { y: v })} /></td>
                <CurveCell curve={q.curve} disabled={i === 0 || i === ips.length - 1} onChange={cv => set(i, { curve: cv })} />
                <td>{i === 0 || i === ips.length - 1 || !q.curve ? <span className="muted">—</span> : <CellNum value={q.ls ?? 0} onChange={v => set(i, { ls: v > 0 ? v : 0 })} />}</td>
                <td><button type="button" className="x" aria-label="刪除此列" onClick={() => onChange(ips.filter((_, k) => k !== i))}>×</button></td>
              </tr>
            ))}
            {!ips.length && <tr><td colSpan={7}>尚無資料，按「新增一列」開始輸入 BP。</td></tr>}
          </tbody>
        </table>
      </div>
      <Btn onClick={add}>新增一列</Btn>
      <p className="hint">第一列為起點 BP、最後一列為終點 EP。曲線要素給 R、T、L、E 其中一項即可，其餘自動計算。填緩和曲線長 Ls 會在圓曲線兩側加對稱的克羅梭曲線（樁號為 TS、SC、CS、ST）。</p>
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

export function DeflTable({ ips, onApply }: { ips: IPInput[]; onApply(ips: IPInput[]): void }) {
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
        <Btn kind="primary" onClick={() => onApply(deflectionToIPs(bp, rows).map(q => ({ ...q, ls: ips.find(o => o.name === q.name)?.ls })))}>計算並套用</Btn>
      </div>
      <p className="hint">角度用 ddd.mmss 寫法（13.0257 = 13°02′57″）。BP 列填 BP→IP1 的方位角；各 IP 列填偏角，右偏為正、左偏為負。</p>
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
