// 第二版：測量計算（控制點、觀測手簿、導線、水準、前方交會、座標轉換）
import { useMemo, useState } from 'react';
import type { Project } from '../core/model';
import { nextPointId } from '../core/model';
import type { ControlPoint, Station, Obs, SurveyResult } from '../core/survey';
import { to3DF, forwardIntersection, isControlName } from '../core/survey';
import type { TraverseResult, TraverseRow } from '../core/traverse';
import { TRAVERSE_TYPES } from '../core/traverse';
import type { LevelResult, LevelRow } from '../core/leveling';
import { LEVEL_CLASSES } from '../core/leveling';
import { fitSimilarity, apply } from '../core/transform';
import { parseInstrument, INSTRUMENT_FORMATS, type InstrumentFormat } from '../io/instruments';
import { DEG, degToDmsText, parseStation } from '../core/units';
import { update, patch } from '../store/store';
import { decodeText, parsePointText, toCsv } from '../io/csv';
import { Card, NumField, TextField, Check, Btn, Kpi, Note, download, pickFile, stamp, safeName } from './common';
import { EditTable, type Col } from './EditTable';

export type SurveyTool = 'ctl' | 'book' | 'trav' | 'lev' | 'xs' | 'tf';
export const SURVEY_TOOLS: Array<[SurveyTool, string]> = [['ctl', '控制點'], ['book', '觀測手簿'], ['trav', '導線'], ['lev', '水準'], ['xs', '前方交會'], ['tf', '座標轉換']];

export interface SurveyCtx {
  p: Project;
  tool: SurveyTool;
  setTool(t: SurveyTool): void;
  survey: SurveyResult;
  trav: TraverseResult;
  lev: LevelResult;
  stationIdx: number;
  setStationIdx(i: number): void;
  toast(msg: string, tone?: 'ok' | 'warn'): void;
  refit(): void;
}

const f3 = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(3));
const mm = (v: number | null) => (v === null ? '—' : `${(v * 1000).toFixed(1)} mm`);

/** 新增或覆寫控制點（同名覆寫） */
function upsertControls(list: ControlPoint[]) {
  update(q => {
    const m = new Map(q.controls.map(c => [c.name, c]));
    for (const c of list) m.set(c.name, c);
    return { ...q, controls: [...m.values()] };
  });
}

/** 把計算結果加入測點（同名點覆寫座標） */
function addToPoints(list: Array<{ name: string; x: number; y: number; z: number | null; code?: string }>) {
  update(q => {
    const byName = new Map(q.points.map((t, i) => [t.name, i]));
    const pts = q.points.slice();
    let id = nextPointId(pts);
    for (const t of list) {
      const i = byName.get(t.name);
      if (i !== undefined) pts[i] = { ...pts[i], x: t.x, y: t.y, z: t.z, code: t.code ?? pts[i].code };
      else pts.push({ id: id++, name: t.name, x: t.x, y: t.y, z: t.z, code: t.code });
    }
    return { ...q, points: pts };
  });
}

export function SurveyPanel(c: SurveyCtx) {
  return (
    <>
      <div className="seg seg-6">
        {SURVEY_TOOLS.map(([k, t]) => <button key={k} type="button" className={c.tool === k ? 'on' : ''} onClick={() => c.setTool(k)}>{t}</button>)}
      </div>
      {c.tool === 'ctl' && <ControlPanel {...c} />}
      {c.tool === 'book' && <BookPanel {...c} />}
      {c.tool === 'trav' && <TraversePanel {...c} />}
      {c.tool === 'lev' && <LevelPanel {...c} />}
      {c.tool === 'xs' && <IntersectionPanel {...c} />}
      {c.tool === 'tf' && <TransformPanel {...c} />}
    </>
  );
}

