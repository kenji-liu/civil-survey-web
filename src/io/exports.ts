// 報表與圖檔輸出
import type { Project } from '../core/model';
import { isValidZ } from '../core/model';
import type { Derived } from '../store/derived';
import type { GridResult } from '../core/earthwork-grid';
import { DxfWriter } from './dxf-write';
import { toCsv } from './csv';
import { formatStation, degToDmsText, DEG } from '../core/units';

export interface DxfLayersOpt { sam: boolean; points: boolean; labels: boolean; tin: boolean; contours: boolean; boundary: boolean; alignment: boolean; stakes: boolean; grid: boolean; textHeight: number }

export function buildDxf(p: Project, d: Derived, grid: GridResult | null, o: DxfLayersOpt): string {
  const w = new DxfWriter()
    .layer('POINTS', 3).layer('PT_ELEV', 7).layer('PT_NAME', 8).layer('TIN', 252)
    .layer('CONT1', 33).layer('CONT5', 30).layer('CONT_TXT', 30).layer('BOUNDARY', 2)
    .layer('AXIS', 4).layer('IP_LINE', 1).layer('STAKE', 4).layer('STAKE_TXT', 7)
    .layer('GRID_CUT', 1).layer('GRID_FILL', 5);
  const h = o.textHeight;
  if (o.points) {
    for (const q of p.points) {
      const ok = isValidZ(q.z, p.zRule);
      w.point('POINTS', q.x, q.y, ok ? (q.z as number) : 0);
      if (o.labels) {
        w.text('PT_ELEV', q.x + h * 0.4, q.y + h * 0.2, h, ok ? (q.z as number).toFixed(2) : 'NULL', 0, ok ? (q.z as number) : 0);
        w.text('PT_NAME', q.x + h * 0.4, q.y - h * 1.2, h * 0.7, q.name);
      }
    }
  }
  if (o.tin && d.tin) {
    const { xs, ys, zs, tri } = d.tin;
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      w.face3d('TIN', { x: xs[a], y: ys[a], z: zs[a] }, { x: xs[b], y: ys[b], z: zs[b] }, { x: xs[c], y: ys[c], z: zs[c] });
    }
  }
  if (o.contours) {
    for (const l of d.contours) {
      w.polyline(l.major ? 'CONT5' : 'CONT1', l.pts, l.closed, l.level);
      if (l.major && l.pts.length > 2) {
        const m = l.pts[Math.floor(l.pts.length / 2)], n = l.pts[Math.floor(l.pts.length / 2) + 1] ?? m;
        let ang = Math.atan2(n.y - m.y, n.x - m.x) / DEG;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        w.text('CONT_TXT', m.x, m.y, h, String(l.level), ang, l.level);
      }
    }
  }
  if (o.sam && d.sam) {
    const L = new Map(p.legend.map(l => [l.code.toUpperCase(), l]));
    const layerOf = (f: string) => L.get(f)?.layer || `SAM_${f}`;
    for (const ln of d.sam.lines) {
      const allZ = ln.pts.every(q => q.z !== null);
      if (allZ) w.polyline3d(layerOf(ln.feature), ln.pts as Array<{ x: number; y: number; z: number }>, ln.closed);
      else w.polyline(layerOf(ln.feature), ln.pts, ln.closed);
      if (ln.label && ln.labelAt) w.text(layerOf(ln.feature), ln.labelAt.x, ln.labelAt.y, h * 1.5, ln.label);
    }
    for (const c of d.sam.circles) w.circle(layerOf(c.feature), c.c.x, c.c.y, c.r);
    for (const sy of d.sam.symbols) {
      const lay = layerOf(sy.feature);
      w.point(lay, sy.x, sy.y, sy.z ?? 0);
      w.circle(lay, sy.x, sy.y, h * 0.5, sy.z ?? 0);
      w.text(lay, sy.x + h * 0.7, sy.y - h * 0.4, h * 0.8, L.get(sy.feature)?.name ?? sy.feature);
    }
  }
  if (o.boundary && p.boundary && p.boundary.length >= 3) w.polyline('BOUNDARY', p.boundary, true);
  const al = d.alignment;
  if (o.alignment && al) {
    w.polyline('IP_LINE', al.input.ips, false);
    const pts = [];
    const ds = Math.max(al.length / 2000, 0.5);
    for (let s = al.startStation; s < al.endStation; s += ds) pts.push(al.pointAt(s)!);
    pts.push(al.pointAt(al.endStation)!);
    w.polyline('AXIS', pts, false);
    for (const ip of al.input.ips) w.text('IP_LINE', ip.x + h * 0.5, ip.y + h * 0.5, h * 1.2, ip.name);
  }
  if (o.stakes && al) {
    for (const st of al.stakes) {
      const L = st.kind === 'full' ? 2 : 3.5;
      const a = al.pointAt(st.sta, -L)!, b = al.pointAt(st.sta, L)!;
      w.line('STAKE', a, b);
      const ang = (90 - st.az / DEG) - 90; // 文字沿右側法線方向
      w.text('STAKE_TXT', b.x, b.y, h, `${st.label ? st.label + ' ' : ''}${formatStation(st.sta)}`, ang);
    }
  }
  if (o.grid && grid) {
    for (const c of grid.cells) {
      const net = c.cut - c.fill;
      w.polyline(net >= 0 ? 'GRID_CUT' : 'GRID_FILL', [{ x: c.x0, y: c.y0 }, { x: c.x0 + c.size, y: c.y0 }, { x: c.x0 + c.size, y: c.y0 + c.size }, { x: c.x0, y: c.y0 + c.size }], true);
      w.text(net >= 0 ? 'GRID_CUT' : 'GRID_FILL', c.x0 + c.size * 0.1, c.y0 + c.size * 0.4, Math.min(h, c.size / 6), `${net >= 0 ? '+' : ''}${net.toFixed(1)}`);
    }
  }
  return w.toString();
}

