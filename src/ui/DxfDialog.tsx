// DXF 匯入對話框：選圖層與轉點方式，即時預覽結果
import { useMemo, useState } from 'react';
import type { DxfData, DxfImportOptions } from '../io/dxf-read';
import { dxfToPoints } from '../io/dxf-read';
import type { ZRule } from '../core/model';
import { Btn, Check, NumField, Note } from './common';

export function DxfDialog(props: {
  fileName: string;
  data: DxfData;
  zRule: ZRule;
  onCancel(): void;
  onImport(points: ReturnType<typeof dxfToPoints>['points']): void;
}) {
  const layerList = useMemo(() => [...props.data.layers.entries()].sort((a, b) => b[1] - a[1]), [props.data]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(layerList.map(l => l[0])));
  const [o, setO] = useState({ usePoints: true, useText: true, usePolylines: true, densify: 5, minDist: 0.5, textRadius: 3, removeOutliers: true });
  const opts: DxfImportOptions = { ...o, layers: sel, zRule: props.zRule };
  const rep = useMemo(() => dxfToPoints(props.data, opts), [props.data, sel, o, props.zRule]); // eslint-disable-line react-hooks/exhaustive-deps
  const zr = rep.points.reduce((a, p) => (p.z === null ? a : [Math.min(a[0], p.z), Math.max(a[1], p.z)]), [Infinity, -Infinity]);
  const typeCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of props.data.entities) {
      const k = e.type === 'POLY' ? e.src : e.type;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [props.data]);
  const toggle = (name: string) => { const s = new Set(sel); s.has(name) ? s.delete(name) : s.add(name); setSel(s); };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="dxf-title">
      <div className="modal">
        <header className="modal-head">
          <h2 id="dxf-title">匯入 DXF：{props.fileName}</h2>
          <span className="muted">版本 {props.data.version || '未知'}・編碼 {props.data.encoding}</span>
        </header>
        <div className="modal-body">
          <div className="modal-col">
            <h3>圖層（{sel.size}/{layerList.length}）</h3>
            <div className="btn-grid">
              <Btn kind="ghost" onClick={() => setSel(new Set(layerList.map(l => l[0])))}>全選</Btn>
              <Btn kind="ghost" onClick={() => setSel(new Set())}>全不選</Btn>
            </div>
            <div className="layer-list">
              {layerList.map(([name, n]) => (
                <label key={name} className="check">
                  <input type="checkbox" checked={sel.has(name)} onChange={() => toggle(name)} />
                  <span>{name}</span><span className="muted">{n}</span>
                </label>
              ))}
            </div>
            <p className="hint">圖框、文字說明、圖例等非地形圖層請取消勾選。</p>
            <h3>圖元</h3>
            <p className="muted small">{typeCount.map(([k, n]) => `${k} ${n}`).join('・')}
              {props.data.ignored.size > 0 && <><br />未處理：{[...props.data.ignored.entries()].map(([k, n]) => `${k} ${n}`).join('・')}</>}</p>
          </div>
          <div className="modal-col">
            <h3>轉成測點的方式</h3>
            <Check id="dx-pt" label="點與圖塊（POINT、INSERT）" checked={o.usePoints} onChange={v => setO({ ...o, usePoints: v })} />
            <Check id="dx-txt" label="高程文字（數字文字當高程）" checked={o.useText} onChange={v => setO({ ...o, useText: v })} />
            <Check id="dx-line" label="等高線與 3D 線的頂點" checked={o.usePolylines} onChange={v => setO({ ...o, usePolylines: v })} />
            <NumField id="dx-dens" label="沿線加密間距（0 = 只取頂點）" value={o.densify} unit="m" min={0} onChange={v => setO({ ...o, densify: v })} />
            <NumField id="dx-min" label="重複點濾除距離" value={o.minDist} unit="m" min={0} onChange={v => setO({ ...o, minDist: v })} />
            <NumField id="dx-tr" label="高程文字配對半徑" value={o.textRadius} unit="m" min={0} onChange={v => setO({ ...o, textRadius: v })} />
            <Check id="dx-out" label="剔除 (0,0) 與遠離地形的飛點" checked={o.removeOutliers} onChange={v => setO({ ...o, removeOutliers: v })} />
            <h3>預覽</h3>
            <table className="tbl compact">
              <tbody>
                <tr><td>將匯入測點</td><td><b>{rep.points.length}</b></td></tr>
                <tr><td>來自點／圖塊</td><td>{rep.fromPoints}</td></tr>
                <tr><td>來自高程文字</td><td>{rep.fromText}</td></tr>
                <tr><td>來自線（含加密）</td><td>{rep.fromLines}</td></tr>
                <tr><td>無效高程（0、-9999 等）</td><td>{rep.invalidZ}</td></tr>
                <tr><td>剔除飛點</td><td>{rep.outliers}</td></tr>
                <tr><td>重複點</td><td>{rep.duplicates}</td></tr>
                <tr><td>高程範圍</td><td>{isFinite(zr[0]) ? `${zr[0].toFixed(2)} ~ ${zr[1].toFixed(2)} m` : '—'}</td></tr>
              </tbody>
            </table>
            {rep.points.length > 60000 && <Note tone="warn">點數很多，畫面可能變慢。可以加大加密間距或重複點濾除距離。</Note>}
            {rep.invalidZ > 0 && <Note>無效高程不會進入三角網。線上的無效頂點直接捨棄；點和文字會保留為「無高程點」，可在測點頁刪除。</Note>}
          </div>
        </div>
        <footer className="modal-foot">
          <Btn kind="ghost" onClick={props.onCancel}>取消</Btn>
          <Btn kind="primary" disabled={!rep.points.length} onClick={() => props.onImport(rep.points)}>匯入 {rep.points.length} 點</Btn>
        </footer>
      </div>
    </div>
  );
}