// ---------- 控制點 ----------
function ControlPanel({ p, toast }: SurveyCtx) {
  return (
    <>
      <Card title="控制點資料庫" extra={<span className="badge">{p.controls.length} 點</span>}>
        <p className="hint">已知三角點、導線點與轉站點。觀測手簿、導線、水準都從這裡取已知座標；計算出的轉站點也會寫回這裡。點名以英文字母開頭的點視為控制點。</p>
        <div className="btn-grid">
          <Btn kind="primary" onClick={async () => {
            const f = await pickFile('.csv,.txt');
            if (!f) return;
            const r = parsePointText(decodeText(await f.arrayBuffer()), 'PENZ', { zeroIsNull: false, minZ: -1000, maxZ: 9000 });
            upsertControls(r.points.map(t => ({ name: t.name, x: t.x, y: t.y, z: t.z })));
            toast(`匯入 ${r.points.length} 個控制點（點號, E, N, Z）`, 'ok');
          }}>匯入 CSV</Btn>
          <Btn disabled={!p.controls.length} onClick={() => download(`${safeName(p.info.name)}_控制點_${stamp()}.csv`, toCsv([['點號', 'E', 'N', 'Z'], ...p.controls.map(k => [k.name, k.x.toFixed(4), k.y.toFixed(4), k.z?.toFixed(4) ?? ''])]), 'text/csv;charset=utf-8')}>匯出 CSV</Btn>
          <Btn disabled={!p.controls.length} onClick={() => { addToPoints(p.controls.map(k => ({ ...k, code: 'CTRL' }))); toast('控制點已加入測點（同名點會更新座標）', 'ok'); }}>加入測點展繪</Btn>
        </div>
      </Card>
      <Note>下方表格可直接編輯，也能從 Excel 複製「點號、E、N、Z」四欄後貼上。</Note>
    </>
  );
}

const CTL_COLS: Col<ControlPoint>[] = [
  { key: 'name', label: '點號', type: 'text', width: 70 },
  { key: 'x', label: 'E (X)', type: 'num', digits: 4, width: 110 },
  { key: 'y', label: 'N (Y)', type: 'num', digits: 4, width: 110 },
  { key: 'z', label: 'Z', type: 'num', digits: 4, nullable: true, width: 80 },
];