const head = (p: Project) => [
  [`工程名稱`, p.info.name], [`工程編號`, p.info.code], [`業主`, p.info.owner], [`地點`, p.info.site], [`輸出時間`, new Date().toLocaleString('zh-TW')], [],
];

export function pointsCsv(p: Project) {
  return toCsv([['點號', 'E(X)', 'N(Y)', 'Z', '代碼'], ...p.points.map(q => [q.name, q.x.toFixed(3), q.y.toFixed(3), isValidZ(q.z, p.zRule) ? (q.z as number).toFixed(3) : '', q.code ?? ''])]);
}

export function gridCsv(p: Project, g: GridResult) {
  const rows: Array<Array<string | number>> = [...head(p), ['方格法土方計算表'], [`方格邊長 ${g.cell} m`], [], ['列', '行', '左下 E', '左下 N', '計算面積(m²)', '角點挖填高 h1', 'h2', 'h3', 'h4', '挖方(m³)', '填方(m³)']];
  for (const c of g.cells) rows.push([c.j + 1, c.i + 1, c.x0.toFixed(3), c.y0.toFixed(3), c.area.toFixed(3), ...c.corners.map(k => (k.dh ?? 0).toFixed(3)), c.cut.toFixed(3), c.fill.toFixed(3)]);
  rows.push([], ['合計', '', '', '', g.totalArea.toFixed(3), '', '', '', '', g.cut.toFixed(3), g.fill.toFixed(3)]);
  rows.push(['淨土方（挖−填）', '', '', '', '', '', '', '', '', (g.cut - g.fill).toFixed(3)]);
  if (g.skipped) rows.push([`邊界內有 ${g.skipped} 格、共 ${g.skippedArea.toFixed(2)} m² 沒有地形資料，未列入計算`]);
  return toCsv(rows);
}

