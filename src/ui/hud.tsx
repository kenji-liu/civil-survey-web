// 平面圖 HUD：左上提示標籤、右上圖例、可拖曳的 IP 曲線要素表
import { useRef, useState } from 'react';
import type { Alignment } from '../core/alignment';
import { DEG, degToDmsText, formatStation } from '../core/units';

export function HudBadges({ lines }: { lines: Array<{ text: string; tip?: boolean }> }) {
  return <div className="hud-tl">{lines.map((l, i) => <div key={i} className={`hud-badge ${l.tip ? 'tip' : ''}`}>{l.text}</div>)}</div>;
}

export function HudLegend({ grid }: { grid: boolean }) {
  const rows: Array<[string, string, boolean?]> = [
    ['#ffe600', '平曲線中心線 (AXIS)'], ['#3b82f6', '路寬／河寬邊線'], ['#ff3b5c', 'IP 交點與切線'],
    ['#e879f9', '整樁剖線 (蜈蚣腳)'], ['#ffaa00', '計曲線 CONT5'], ['rgba(255,170,0,.55)', '首曲線 CONT1'], ['#00e676', '實測高程點'],
  ];
  return (
    <div className="hud-legend" aria-label="圖例">
      {rows.map(([c, t]) => <div key={t} className="legend-row"><span className="legend-line" style={{ background: c }} />{t}</div>)}
      {grid && <>
        <div className="legend-row"><span className="legend-line" style={{ background: '#ff3b5c', height: 8 }} />方格挖方</div>
        <div className="legend-row"><span className="legend-line" style={{ background: '#00f0ff', height: 8 }} />方格填方</div>
      </>}
    </div>
  );
}

const f3 = (v: number) => v.toFixed(3);

/** 圖面曲線要素表（可拖曳標題列移動） */
export function IpOverlay({ al, onClose }: { al: Alignment; onClose(): void }) {
  const [pos, setPos] = useState({ x: 14, y: 120 });
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const curves = al.curves;
  if (!curves.length) return null;
  return (
    <div className="ip-overlay" style={{ left: pos.x, top: pos.y }}>
      <div className="ip-overlay-head"
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y }; }}
        onPointerMove={e => { const g = drag.current; if (g) setPos({ x: Math.max(0, g.x + e.clientX - g.sx), y: Math.max(0, g.y + e.clientY - g.sy) }); }}
        onPointerUp={() => { drag.current = null; }}>
        <span>📋 平曲線要素表（拖曳移動）</span>
        <button type="button" aria-label="關閉曲線表" onPointerDown={e => e.stopPropagation()} onClick={onClose}>✕</button>
      </div>
      <table>
        <thead>
          <tr><th />{curves.map(c => <th key={c.ipIndex}>{c.name}</th>)}</tr>
        </thead>
        <tbody>
          <tr><td>θ 偏角</td>{curves.map(c => <td key={c.ipIndex}>{c.delta >= 0 ? '右' : '左'}{degToDmsText(Math.abs(c.delta) / DEG)}</td>)}</tr>
          <tr><td>R 半徑</td>{curves.map(c => <td key={c.ipIndex}>{f3(c.R)}</td>)}</tr>
          {curves.some(c => c.ls > 0) && <tr><td>Ls 緩和</td>{curves.map(c => <td key={c.ipIndex}>{c.ls ? f3(c.ls) : '-'}</td>)}</tr>}
          <tr><td>TL 切線</td>{curves.map(c => <td key={c.ipIndex}>{f3(c.T)}</td>)}</tr>
          <tr><td>CL 曲線</td>{curves.map(c => <td key={c.ipIndex}>{f3(c.L)}</td>)}</tr>
          <tr><td>SL 矢距</td>{curves.map(c => <td key={c.ipIndex}>{f3(c.E)}</td>)}</tr>
          <tr><td>{curves.some(c => c.ls) ? 'BC/TS' : 'BC'}</td>{curves.map(c => <td key={c.ipIndex} className="sta">{formatStation(c.ls ? c.staTS : c.staBC)}</td>)}</tr>
          <tr><td>MC</td>{curves.map(c => <td key={c.ipIndex} className="sta">{formatStation(c.staMC)}</td>)}</tr>
          <tr><td>{curves.some(c => c.ls) ? 'EC/ST' : 'EC'}</td>{curves.map(c => <td key={c.ipIndex} className="sta">{formatStation(c.ls ? c.staST : c.staEC)}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}