// ---------- 觀測手簿 ----------
function BookPanel(c: SurveyCtx) {
  const { p, survey, stationIdx, setStationIdx, toast } = c;
  const st = p.stations[stationIdx];
  const setSt = (v: Partial<Station>) => patch('stations', p.stations.map((s, i) => (i === stationIdx ? { ...s, ...v } : s)));
  const rep = survey.stations[stationIdx];
  const okCount = survey.stations.filter(s => s.ok).length;
  const [fmt, setFmt] = useState<InstrumentFormat>('auto');
  return (
    <>
      <Card title="觀測資料">
        <label className="field" htmlFor="ins-fmt">
          <span className="field-label">儀器記錄格式</span>
          <select id="ins-fmt" value={fmt} onChange={e => setFmt(e.target.value as InstrumentFormat)}>
            {INSTRUMENT_FORMATS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <div className="btn-grid">
          <Btn kind="primary" onClick={async () => {
            const f = await pickFile('.3df,.txt,.raw,.gsi,.sdr,.dat,.rw5,.obs,.csv,*');
            if (!f) return;
            const r = parseInstrument(decodeText(await f.arrayBuffer()), fmt);
            if (!r.stations.length && !r.coords.length) { toast(r.warnings[0] ?? '沒有讀到資料', 'warn'); return; }
            if (r.stations.length) { patch('stations', [...p.stations, ...r.stations]); setStationIdx(p.stations.length); }
            if (r.coords.length) addToPoints(r.coords);
            const fmtName = INSTRUMENT_FORMATS.find(x => x[0] === r.format)?.[1] ?? r.format;
            toast(`${fmtName}：${r.stations.length} 個測站、${r.stations.reduce((s, x) => s + x.obs.length, 0)} 筆觀測${r.coords.length ? `、${r.coords.length} 個座標點（已加入測點）` : ''}`, 'ok');
            r.warnings.forEach(w => toast(w, 'warn'));
          }}>匯入觀測檔</Btn>
          <Btn disabled={!p.stations.length} onClick={() => download(`${safeName(p.info.name)}_${stamp()}.3df`, to3DF(p.stations))}>匯出 3DF</Btn>
        </div>
        <p className="hint">3DF 格式：<code>ST:測站 後視 儀器高 後視角</code>、<code>SD:點號 覘標高 水平角 天頂距 斜距 代碼</code>、<code>HD:點號 覘標高 水平角 高差 平距 代碼</code>。角度用 ddd.mmss。</p>
      </Card>
      <Card title="測站" extra={<span className="badge">{okCount}/{p.stations.length} 站已算出</span>}>
        <label className="field" htmlFor="st-sel">
          <span className="field-label">選擇測站</span>
          <select id="st-sel" value={stationIdx} onChange={e => setStationIdx(Number(e.target.value))}>
            {p.stations.map((s, i) => <option key={i} value={i}>{i + 1}. {s.name || '（未命名）'}（{s.obs.length} 筆）{survey.stations[i]?.ok ? '' : ' ⚠'}</option>)}
            {!p.stations.length && <option value={0}>尚無測站</option>}
          </select>
        </label>
        <div className="btn-grid">
          <Btn onClick={() => { patch('stations', [...p.stations, { name: '', bs: '', hi: 1.5, bsAngle: '0', mode: 'SD', obs: [] }]); setStationIdx(p.stations.length); }}>新增測站</Btn>
          <Btn kind="danger" disabled={!st} onClick={() => { patch('stations', p.stations.filter((_, i) => i !== stationIdx)); setStationIdx(Math.max(0, stationIdx - 1)); }}>刪除此測站</Btn>
        </div>
        {st && (
          <>
            <TextField id="st-name" label="測站點名" value={st.name} onChange={v => setSt({ name: v.trim() })} />
            <TextField id="st-bs" label="後視點名" value={st.bs} placeholder="空白＝讀數即方位角" onChange={v => setSt({ bs: v.trim() })} />
            <NumField id="st-hi" label="儀器高" value={st.hi} unit="m" onChange={v => setSt({ hi: v })} />
            <TextField id="st-bsa" label="後視讀數 (ddd.mmss)" value={st.bsAngle} onChange={v => setSt({ bsAngle: v.trim() })} />
            <label className="field" htmlFor="st-mode">
              <span className="field-label">記錄方式</span>
              <select id="st-mode" value={st.mode} onChange={e => setSt({ mode: e.target.value as Station['mode'] })}>
                <option value="SD">斜距 + 天頂距</option>
                <option value="HD">平距 + 高差</option>
              </select>
            </label>
            {rep && <Note tone={rep.ok ? 'ok' : 'warn'}>{rep.ok ? `${rep.message}；測站 E ${f3(rep.x)} N ${f3(rep.y)} Z ${f3(rep.z)}` : rep.message}</Note>}
          </>
        )}
      </Card>
      <Card title="計算結果" extra={<span className="badge">{survey.points.length} 點</span>}>
        <p className="hint">點名英文字母開頭的點視為轉站點，會自動成為下一站可用的已知點。代碼 <b>BS</b>：自由測站（後方交會）的已知點；代碼 <b>99999.點名</b>：前方交會的照準方向。覘標高填 0 的點不計高程。</p>
        <div className="btn-grid">
          <Btn kind="primary" disabled={!survey.points.length} onClick={() => { addToPoints(survey.points.map(q => ({ name: q.name, x: q.x, y: q.y, z: q.z, code: q.code }))); toast(`已把 ${survey.points.length} 點加入測點`, 'ok'); c.refit(); }}>加入測點</Btn>
          <Btn disabled={!survey.newControls.length} onClick={() => { upsertControls(survey.newControls); toast(`已寫入 ${survey.newControls.length} 個轉站點／交會點到控制點`, 'ok'); }}>轉站點寫入控制點</Btn>
        </div>
      </Card>
    </>
  );
}

function obsCols(mode: Station['mode']): Col<Obs>[] {
  return [
    { key: 'name', label: '點號', type: 'text', width: 60 },
    { key: 'ht', label: '覘標高', type: 'num', width: 60 },
    { key: 'hz', label: '水平角', type: 'text', width: 82, placeholder: 'ddd.mmss' },
    { key: 'v', label: mode === 'SD' ? '天頂距' : '高差', type: 'text', width: 82 },
    { key: 'dist', label: mode === 'SD' ? '斜距' : '平距', type: 'num', width: 76 },
    { key: 'code', label: '代碼', type: 'text', width: 70 },
  ];
}

// ---------- 導線 ----------
function TraversePanel({ p, trav, toast, refit }: SurveyCtx) {
  const t = p.traverse;
  const set = (v: Partial<Project['traverse']>) => patch('traverse', { ...t, ...v });
  const needAz = t.type === 'open-az' || t.type === 'loop-az';
  const needBs = t.type === 'open-2' || t.type === 'link-3' || t.type === 'link-4';
  const desc = TRAVERSE_TYPES.find(x => x[0] === t.type)![2];
  const newPts = trav.ok ? trav.points.filter(q => !q.known) : [];
  return (
    <>
      <Card title="導線型態">
        <label className="field" htmlFor="tr-type">
          <span className="field-label">型態</span>
          <select id="tr-type" value={t.type} onChange={e => set({ type: e.target.value as Project['traverse']['type'] })} style={{ width: 170 }}>
            {TRAVERSE_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <p className="hint">{desc}</p>
        <datalist id="ctl-names">{p.controls.map(k => <option key={k.name} value={k.name} />)}</datalist>
        {needAz && <TextField id="tr-az" label="第一邊方位角 (ddd.mmss)" value={t.startAz} onChange={v => set({ startAz: v.trim() })} />}
        {needBs && <ListField id="tr-bs" label="起點的後視已知點" value={t.backsight} onChange={v => set({ backsight: v })} />}
        {t.type === 'link-4' && <ListField id="tr-fs" label="終點的前視已知點" value={t.foresight} onChange={v => set({ foresight: v })} />}
        <p className="hint">下方表格第一列為起點、最後一列為終點{t.type === 'loop-az' ? '（閉合導線最後一列再填一次起點，角度欄填閉合角）' : ''}。水平角為由後視順時針量到前視的角度；距離為到下一站的平距；高差可空白。</p>
      </Card>
      <Card title="計算成果">
        {!trav.ok && <Note tone="warn">{trav.error}</Note>}
        {trav.ok && (
          <>
            <div className="kpis">
              <Kpi label="角度閉合差" value={trav.fAngleSec === null ? '無檢核' : `${trav.fAngleSec.toFixed(1)}″（${trav.nAngles} 角）`} />
              <Kpi label="導線全長 ΣD" value={`${trav.totalDist.toFixed(3)} m`} />
              <Kpi label="縱距閉合差 fN" value={mm(trav.fN)} />
              <Kpi label="橫距閉合差 fE" value={mm(trav.fE)} />
              <Kpi label={trav.fLength !== null ? '距離閉合差' : '閉合差 f'} value={mm(trav.fLength ?? trav.f)} />
              <Kpi label="相對精度" value={trav.precision ? `1 / ${Math.round(trav.precision).toLocaleString()}` : trav.f === null && trav.fLength === null ? '無檢核' : '—'} tone={trav.precision && trav.precision >= 5000 ? 'ok' : trav.precision ? 'warn' : undefined} />
            </div>
            {trav.fZ !== null && <p className="hint">高程閉合差 {mm(trav.fZ)}，已按距離比例分配。</p>}
            <p className="hint">角度閉合差平均分配到各角，座標閉合差依羅盤儀法則按距離比例分配。</p>
            <div className="btn-grid">
              <Btn kind="primary" disabled={!newPts.length} onClick={() => { upsertControls(newPts.map(q => ({ name: q.name, x: q.x, y: q.y, z: q.z }))); toast(`已寫入 ${newPts.length} 個導線點到控制點`, 'ok'); }}>導線點寫入控制點</Btn>
              <Btn disabled={!newPts.length} onClick={() => { addToPoints(newPts.map(q => ({ ...q, code: 'TRAV' }))); toast('導線點已加入測點', 'ok'); refit(); }}>加入測點</Btn>
              <Btn disabled={!trav.ok} onClick={() => download(`${safeName(p.info.name)}_導線計算表_${stamp()}.csv`, traverseCsv(p, trav), 'text/csv;charset=utf-8')}>導線計算表 CSV</Btn>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function ListField(props: { id: string; label: string; value: string; onChange(v: string): void }) {
  return (
    <label className="field" htmlFor={props.id}>
      <span className="field-label">{props.label}</span>
      <span className="field-input"><input id={props.id} list="ctl-names" type="text" value={props.value} onChange={e => props.onChange(e.target.value.trim())} /></span>
    </label>
  );
}

const TRAV_COLS: Col<TraverseRow>[] = [
  { key: 'name', label: '站名', type: 'text', width: 60 },
  { key: 'angle', label: '水平角', type: 'text', width: 90, placeholder: 'ddd.mmss' },
  { key: 'dist', label: '距離', type: 'num', width: 80 },
  { key: 'dh', label: '高差', type: 'num', nullable: true, width: 64 },
];

function traverseCsv(p: Project, r: TraverseResult) {
  const rows: Array<Array<string | number>> = [['工程名稱', p.info.name], ['導線型態', TRAVERSE_TYPES.find(x => x[0] === p.traverse.type)![1]], [],
    ['站名', '觀測角', '改正後角', '方位角', '距離', 'ΔE', 'ΔN', '改正 E', '改正 N', 'E', 'N', 'Z']];
  r.points.forEach((q, i) => {
    const leg = r.legs[i];
    rows.push([q.name, q.angle !== null ? degToDmsText(q.angle, 1) : '', q.angleCorr !== null ? degToDmsText(q.angleCorr, 1) : '',
      leg ? degToDmsText(leg.az / DEG, 1) : '', leg ? leg.dist.toFixed(3) : '', leg ? leg.dE.toFixed(4) : '', leg ? leg.dN.toFixed(4) : '',
      leg ? leg.cE.toFixed(4) : '', leg ? leg.cN.toFixed(4) : '', q.x.toFixed(4), q.y.toFixed(4), q.z?.toFixed(4) ?? '']);
  });
  rows.push([], ['角度閉合差(秒)', r.fAngleSec?.toFixed(2) ?? '無'], ['fE (m)', r.fE?.toFixed(4) ?? ''], ['fN (m)', r.fN?.toFixed(4) ?? ''], ['f (m)', (r.f ?? r.fLength)?.toFixed(4) ?? ''], ['ΣD (m)', r.totalDist.toFixed(3)], ['相對精度', r.precision ? `1/${Math.round(r.precision)}` : '']);
  return toCsv(rows);
}

// ---------- 水準 ----------
function LevelPanel({ p, lev, toast }: SurveyCtx) {
  const L = p.level;
  const set = (v: Partial<Project['level']>) => patch('level', { ...L, ...v });
  const ctl = (name: string | undefined) => p.controls.find(k => k.name === name);
  const firstName = L.rows[0]?.name;
  const lastName = [...L.rows].reverse().find(r => r.fs !== null)?.name;
  const staRows = lev.ok ? lev.rows.filter(r => r.z !== null && /^\d+K?\+\d/.test(r.name.toUpperCase())) : [];
  return (
    <>
      <Card title="水準線">
        <NumField id="lv-z0" label={`起點 ${firstName ?? ''} 高程`} value={L.startZ} unit="m" onChange={v => set({ startZ: v })} />
        <label className="field" htmlFor="lv-end">
          <span className="field-label">型態</span>
          <select id="lv-end" value={L.endMode} onChange={e => set({ endMode: e.target.value as Project['level']['endMode'] })}>
            <option value="open">開放水準</option>
            <option value="loop">閉合水準（回到起點）</option>
            <option value="known">附合水準（終點已知）</option>
          </select>
        </label>
        {L.endMode === 'known' && <NumField id="lv-z1" label={`終點 ${lastName ?? ''} 高程`} value={L.endZ} unit="m" onChange={v => set({ endZ: v })} />}
        <label className="field" htmlFor="lv-tol">
          <span className="field-label">閉合差限度</span>
          <select id="lv-tol" value={L.tolC} onChange={e => set({ tolC: Number(e.target.value) })}>
            {LEVEL_CLASSES.map(([k, t]) => <option key={k} value={k}>{t} mm</option>)}
          </select>
        </label>
        <Btn disabled={!ctl(firstName) && !ctl(lastName)} onClick={() => {
          const a = ctl(firstName), b = ctl(lastName);
          set({ startZ: a?.z ?? L.startZ, endZ: b?.z ?? L.endZ });
          toast('已從控制點帶入起終點高程', 'ok');
        }}>起終點高程取自控制點</Btn>
        <p className="hint">下方表格依手簿順序輸入：已知點填後視；轉點填前視與後視；樁號等中間點填中間視；終點填前視。距離為和上一列的距離，用來計算 K 值與分配閉合差，可空白（改按測站數分配）。</p>
      </Card>
      <Card title="計算成果">
        {!lev.ok && <Note tone="warn">{lev.error}</Note>}
        {lev.ok && (
          <>
            <div className="kpis">
              <Kpi label="ΣBS − ΣFS" value={`${(lev.sumBS - lev.sumFS).toFixed(3)} m`} />
              <Kpi label="測站數" value={String(lev.setups)} />
              <Kpi label="閉合差 f" value={lev.f === null ? '開放水準' : mm(lev.f)} tone={lev.pass === false ? 'warn' : undefined} />
              <Kpi label={`允許 ±${L.tolC}√K`} value={lev.allowed === null ? '未填距離' : `±${(lev.allowed * 1000).toFixed(1)} mm`} />
              <Kpi label="水準線長" value={lev.totalDist ? `${(lev.totalDist / 1000).toFixed(3)} km` : '—'} />
              <Kpi label="檢核" value={lev.pass === null ? '—' : lev.pass ? '合格' : '超限'} tone={lev.pass === null ? undefined : lev.pass ? 'ok' : 'warn'} />
            </div>
            {lev.pass === false && <Note tone="warn">閉合差超過限度，建議重測後再使用成果。</Note>}
            <div className="btn-grid">
              <Btn kind="primary" disabled={!staRows.length} onClick={() => {
                const pts = staRows.map(r => ({ sta: parseStation(r.name), z: r.z as number })).filter(q => isFinite(q.sta));
                patch('profileGround', { source: 'level', pts });
                toast(`已把 ${pts.length} 個樁號高程寫入縱斷面地面高（縱斷面頁可切換回三角網）`, 'ok');
              }}>寫入縱斷面地面高</Btn>
              <Btn onClick={() => {
                const list = lev.rows.filter(r => r.z !== null && isControlName(r.name));
                update(q => ({ ...q, controls: q.controls.map(k => { const r = list.find(x => x.name === k.name); return r ? { ...k, z: r.z } : k; }) }));
                toast(`已更新 ${list.filter(r => p.controls.some(k => k.name === r.name)).length} 個控制點高程`, 'ok');
              }}>更新控制點高程</Btn>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

const LEV_COLS: Col<LevelRow>[] = [
  { key: 'name', label: '點號／樁號', type: 'text', width: 76 },
  { key: 'bs', label: '後視', type: 'num', nullable: true, width: 64 },
  { key: 'is', label: '中間視', type: 'num', nullable: true, width: 64 },
  { key: 'fs', label: '前視', type: 'num', nullable: true, width: 64 },
  { key: 'dist', label: '距離', type: 'num', nullable: true, width: 60 },
];

// ---------- 前方交會 ----------
function IntersectionPanel({ p, toast }: SurveyCtx) {
  const [s, setS] = useState({ A: '', B: '', hzAB: '0', hzAP: '', hzBA: '0', hzBP: '', name: 'P1' });
  const A = p.controls.find(k => k.name === s.A), B = p.controls.find(k => k.name === s.B);
  const res = A && B && s.hzAP && s.hzBP ? forwardIntersection(A, B, s.hzAB, s.hzAP, s.hzBA, s.hzBP) : null;
  const up = (k: keyof typeof s) => (v: string) => setS({ ...s, [k]: v.trim() });
  return (
    <>
      <Card title="前方交會（兩已知點）">
        <datalist id="ctl-names">{p.controls.map(k => <option key={k.name} value={k.name} />)}</datalist>
        <p className="hint">在兩個已知點分別架站，照準另一已知點與待測點，記錄水平度盤讀數（ddd.mmss）。適用於無法放稜鏡的點，例如煙囪、樹頂、對岸樁位。</p>
        <ListField id="xs-a" label="已知點 A（測站）" value={s.A} onChange={up('A')} />
        <TextField id="xs-ab" label="A 照準 B 讀數" value={s.hzAB} onChange={up('hzAB')} />
        <TextField id="xs-ap" label="A 照準 P 讀數" value={s.hzAP} onChange={up('hzAP')} />
        <ListField id="xs-b" label="已知點 B（測站）" value={s.B} onChange={up('B')} />
        <TextField id="xs-ba" label="B 照準 A 讀數" value={s.hzBA} onChange={up('hzBA')} />
        <TextField id="xs-bp" label="B 照準 P 讀數" value={s.hzBP} onChange={up('hzBP')} />
        <TextField id="xs-n" label="交會點名" value={s.name} onChange={up('name')} />
        {(!A || !B) && (s.A || s.B) && <Note tone="warn">A、B 必須是控制點資料庫裡的點。</Note>}
        {res && (
          <>
            <div className="kpis"><Kpi label="E" value={res.x.toFixed(4)} /><Kpi label="N" value={res.y.toFixed(4)} /></div>
            <div className="btn-grid">
              <Btn kind="primary" onClick={() => { upsertControls([{ name: s.name, x: res.x, y: res.y, z: null }]); toast(`${s.name} 已寫入控制點`, 'ok'); }}>寫入控制點</Btn>
              <Btn onClick={() => { addToPoints([{ name: s.name, x: res.x, y: res.y, z: null, code: 'XSEC' }]); toast(`${s.name} 已加入測點`, 'ok'); }}>加入測點</Btn>
            </div>
          </>
        )}
      </Card>
      <Card title="後方交會（自由測站）">
        <p className="hint">在「觀測手簿」新增測站，測站點名填新的點名、後視空白，再把照準已知點的觀測代碼填 <b>BS</b>（至少 2 點，需有距離）。系統會用最小二乘法算出測站座標與定向，並列出殘差。</p>
      </Card>
    </>
  );
}

// ---------- 座標轉換 ----------
type PairRow = Project['transform']['pairs'][number];
const PAIR_COLS: Col<PairRow>[] = [
  { key: 'name', label: '點名', type: 'text', width: 56 },
  { key: 'fx', label: '原 E', type: 'num', digits: 3, width: 100 },
  { key: 'fy', label: '原 N', type: 'num', digits: 3, width: 100 },
  { key: 'tx', label: '新 E', type: 'num', digits: 3, width: 100 },
  { key: 'ty', label: '新 N', type: 'num', digits: 3, width: 100 },
];

export function useTransformFit(p: Project) {
  return useMemo(() => fitSimilarity(p.transform.pairs.map(q => ({ from: { x: q.fx, y: q.fy }, to: { x: q.tx, y: q.ty } })), p.transform.fixScale), [p.transform]);
}

function TransformPanel({ p, toast }: SurveyCtx) {
  const T = p.transform;
  const fit = useTransformFit(p);
  const [target, setTarget] = useState({ points: true, controls: true, boundary: true, alignment: true });
  const applyAll = () => {
    if (!fit) return;
    const f = (q: { x: number; y: number }) => apply(fit, q);
    update(q => ({
      ...q,
      points: target.points ? q.points.map(t => ({ ...t, ...f(t), z: t.z === null ? null : t.z + T.dz })) : q.points,
      controls: target.controls ? q.controls.map(t => ({ ...t, ...f(t), z: t.z === null ? null : t.z + T.dz })) : q.controls,
      boundary: target.boundary && q.boundary ? q.boundary.map(f) : q.boundary,
      alignment: target.alignment && q.alignment ? { ...q.alignment, ips: q.alignment.ips.map(t => ({ ...t, ...f(t) })) } : q.alignment,
      vpis: T.dz && target.alignment ? q.vpis.map(v => ({ ...v, z: v.z + T.dz })) : q.vpis,
    }));
    toast('座標轉換完成（Ctrl+Z 可復原）', 'ok');
  };
  return (
    <>
      <Card title="座標轉換（相似轉換）">
        <p className="hint">在下方表格輸入 2 個以上對應點的原座標與新座標，求平移、旋轉（與縮放），套用到整個專案。用於假設座標轉到正式座標，或兩期測量對位。</p>
        <Check id="tf-fix" label="比例固定為 1（只平移與旋轉）" checked={T.fixScale} onChange={v => patch('transform', { ...T, fixScale: v })} />
        <NumField id="tf-dz" label="高程平移 ΔZ" value={T.dz} unit="m" onChange={v => patch('transform', { ...T, dz: v })} />
        <Btn disabled={!p.controls.length} onClick={() => patch('transform', { ...T, pairs: [...T.pairs, ...p.controls.slice(0, 2).map(k => ({ name: k.name, fx: k.x, fy: k.y, tx: k.x, ty: k.y }))] })}>由控制點帶入原座標</Btn>
      </Card>
      <Card title="轉換參數">
        {!fit && <Note>至少需要 2 組不重合的對應點。</Note>}
        {fit && (
          <>
            <div className="kpis">
              <Kpi label="旋轉角（逆時針）" value={degToDmsText(fit.rotation / DEG, 1)} />
              <Kpi label="比例" value={fit.scale.toFixed(8)} />
              <Kpi label="平移 tE" value={fit.tx.toFixed(3)} />
              <Kpi label="平移 tN" value={fit.ty.toFixed(3)} />
              <Kpi label="殘差 RMS" value={`${(fit.rms * 1000).toFixed(1)} mm`} tone={fit.rms < 0.05 ? 'ok' : 'warn'} />
            </div>
            <div className="chk-grid">
              <Check id="tf-p" label="測點" checked={target.points} onChange={v => setTarget({ ...target, points: v })} />
              <Check id="tf-c" label="控制點" checked={target.controls} onChange={v => setTarget({ ...target, controls: v })} />
              <Check id="tf-b" label="邊界" checked={target.boundary} onChange={v => setTarget({ ...target, boundary: v })} />
              <Check id="tf-a" label="中心線" checked={target.alignment} onChange={v => setTarget({ ...target, alignment: v })} />
            </div>
            <Btn kind="primary" wide onClick={applyAll}>套用轉換</Btn>
          </>
        )}
      </Card>
    </>
  );
}

// ---------- 下方抽屜 ----------
export function SurveyDrawer(c: SurveyCtx): { title: string; body: React.ReactNode } | null {
  const { p, tool, survey, trav, lev, stationIdx } = c;
  if (tool === 'ctl' || tool === 'xs') {
    return { title: '控制點資料庫', body: <EditTable cols={CTL_COLS} rows={p.controls} onChange={rows => patch('controls', rows.filter(r => r.name || r.x || r.y))} blank={() => ({ name: '', x: 0, y: 0, z: null })} emptyText="尚無控制點" /> };
  }
  if (tool === 'book') {
    const st = p.stations[stationIdx];
    const pts = survey.points.filter(q => st && q.station === st.name);
    return {
      title: st ? `測站 ${st.name} 觀測資料` : '觀測資料',
      body: (
        <div className="split2">
          {st ? <EditTable cols={obsCols(st.mode)} rows={st.obs} blank={() => ({ name: '', ht: 1.5, hz: '', v: st.mode === 'SD' ? '90' : '0', dist: 0, code: '' })}
            onChange={rows => patch('stations', p.stations.map((s, i) => (i === stationIdx ? { ...s, obs: rows } : s)))} />
            : <div className="empty">先新增測站或匯入 3DF。</div>}
          <div className="table-wrap fill">
            <table className="tbl">
              <thead><tr><th>點號</th><th>E</th><th>N</th><th>Z</th><th>代碼</th><th>類別</th></tr></thead>
              <tbody>
                {(pts.length ? pts : survey.points).map((q, i) => (
                  <tr key={i}><td>{q.name}</td><td>{q.x.toFixed(3)}</td><td>{q.y.toFixed(3)}</td><td>{f3(q.z)}</td><td>{q.code}</td><td className={q.kind === 'detail' ? 'muted' : 'accent'}>{q.kind === 'detail' ? '碎部點' : q.kind === 'transfer' ? '轉站點' : '交會點'}</td></tr>
                ))}
                {!survey.points.length && <tr><td colSpan={6}>還沒有算出的點。測站與後視點必須在控制點資料庫中。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ),
    };
  }
  if (tool === 'trav') {
    return {
      title: '導線手簿與成果',
      body: (
        <div className="split2">
          <EditTable cols={TRAV_COLS} rows={p.traverse.rows} blank={() => ({ name: '', angle: '', dist: 0, dh: null })} onChange={rows => patch('traverse', { ...p.traverse, rows })} />
          <div className="table-wrap fill">
            <table className="tbl">
              <thead><tr><th>站名</th><th>改正後角</th><th>方位角</th><th>距離</th><th>改正 E</th><th>改正 N</th><th>E</th><th>N</th><th>Z</th></tr></thead>
              <tbody>
                {trav.ok && trav.points.map((q, i) => {
                  const leg = trav.legs[i];
                  return (
                    <tr key={i}><td className={q.known ? 'accent' : ''}>{q.name}</td><td>{q.angleCorr !== null ? degToDmsText(q.angleCorr, 1) : '—'}</td>
                      <td>{leg ? degToDmsText(leg.az / DEG, 1) : ''}</td><td>{leg ? leg.dist.toFixed(3) : ''}</td>
                      <td>{leg ? (leg.cE * 1000).toFixed(1) : ''}</td><td>{leg ? (leg.cN * 1000).toFixed(1) : ''}</td>
                      <td>{q.x.toFixed(4)}</td><td>{q.y.toFixed(4)}</td><td>{f3(q.z)}</td></tr>
                  );
                })}
                {!trav.ok && <tr><td colSpan={9}>{trav.error}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ),
    };
  }
  if (tool === 'lev') {
    return {
      title: '水準手簿與成果',
      body: (
        <div className="split2">
          <EditTable cols={LEV_COLS} rows={p.level.rows} blank={() => ({ name: '', bs: null, is: null, fs: null, dist: null })} onChange={rows => patch('level', { ...p.level, rows })} />
          <div className="table-wrap fill">
            <table className="tbl">
              <thead><tr><th>點號</th><th>儀器高</th><th>計算高程</th><th>改正 mm</th><th>平差後高程</th></tr></thead>
              <tbody>
                {lev.ok && lev.rows.map((r, i) => (
                  <tr key={i}><td className={r.kind === 'is' ? '' : 'accent'}>{r.name}</td><td>{f3(r.hi)}</td><td>{f3(r.zRaw)}</td><td>{(r.corr * 1000).toFixed(1)}</td><td>{f3(r.z)}</td></tr>
                ))}
                {!lev.ok && <tr><td colSpan={5}>{lev.error}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ),
    };
  }
  if (tool === 'tf') {
    return { title: '座標轉換對應點', body: <TransformDrawer p={p} /> };
  }
  return null;
}

function TransformDrawer({ p }: { p: Project }) {
  const fit = useTransformFit(p);
  return (
    <EditTable cols={PAIR_COLS} rows={p.transform.pairs} blank={() => ({ name: '', fx: 0, fy: 0, tx: 0, ty: 0 })}
      onChange={pairs => patch('transform', { ...p.transform, pairs })}
      extra={[{ label: '殘差 mm', render: (_r, i) => fit?.residuals[i] ? `${(fit.residuals[i].dx * 1000).toFixed(1)}, ${(fit.residuals[i].dy * 1000).toFixed(1)}` : '—' }]} />
  );
}