export function curveCsv(p: Project, d: Derived) {
  const al = d.alignment;
  if (!al) return toCsv([['尚未建立中心線']]);
  const rows: Array<Array<string | number>> = [...head(p), ['平曲線資料表', al.input.name], [], ['IP', 'E', 'N', '偏角 Δ', 'R', '緩和曲線 Ls', 'T', 'L', 'E(外矢距)', 'M(中矢距)', 'TS/BC 樁號', 'SC 樁號', 'MC 樁號', 'CS 樁號', 'ST/EC 樁號']];
  for (const ip of al.input.ips) {
    const c = al.curves.find(k => al.input.ips[k.ipIndex] === ip);
    rows.push([ip.name, ip.x.toFixed(3), ip.y.toFixed(3), c ? `${c.delta >= 0 ? '右' : '左'} ${degToDmsText(Math.abs(c.delta) / DEG)}` : '', c ? c.R.toFixed(3) : '', c && c.ls ? c.ls.toFixed(3) : '', c ? c.T.toFixed(3) : '', c ? c.L.toFixed(3) : '', c ? c.E.toFixed(3) : '', c ? c.M.toFixed(3) : '', c ? formatStation(c.staTS) : '', c && c.ls ? formatStation(c.staBC) : '', c ? formatStation(c.staMC) : '', c && c.ls ? formatStation(c.staEC) : '', c ? formatStation(c.staST) : '']);
  }
  rows.push([], [`中心線全長 ${al.length.toFixed(3)} m`, `${formatStation(al.startStation)} ~ ${formatStation(al.endStation)}`]);
  return toCsv(rows);
}

export function stakeCsv(p: Project, d: Derived) {
  const rw = d.roadway;
  const rows: Array<Array<string | number>> = [...head(p), ['樁號座標及縱斷面資料表'], [], ['樁號', '點名', 'E', 'N', '方位角', '地面高', '設計高', '挖填高(+挖/−填)', ...(rw ? ['左橫坡%', '右橫坡%', '左加寬', '右加寬'] : [])]];
  for (const r of d.stakeRows) {
    const st = rw?.stateAt(r.stake.sta);
    rows.push([formatStation(r.stake.sta), r.stake.label, r.stake.x.toFixed(3), r.stake.y.toFixed(3), degToDmsText(r.stake.az / DEG), r.ground?.toFixed(3) ?? '', r.design?.toFixed(3) ?? '', r.dh?.toFixed(3) ?? '',
      ...(st ? [st.fallL.toFixed(2), st.fallR.toFixed(2), st.widenL.toFixed(2), st.widenR.toFixed(2)] : [])]);
  }
  return toCsv(rows);
}

export function volumeCsv(p: Project, d: Derived) {
  const t = p.template;
  const rows: Array<Array<string | number>> = [...head(p), ['土石方數量計算表（平均斷面法）'],
    [`路面寬 左 ${t.widthL} m / 右 ${t.widthR} m，路拱 ${t.crossfall}%，挖方邊坡 1:${t.cutSlope}，填方邊坡 1:${t.fillSlope}`], [],
    ['樁號', '點名', '樁距 L(m)', '挖方面積 At(m²)', '填方面積 Af(m²)', '區間挖方(m³)', '區間填方(m³)', '累計挖方(m³)', '累計填方(m³)', '土方累積(挖−填)', '備註']];
  d.volumes.forEach((v, i) => {
    const sec = d.sections[i];
    rows.push([formatStation(v.sta), v.label, v.dist.toFixed(3), v.ok ? v.cutArea.toFixed(3) : '', v.ok ? v.fillArea.toFixed(3) : '', v.cutVol.toFixed(3), v.fillVol.toFixed(3), v.cumCut.toFixed(3), v.cumFill.toFixed(3), v.mass.toFixed(3), sec?.reason ?? '']);
  });
  const last = d.volumes[d.volumes.length - 1];
  if (last) rows.push([], ['合計', '', '', '', '', last.cumCut.toFixed(3), last.cumFill.toFixed(3), '', '', last.mass.toFixed(3), last.mass >= 0 ? '餘土（棄土）' : '缺土（借土）']);
  if (d.quantities.length) {
    rows.push([], ['構造物數量（平均斷面法）'], ['構造物', '材料', '數量(m³)']);
    for (const q of d.quantities) rows.push([q.unit, q.material, q.volume.toFixed(3)]);
    rows.push(['註：填方面積量到完成面，含構造物所佔體積']);
  }
  return toCsv(rows);
}
