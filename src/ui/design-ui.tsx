// v1.0：超高加寬設定、進階組合斷面編輯、構造物單元說明
import { useState } from 'react';
import type { Project } from '../core/model';
import type { Derived } from '../store/derived';
import { VEHICLES, rMin, rNoSuper, gradeRate, type RoadwaySettings } from '../core/superelev';
import { BUILTIN_UNITS, simpleToAdvanced, type TemplateItem, type LookupTable, type StructUnit } from '../core/section-adv';
import { checkSyntax, evaluate } from '../core/expr';
import { formatStation } from '../core/units';
import { patch } from '../store/store';
import { Card, NumField, Check, Btn, Note, Kpi } from './common';
import { EditTable, type Col } from './EditTable';

// ---------------- 超高與加寬 ----------------
export function RoadwayCard({ p, d }: { p: Project; d: Derived }) {
  const r = p.roadway;
  const set = (v: Partial<RoadwaySettings>) => patch('roadway', { ...r, ...v });
  const rm = rMin(r.speed, r.emax);
  return (
    <Card title="超高與加寬" extra={<Check id="rw-on" label="啟用" checked={r.enabled} onChange={v => set({ enabled: v })} />}>
      <p className="hint">依《公路路線設計規範》：e = Vd²/(127R) − f，介於正常路拱與最大超高之間；以中心線為軸漸變。加寬依 AASHTO 公式，小於 0.5 m 免設，加在曲線內側。</p>
      {r.enabled && (
        <>
          <div className="two">
            <NumField id="rw-v" label="設計速率 Vd" value={r.speed} unit="km" min={20} max={120} onChange={v => set({ speed: v })} />
            <label className="field" htmlFor="rw-emax">
              <span className="field-label">最大超高</span>
              <select id="rw-emax" value={r.emax} onChange={e => set({ emax: Number(e.target.value) })}>
                {[0.04, 0.06, 0.08, 0.1].map(v => <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>)}
              </select>
            </label>
          </div>
          <div className="two">
            <NumField id="rw-c" label="正常路拱" value={r.crown} unit="%" min={0} onChange={v => set({ crown: v })} />
            <NumField id="rw-tp" label="漸變段在直線比例" value={r.tangentPct} unit="%" min={50} max={100} onChange={v => set({ tangentPct: v })} />
          </div>
          <div className="two">
            <NumField id="rw-n" label="車道數 N" value={r.lanes} min={1} onChange={v => set({ lanes: Math.round(v) })} />
            <NumField id="rw-w" label="車道寬" value={r.laneWidth} unit="m" min={2} onChange={v => set({ laneWidth: v })} />
          </div>
          <div className="two">
            <label className="field" htmlFor="rw-veh">
              <span className="field-label">設計車輛</span>
              <select id="rw-veh" value={r.vehicle} onChange={e => set({ vehicle: e.target.value as RoadwaySettings['vehicle'] })}>
                {VEHICLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
            <label className="field" htmlFor="rw-gr">
              <span className="field-label">漸變率</span>
              <select id="rw-gr" value={r.grade} onChange={e => set({ grade: e.target.value as 'rec' | 'max' })}>
                <option value="rec">建議值 1/{Math.round(1 / gradeRate(r.speed, 'rec'))}</option>
                <option value="max">容許最大 1/{Math.round(1 / gradeRate(r.speed, 'max'))}</option>
              </select>
            </label>
          </div>
          <Check id="rw-wd" label="計算曲線加寬" checked={r.widening} onChange={v => set({ widening: v })} />
          <p className="hint">Vd={r.speed} km/h：最小半徑 {rm ?? '不適用'} m、免設超高半徑 {rNoSuper(r.speed)} m。</p>
          {d.roadway && (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>IP</th><th>R</th><th>超高 e</th><th>加寬 ΔW</th><th>漸變長</th><th>全超高</th></tr></thead>
                <tbody>
                  {d.roadway.curves.map((c, i) => (
                    <tr key={i}><td>{c.name}</td><td>{c.R.toFixed(1)}</td><td>{(c.e * 100).toFixed(1)}%</td><td>{c.dW ? `${c.dW.toFixed(2)} m` : '免設'}</td><td>{c.Le.toFixed(1)}</td><td>{formatStation(c.keys[2], 1)}～{formatStation(c.keys[3], 1)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.roadway?.curves.flatMap(c => c.warnings.map(w => `${c.name}：${w}`)).map((w, i) => <Note key={i} tone="warn">{w}</Note>)}
        </>
      )}
    </Card>
  );
}

// ---------------- 進階組合斷面 ----------------
export function AdvancedCard({ p, d }: { p: Project; d: Derived }) {
  const a = p.advanced;
  const errs = new Set<string>();
  d.sections.forEach(s => s.errors?.forEach(e => errs.add(e)));
  return (
    <Card title="斷面組合方式">
      <div className="seg seg-2">
        <button type="button" className={!a.enabled ? 'on' : ''} onClick={() => patch('advanced', { ...a, enabled: false })}>簡易組合</button>
        <button type="button" className={a.enabled ? 'on' : ''} onClick={() => patch('advanced', { ...a, enabled: true })}>進階組合</button>
      </div>
      {!a.enabled && <Btn kind="ghost" onClick={() => patch('advanced', { ...simpleToAdvanced(p.template), tables: a.tables })}>把簡易斷面轉成進階組合</Btn>}
      {a.enabled && (
        <>
          <p className="hint">由路面邊緣往外依序套構造物；「條件」成立才繪出，參數可寫運算式。下方抽屜切到「組合設定」編輯。</p>
          <div className="two">
            <NumField id="adv-be" label="邊坡每隔高度設平台" value={a.bermEvery} unit="m" min={0} onChange={v => patch('advanced', { ...a, bermEvery: v })} />
            <NumField id="adv-bw" label="平台寬" value={a.bermWidth} unit="m" min={0} onChange={v => patch('advanced', { ...a, bermWidth: v })} />
          </div>
          {errs.size > 0 && <Note tone="warn"><b>組合設定有誤：</b>{[...errs].slice(0, 6).map((e, i) => <div key={i}>{e}</div>)}</Note>}
          {d.quantities.length > 0 && (
            <div className="kpis">
              {d.quantities.map((q, i) => <Kpi key={i} label={`${q.unit}（${q.material}）`} value={`${q.volume.toFixed(2)} m³`} />)}
            </div>
          )}
          <Note>填方面積量到完成面（含擋土牆等構造物所佔體積），構造物數量另列。</Note>
        </>
      )}
    </Card>
  );
}

const VARS_HELP: Array<[string, string]> = [
  ['ST', '樁號（公尺）'], ['LW、RW', '左、右路面寬（含加寬）'], ['LS、RS', '左、右橫坡 %（向外下降為正，超高時外側為負）'],
  ['CH', '中心挖填高（地面 − 設計，正為挖）'], ['LX、LY', '目前連接點距中心距離、高程'], ['GH', '連接點處的地面高'], ['SIDE', '右側 1、左側 −1'],
  ['EH(x)', '距中心 x 公尺處的地面高'], ['IN(表, 值)', '內插表'], ['TAB(表, 值)', '層階表'], ['IF(條件, 是, 否)', '條件取值'],
  ['MAX MIN ROUND ABS SQRT', '常用數學函數；SIN COS TAN 以度計'],
];

export function UnitsCard() {
  return (
    <Card title="構造物單元與變數">
      <div className="unit-list">
        {BUILTIN_UNITS.map(u => (
          <div key={u.id} className="unit-item">
            <UnitPreview u={u} />
            <div><b>{u.id}</b> {u.name}<br /><span className="muted small">{u.desc}；預設 {u.params.map(q => `${q.key}=${q.def}`).join('、')}</span></div>
          </div>
        ))}
      </div>
      <div className="code-ref">
        {VARS_HELP.map(([k, t]) => <span key={k} style={{ display: 'contents' }}><b>{k}</b><span /><span>{t}</span></span>)}
      </div>
    </Card>
  );
}

/** 以預設參數畫出構造物單元的小示意圖 */
function UnitPreview({ u }: { u: StructUnit }) {
  const P: Record<string, number> = {};
  u.params.forEach(q => { P[q.key] = q.def; });
  const ev = (s: string) => { try { return evaluate(s, { vars: P }); } catch { return 0; } };
  const surf = u.surface.map(([x, y]) => [ev(x), ev(y)]);
  const sols = u.solids.map(s => s.pts.map(([x, y]) => [ev(x), ev(y)]));
  const all = [...surf, ...sols.flat()];
  const minX = Math.min(...all.map(q => q[0]), 0), maxX = Math.max(...all.map(q => q[0]), 0.1);
  const minY = Math.min(...all.map(q => q[1]), 0), maxY = Math.max(...all.map(q => q[1]), 0.1);
  const s = 40 / Math.max(maxX - minX, maxY - minY, 0.1);
  const X = (x: number) => 4 + (x - minX) * s, Y = (y: number) => 4 + (maxY - y) * s;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" className="unit-svg">
      {sols.map((pl, i) => <polygon key={i} points={pl.map(q => `${X(q[0])},${Y(q[1])}`).join(' ')} />)}
      <polyline points={surf.map(q => `${X(q[0])},${Y(q[1])}`).join(' ')} />
    </svg>
  );
}

const ITEM_COLS: Col<TemplateItem>[] = [
  { key: 'side', label: '側', type: 'select', options: [['B', '兩側'], ['L', '左'], ['R', '右']] },
  { key: 'unit', label: '構造物', type: 'select', options: BUILTIN_UNITS.map(u => [u.id, `${u.id} ${u.name}`]) },
  { key: 'cond', label: '繪出條件', type: 'text', width: 150, placeholder: '空白＝一律繪出' },
  { key: 'params', label: '參數（; 分隔）', type: 'text', width: 260, placeholder: 'W=0.5; H=0.6' },
];
const TABLE_COLS: Col<LookupTable>[] = [
  { key: 'name', label: '表名', type: 'text', width: 90 },
  { key: 'kind', label: '種類', type: 'select', options: [['IN', 'IN 內插'], ['TAB', 'TAB 層階']] },
  { key: 'data', label: '資料（關鍵值:值, …）', type: 'text', width: 320, placeholder: '0:3.5, 120:4.5' },
];

export function AdvancedDrawer({ p }: { p: Project }) {
  const a = p.advanced;
  const [tab, setTab] = useState<'items' | 'tables'>('items');
  return (
    <div className="drawer-sub">
      <div className="seg seg-2 small-seg">
        <button type="button" className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>構造物組合（由內往外）</button>
        <button type="button" className={tab === 'tables' ? 'on' : ''} onClick={() => setTab('tables')}>查表（IN／TAB）</button>
      </div>
      {tab === 'items' ? (
        <EditTable cols={ITEM_COLS} rows={a.items} blank={(): TemplateItem => ({ side: 'B', unit: 'SHOULDER', cond: '', params: '' })}
          onChange={items => patch('advanced', { ...a, items })}
          extra={[{ label: '語法', render: r => { const e = checkSyntax(r.cond) ?? r.params.split(/[;；]/).map(x => x.split('=').slice(1).join('=')).map(x => checkSyntax(x)).find(Boolean); return e ? <span className="bad" title={e}>✕ {e}</span> : <span className="ok-mark">✓</span>; } }]} />
      ) : (
        <EditTable cols={TABLE_COLS} rows={a.tables} blank={(): LookupTable => ({ name: '', kind: 'IN', data: '' })} onChange={tables => patch('advanced', { ...a, tables })} emptyText="尚無查表。例：表名「路寬」、內插、0:3.5, 120:4.5，參數寫 W=IN(路寬, ST)" />
      )}
    </div>
  );
}
