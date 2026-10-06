// 下方抽屜的資料表
import { useMemo, useState } from 'react';
import type { Project } from '../core/model';
import { isValidZ } from '../core/model';
import type { Derived } from '../store/derived';
import type { GridResult } from '../core/earthwork-grid';
import { formatStation, degToDmsText, DEG, fmt } from '../core/units';
import { update } from '../store/store';

const LIMIT = 1500;

export function PointTable({ p, highlight, onPick }: { p: Project; highlight: number | null; onPick(id: number): void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const arr = s ? p.points.filter(t => t.name.toLowerCase().includes(s) || (t.code ?? '').toLowerCase().includes(s)) : p.points;
    if (highlight !== null) {
      const i = arr.findIndex(t => t.id === highlight);
      if (i >= LIMIT) return [arr[i], ...arr.slice(0, LIMIT - 1)];
    }
    return arr.slice(0, LIMIT);
  }, [p.points, q, highlight]);
  return (
    <div className="dtable">
      <div className="dtable-bar">
        <input type="search" aria-label="搜尋點號或代碼" placeholder="搜尋點號或代碼" value={q} onChange={e => setQ(e.target.value)} />
        <span className="muted">{p.points.length} 點{p.points.length > LIMIT ? `，表格顯示前 ${LIMIT} 筆` : ''}</span>
        {highlight !== null && <button type="button" className="btn danger" onClick={() => update(pr => ({ ...pr, points: pr.points.filter(t => t.id !== highlight) }))}>刪除選取的點</button>}
      </div>
      <div className="table-wrap fill">
        <table className="tbl">
          <thead><tr><th>點號</th><th>E (X)</th><th>N (Y)</th><th>Z</th><th>代碼</th></tr></thead>
          <tbody>
            {list.map(t => {
              const ok = isValidZ(t.z, p.zRule);
              return (
                <tr key={t.id} className={t.id === highlight ? 'sel' : ''} onClick={() => onPick(t.id)}>
                  <td>{t.name}</td><td>{t.x.toFixed(3)}</td><td>{t.y.toFixed(3)}</td>
                  <td className={ok ? '' : 'bad'}>{ok ? (t.z as number).toFixed(3) : '無高程'}</td><td>{t.code ?? ''}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={5}>沒有測點。到左側「匯入測點」載入點檔或 DXF，或在「專案」頁載入示範資料。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StakeTable({ d, selected, onSelect, compact }: { d: Derived; selected: number | null; onSelect(s: number): void; compact?: boolean }) {
  const rw = !compact && d.roadway;
  return (
    <div className="table-wrap fill">
      <table className="tbl">
        <thead><tr><th>樁號</th><th>點名</th>{!compact && <><th>E</th><th>N</th><th>方位角</th></>}{rw && <><th>左橫坡%</th><th>右橫坡%</th><th>左加寬</th><th>右加寬</th></>}<th>地面高</th><th>設計高</th><th>挖填高</th></tr></thead>
        <tbody>
          {d.stakeRows.map(r => (
            <tr key={r.stake.sta} className={selected !== null && Math.abs(selected - r.stake.sta) < 1e-6 ? 'sel' : ''} onClick={() => onSelect(r.stake.sta)}>
              <td>{formatStation(r.stake.sta)}</td><td className="accent">{r.stake.label}</td>
              {!compact && <><td>{r.stake.x.toFixed(3)}</td><td>{r.stake.y.toFixed(3)}</td><td>{degToDmsText(r.stake.az / DEG)}</td></>}
              {rw && (() => { const st = d.roadway!.stateAt(r.stake.sta); return <><td>{st.fallL.toFixed(2)}</td><td>{st.fallR.toFixed(2)}</td><td>{st.widenL ? st.widenL.toFixed(2) : ''}</td><td>{st.widenR ? st.widenR.toFixed(2) : ''}</td></>; })()}
              <td>{fmt(r.ground)}</td><td>{fmt(r.design)}</td>
              <td className={r.dh === null ? '' : r.dh >= 0 ? 'cut' : 'fill'}>{r.dh === null ? '—' : `${r.dh >= 0 ? '挖' : '填'} ${Math.abs(r.dh).toFixed(3)}`}</td>
            </tr>
          ))}
          {!d.stakeRows.length && <tr><td colSpan={compact ? 5 : 12}>尚未建立中心線</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function VolumeTable({ d, selected, onSelect }: { d: Derived; selected: number | null; onSelect(s: number): void }) {
  const last = d.volumes[d.volumes.length - 1];
  return (
    <div className="table-wrap fill">
      <table className="tbl">
        <thead><tr><th>樁號</th><th>點名</th><th>樁距</th><th>At m²</th><th>Af m²</th><th>挖方 m³</th><th>填方 m³</th><th>累計挖</th><th>累計填</th><th>累積(挖−填)</th></tr></thead>
        <tbody>
          {d.volumes.map((v, i) => (
            <tr key={v.sta} className={selected !== null && Math.abs(selected - v.sta) < 1e-6 ? 'sel' : ''} onClick={() => onSelect(v.sta)}>
              <td>{formatStation(v.sta)}</td><td className="accent">{v.label}</td><td>{v.dist.toFixed(2)}</td>
              <td>{v.ok ? v.cutArea.toFixed(2) : <span className="bad" title={d.sections[i]?.reason}>—</span>}</td>
              <td>{v.ok ? v.fillArea.toFixed(2) : '—'}</td>
              <td className="cut">{v.cutVol.toFixed(2)}</td><td className="fill">{v.fillVol.toFixed(2)}</td>
              <td>{v.cumCut.toFixed(2)}</td><td>{v.cumFill.toFixed(2)}</td><td>{v.mass.toFixed(2)}</td>
            </tr>
          ))}
          {last && (
            <tr className="total"><td colSpan={5}>合計</td><td className="cut">{last.cumCut.toFixed(2)}</td><td className="fill">{last.cumFill.toFixed(2)}</td><td colSpan={2} /><td>{last.mass.toFixed(2)}</td></tr>
          )}
          {!d.volumes.length && <tr><td colSpan={10}>尚未建立中心線</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function GridTable({ g }: { g: GridResult | null }) {
  if (!g) return <div className="empty">按左側「計算土方」後，這裡會列出每個方格的計算結果。</div>;
  const rows = g.cells.slice(0, LIMIT);
  return (
    <div className="table-wrap fill">
      <table className="tbl">
        <thead><tr><th>列</th><th>行</th><th>左下 E</th><th>左下 N</th><th>面積 m²</th><th>h1</th><th>h2</th><th>h3</th><th>h4</th><th>挖方 m³</th><th>填方 m³</th></tr></thead>
        <tbody>
          {rows.map(c => (
            <tr key={`${c.i}-${c.j}`}>
              <td>{c.j + 1}</td><td>{c.i + 1}</td><td>{c.x0.toFixed(2)}</td><td>{c.y0.toFixed(2)}</td><td>{c.area.toFixed(2)}</td>
              {c.corners.map((k, n) => <td key={n} className={(k.dh ?? 0) >= 0 ? 'cut' : 'fill'}>{(k.dh ?? 0).toFixed(2)}</td>)}
              <td className="cut">{c.cut.toFixed(2)}</td><td className="fill">{c.fill.toFixed(2)}</td>
            </tr>
          ))}
          <tr className="total"><td colSpan={4}>合計（{g.cells.length} 格）</td><td>{g.totalArea.toFixed(2)}</td><td colSpan={4}>h = 地面高 − 設計高（正為挖）</td><td className="cut">{g.cut.toFixed(2)}</td><td className="fill">{g.fill.toFixed(2)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
