// 平面圖畫布：平移縮放、圖層繪製、點選與繪製工具
import { useEffect, useRef, useState, useCallback } from 'react';
import type { XY, Bounds } from '../core/geom';
import { boundsOf } from '../core/geom';
import type { SurveyPoint, ZRule } from '../core/model';
import { isValidZ } from '../core/model';
import type { Tin, ContourLine } from '../core/tin';
import type { Alignment } from '../core/alignment';
import type { GridResult } from '../core/earthwork-grid';
import { formatStation } from '../core/units';
import type { SamResult, LegendItem } from '../core/sam';

export type Tool = 'pan' | 'boundary' | 'ip' | 'addpt' | 'measure';

export interface Layers {
  points: boolean; labels: boolean; tin: boolean; contours: boolean; contourLabels: boolean;
  boundary: boolean; alignment: boolean; stakes: boolean; grid: boolean; sam: boolean;
}

/** 疊加線：導線、觀測方向等 */
export interface Overlay { pts: XY[]; color: string; width?: number; dash?: boolean; labels?: string[] }

export interface PlanViewProps {
  points: SurveyPoint[];
  controls: Array<{ name: string; x: number; y: number }>;
  overlays: Overlay[];
  sam: SamResult | null;
  legend: LegendItem[];
  zRule: ZRule;
  tin: Tin | null;
  contours: ContourLine[];
  boundary: XY[] | null;
  alignment: Alignment | null;
  grid: GridResult | null;
  layers: Layers;
  tool: Tool;
  /** 繪製中的折線（邊界或 IP） */
  draft: XY[];
  selectedSta: number | null;
  highlightPoint: number | null;
  fitKey: number;
  onWorldClick(p: XY, e: { double: boolean }): void;
  onFinishDraft(): void;
  onCancelDraft(): void;
  onCursor(p: XY | null, z: number | null): void;
  onPickPoint(id: number | null): void;
}

interface View { cx: number; cy: number; s: number }

const C = {
  bg: '#0b0f14', grid: '#151c26', gridText: '#3d4a5e',
  pt: '#3ddc84', ptNull: '#ff5c7a', label: '#9fb0c6',
  tin: 'rgba(110,140,180,0.22)', minor: 'rgba(214,150,88,0.55)', major: '#e3a35f',
  boundary: '#f5d76e', axis: '#4fd1ff', stake: '#4fd1ff', curve: '#ff9de2',
  cut: 'rgba(255,92,92,', fill: 'rgba(79,163,255,', draft: '#ffe066', sel: '#ffffff',
};

export function PlanView(props: PlanViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ cx: 0, cy: 0, s: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const hover = useRef<XY | null>(null);

  // 尺寸
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts: XY[] = [];
    for (const p of props.points) pts.push(p);
    for (const c of props.controls) pts.push(c);
    if (props.boundary) pts.push(...props.boundary);
    if (props.alignment) props.alignment.input.ips.forEach(p => pts.push(p));
    const b = boundsOf(pts);
    if (!b) return;
    setView(fitBounds(b, size.w, size.h));
  }, [props.points, props.controls, props.boundary, props.alignment, size.w, size.h]);

  // fitKey 改變（載入新資料）時縮放到全圖
  useEffect(() => { fit(); }, [props.fitKey, size.w > 0 && size.h > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (v: View, sx: number, sy: number) => ({ x: (sx - size.w / 2) / v.s + v.cx, y: (size.h / 2 - sy) / v.s + v.cy });

  // 繪圖
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, props, view, size.w, size.h, hover.current);
  });

  const onWheel = (e: React.WheelEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const v = viewRef.current;
    const w = toWorld(v, sx, sy);
    const k = Math.exp(-e.deltaY * 0.0015);
    const s = Math.min(Math.max(v.s * k, 1e-4), 2000);
    // 保持游標下的世界座標不動
    setView({ s, cx: w.x - (sx - size.w / 2) / s, cy: w.y - (size.h / 2 - sy) / s });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const v = viewRef.current;
    drag.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    const w = toWorld(v, e.clientX - r.left, e.clientY - r.top);
    hover.current = w;
    props.onCursor(w, props.tin ? props.tin.sample(w.x, w.y) : null);
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) setView({ ...v, cx: d.cx - dx / v.s, cy: d.cy + dy / v.s });
    } else if (props.draft.length) {
      // 重繪橡皮筋線
      setView({ ...v });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || e.button !== 0) return;
    const r = ref.current!.getBoundingClientRect();
    const w = toWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top);
    if (props.tool === 'pan') {
      // 點選最近的測點
      const v = viewRef.current;
      let best: number | null = null, bd = 10 / v.s;
      for (const p of props.points) {
        const dd = Math.hypot(p.x - w.x, p.y - w.y);
        if (dd < bd) { bd = dd; best = p.id; }
      }
      props.onPickPoint(best);
      return;
    }
    props.onWorldClick(w, { double: false });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') props.onFinishDraft();
    if (e.key === 'Escape') props.onCancelDraft();
    if (e.key === 'f' || e.key === 'F') fit();
  };

  return (
    <div ref={wrap} className="planview" tabIndex={0} onKeyDown={onKey} onPointerLeave={() => { hover.current = null; props.onCursor(null, null); }}>
      <canvas
        ref={ref}
        style={{ width: size.w, height: size.h, cursor: props.tool === 'pan' ? (drag.current?.moved ? 'grabbing' : 'default') : 'crosshair' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => { if (props.tool === 'boundary' || props.tool === 'ip') props.onFinishDraft(); }}
        onContextMenu={e => { e.preventDefault(); if (props.draft.length) props.onFinishDraft(); }}
      />
      <div className="plan-tools">
        <button type="button" onClick={fit} title="縮放到全圖（F）">全圖</button>
        <button type="button" onClick={() => setView(v => ({ ...v, s: v.s * 1.4 }))} title="放大">＋</button>
        <button type="button" onClick={() => setView(v => ({ ...v, s: v.s / 1.4 }))} title="縮小">－</button>
      </div>
      <ScaleBar s={view.s} />
    </div>
  );
}

function ScaleBar({ s }: { s: number }) {
  // 選一個 60~150px 之間的整數長度
  const target = 100 / s;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map(k => k * pow).find(v => v * s >= 60) ?? pow * 10;
  return (
    <div className="scalebar">
      <div style={{ width: nice * s }} />
      <span>{nice >= 1 ? nice : nice.toFixed(2)} m</span>
    </div>
  );
}

export function fitBounds(b: Bounds, w: number, h: number): View {
  const dx = Math.max(b.maxX - b.minX, 1), dy = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((w - 60) / dx, (h - 60) / dy);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, s: Math.max(s, 1e-4) };
}

function draw(ctx: CanvasRenderingContext2D, p: PlanViewProps, v: View, W: number, H: number, hover: XY | null) {
  const X = (x: number) => (x - v.cx) * v.s + W / 2;
  const Y = (y: number) => H / 2 - (y - v.cy) * v.s;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const wx0 = v.cx - W / 2 / v.s, wx1 = v.cx + W / 2 / v.s, wy0 = v.cy - H / 2 / v.s, wy1 = v.cy + H / 2 / v.s;
  const inView = (x: number, y: number, pad = 0) => x >= wx0 - pad && x <= wx1 + pad && y >= wy0 - pad && y <= wy1 + pad;

  // 座標格線
  const step = niceStep(110 / v.s);
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = C.gridText;
  ctx.beginPath();
  for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), H); }
  for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) { ctx.moveTo(0, Y(y)); ctx.lineTo(W, Y(y)); }
  ctx.stroke();
  for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) ctx.fillText(`E ${trimNum(x)}`, X(x) + 3, H - 6);
  for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) ctx.fillText(`N ${trimNum(y)}`, 4, Y(y) - 3);

  // 方格土方
  if (p.layers.grid && p.grid) {
    const maxH = Math.max(1e-6, ...p.grid.cells.map(c => Math.max(c.cut, c.fill) / Math.max(c.area, 1e-6)));
    for (const c of p.grid.cells) {
      if (!inView(c.x0 + c.size / 2, c.y0 + c.size / 2, c.size)) continue;
      const net = (c.cut - c.fill) / Math.max(c.area, 1e-6);
      const a = Math.min(0.75, 0.12 + 0.63 * Math.abs(net) / maxH);
      ctx.fillStyle = (net >= 0 ? C.cut : C.fill) + a + ')';
      ctx.fillRect(X(c.x0), Y(c.y0 + c.size), c.size * v.s, c.size * v.s);
    }
    if (p.grid.cell * v.s > 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      for (const c of p.grid.cells) ctx.rect(X(c.x0), Y(c.y0 + c.size), c.size * v.s, c.size * v.s);
      ctx.stroke();
    }
  }

  // TIN
  if (p.layers.tin && p.tin) {
    const { xs, ys, tri } = p.tin;
    ctx.strokeStyle = C.tin; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      if (!inView(xs[a], ys[a], 50 / v.s) && !inView(xs[b], ys[b], 50 / v.s)) continue;
      ctx.moveTo(X(xs[a]), Y(ys[a])); ctx.lineTo(X(xs[b]), Y(ys[b])); ctx.lineTo(X(xs[c]), Y(ys[c])); ctx.closePath();
    }
    ctx.stroke();
  }

  // 等高線
  if (p.layers.contours && p.contours.length) {
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? C.major : C.minor;
      ctx.lineWidth = major ? 1.6 : 0.8;
      ctx.beginPath();
      for (const l of p.contours) {
        if (l.major !== major) continue;
        l.pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
      }
      ctx.stroke();
    }
    if (p.layers.contourLabels) {
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const placed: Array<{ x: number; y: number }> = [];
      for (const l of p.contours) {
        if (!l.major || l.pts.length < 3) continue;
        const mid = l.pts[Math.floor(l.pts.length / 2)], nxt = l.pts[Math.floor(l.pts.length / 2) + 1] ?? mid;
        if (!inView(mid.x, mid.y)) continue;
        // 太短的線不標；和已標註的位置太近也不標，避免文字疊在一起
        let len = 0;
        for (let i = 1; i < l.pts.length && len < 140; i++) len += Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y) * v.s;
        if (len < 140) continue;
        const sxm = X(mid.x), sym = Y(mid.y);
        if (placed.some(q => Math.abs(q.x - sxm) < 70 && Math.abs(q.y - sym) < 22)) continue;
        placed.push({ x: sxm, y: sym });
        let ang = Math.atan2(-(nxt.y - mid.y), nxt.x - mid.x);
        if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(X(mid.x), Y(mid.y)); ctx.rotate(ang);
        const t = trimNum(l.level);
        const w = ctx.measureText(t).width + 6;
        ctx.fillStyle = C.bg; ctx.fillRect(-w / 2, -7, w, 14);
        ctx.fillStyle = C.major; ctx.fillText(t, 0, 0);
        ctx.restore();
      }
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }

  // 自動連線地物
  if (p.layers.sam && p.sam) drawSam(ctx, p.sam, p.legend, v, X, Y);

  // 邊界
  if (p.layers.boundary && p.boundary && p.boundary.length >= 3) {
    ctx.strokeStyle = C.boundary; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]);
    ctx.beginPath();
    p.boundary.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }

  // 測點
  if (p.layers.points) {
    // 依點密度決定是否標註：平均點距在螢幕上大於約 45px 才顯示
    const area = Math.max((wx1 - wx0) * (wy1 - wy0), 1);
    const nIn = p.points.reduce((n, q) => n + (inView(q.x, q.y) ? 1 : 0), 0);
    const showLabels = p.layers.labels && nIn > 0 && Math.sqrt(area / nIn) * v.s > 45;
    ctx.font = '10px "JetBrains Mono", monospace';
    const r = v.s > 3 ? 2.5 : 1.6;
    for (const q of p.points) {
      if (!inView(q.x, q.y)) continue;
      const ok = isValidZ(q.z, p.zRule);
      ctx.fillStyle = ok ? C.pt : C.ptNull;
      const sx = X(q.x), sy = Y(q.y);
      if (ok) ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      else { ctx.beginPath(); ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2); ctx.fill(); }
      if (showLabels) {
        ctx.fillStyle = C.label;
        ctx.fillText(ok ? (q.z as number).toFixed(2) : '無高程', sx + 4, sy - 3);
        if (v.s > 6) { ctx.fillStyle = C.gridText; ctx.fillText(q.name, sx + 4, sy + 9); }
      }
    }
    if (p.highlightPoint !== null) {
      const q = p.points.find(t => t.id === p.highlightPoint);
      if (q) {
        ctx.strokeStyle = C.sel; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 9, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // 中心線
  if (p.layers.alignment && p.alignment) {
    const al = p.alignment;
    // IP 導線
    ctx.strokeStyle = 'rgba(255,92,122,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    al.input.ips.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    ctx.stroke(); ctx.setLineDash([]);
    // 中心線（每 0.5px 一點）
    ctx.strokeStyle = C.axis; ctx.lineWidth = 2.4;
    ctx.beginPath();
    const ds = Math.max(al.length / 2000, 0.5 / v.s);
    for (let s = al.startStation, i = 0; s <= al.endStation + ds; s += ds, i++) {
      const q = al.pointAt(Math.min(s, al.endStation))!;
      i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y));
    }
    ctx.stroke();
    // IP 點
    ctx.font = '600 11px "Noto Sans TC", sans-serif';
    for (const q of al.input.ips) {
      ctx.fillStyle = '#ff5c7a';
      ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(q.name, X(q.x) + 7, Y(q.y) - 6);
    }
    // 樁號
    if (p.layers.stakes) {
      ctx.font = '10px "JetBrains Mono", monospace';
      const labelEvery = v.s < 0.8 ? 5 : v.s < 1.6 ? 2 : 1;
      al.stakes.forEach((st, idx) => {
        const special = st.kind !== 'full';
        const len = (special ? 11 : 7);
        const nx = Math.cos(st.az), ny = -Math.sin(st.az); // 右側法向（世界座標）
        const sx = X(st.x), sy = Y(st.y);
        const sel = p.selectedSta !== null && Math.abs(p.selectedSta - st.sta) < 1e-6;
        ctx.strokeStyle = sel ? C.sel : special ? C.curve : C.stake; ctx.lineWidth = sel ? 2.5 : 1.2;
        ctx.beginPath(); ctx.moveTo(sx - nx * len, sy + ny * len); ctx.lineTo(sx + nx * len, sy - ny * len); ctx.stroke();
        if (special || idx % labelEvery === 0 || sel) {
          ctx.fillStyle = sel ? C.sel : special ? C.curve : C.label;
          const t = (st.label ? st.label + ' ' : '') + formatStation(st.sta, st.kind === 'full' ? 0 : 2);
          ctx.save(); ctx.translate(sx + nx * (len + 3), sy - ny * (len + 3));
          // 文字沿樁號線（法線）方向書寫，保持正向可讀
          let ang = Math.atan2(-ny, nx);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) { ang += Math.PI; ctx.rotate(ang); ctx.textAlign = 'right'; }
          else ctx.rotate(ang);
          ctx.fillText(t, 0, 3); ctx.restore(); ctx.textAlign = 'start';
        }
      });
    }
  }

  // 疊加線
  for (const o of p.overlays) {
    if (o.pts.length < 2) continue;
    ctx.strokeStyle = o.color; ctx.lineWidth = o.width ?? 1.5;
    if (o.dash) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    o.pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    ctx.stroke(); ctx.setLineDash([]);
    if (o.labels) {
      ctx.fillStyle = o.color; ctx.font = '600 11px "JetBrains Mono", monospace';
      o.pts.forEach((q, i) => { if (o.labels![i]) { ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 3, 0, Math.PI * 2); ctx.fill(); ctx.fillText(o.labels![i], X(q.x) + 6, Y(q.y) + 14); } });
    }
  }

  // 控制點（三角形）
  if (p.controls.length) {
    ctx.font = '600 11px "JetBrains Mono", monospace';
    for (const c of p.controls) {
      if (!inView(c.x, c.y)) continue;
      const sx = X(c.x), sy = Y(c.y);
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.6; ctx.fillStyle = 'rgba(255,224,102,0.18)';
      ctx.beginPath(); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 6, sy + 4.5); ctx.lineTo(sx - 6, sy + 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe066'; ctx.fillText(c.name, sx + 8, sy - 6);
    }
  }

  // 繪製中的折線
  if (p.draft.length) {
    ctx.strokeStyle = C.draft; ctx.lineWidth = 1.8; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    p.draft.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    if (hover) ctx.lineTo(X(hover.x), Y(hover.y));
    if (p.tool === 'boundary' && p.draft.length > 1) ctx.lineTo(X(p.draft[0].x), Y(p.draft[0].y));
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.draft;
    for (const q of p.draft) { ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 3.5, 0, Math.PI * 2); ctx.fill(); }
  }
}

function drawSam(ctx: CanvasRenderingContext2D, sam: SamResult, legend: LegendItem[], v: View, X: (x: number) => number, Y: (y: number) => number) {
  const L = new Map(legend.map(l => [l.code.toUpperCase(), l]));
  for (const ln of sam.lines) {
    const it = L.get(ln.feature);
    const col = it?.color ?? '#cbd5e0';
    ctx.strokeStyle = col;
    ctx.lineWidth = it?.code === 'BD' ? 1.8 : 1.4;
    ctx.setLineDash(it?.style === 'dash' ? [8, 5] : it?.style === 'dot' ? [2, 4] : []);
    ctx.beginPath();
    ln.pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    if (ln.closed) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // 圍牆、駁坎、柵欄：沿線加短刻線（正向畫在右側、反向畫在左側）
    const st = it?.style;
    if ((st === 'wall' || st === 'bank' || st === 'fence') && v.s > 1.2) {
      const gap = st === 'bank' ? 2 : st === 'wall' ? 3 : 4, len = st === 'bank' ? 1.2 : 0.6;
      const ring = ln.closed ? [...ln.pts, ln.pts[0]] : ln.pts;
      ctx.beginPath();
      let carry = 0;
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < 1e-9) continue;
        const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        const side = ln.reverse ? 1 : -1; // 右側法向 = (uy, −ux)
        const nx = -side * uy, ny = side * ux;
        for (let t = gap - carry; t < d; t += gap) {
          const px = a.x + ux * t, py = a.y + uy * t;
          if (st === 'fence') { ctx.moveTo(X(px) - 3, Y(py) - 3); ctx.lineTo(X(px) + 3, Y(py) + 3); ctx.moveTo(X(px) + 3, Y(py) - 3); ctx.lineTo(X(px) - 3, Y(py) + 3); }
          else { ctx.moveTo(X(px), Y(py)); ctx.lineTo(X(px + nx * len), Y(py + ny * len)); }
        }
        carry = (carry + d) % gap;
      }
      ctx.stroke();
    }
    if (ln.label && ln.labelAt) {
      ctx.fillStyle = col; ctx.font = '600 12px "Noto Sans TC", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(ln.label, X(ln.labelAt.x), Y(ln.labelAt.y) + 4); ctx.textAlign = 'start';
    }
  }
  for (const c of sam.circles) {
    ctx.strokeStyle = L.get(c.feature)?.color ?? '#cbd5e0'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(X(c.c.x), Y(c.c.y), c.r * v.s, 0, Math.PI * 2); ctx.stroke();
  }
  for (const sy of sam.symbols) {
    const it = L.get(sy.feature);
    const x = X(sy.x), y = Y(sy.y);
    ctx.strokeStyle = it?.color ?? '#fff'; ctx.fillStyle = it?.color ?? '#fff'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    switch (it?.symbol) {
      case 'pole': ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); break;
      case 'tel': ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.moveTo(x - 3, y - 2); ctx.lineTo(x + 3, y - 2); ctx.moveTo(x, y - 2); ctx.lineTo(x, y + 3); ctx.stroke(); break;
      case 'manhole': ctx.rect(x - 4, y - 4, 8, 8); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.stroke(); break;
      case 'hydrant': ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); break;
      case 'tree': ctx.arc(x, y, 5, 0, Math.PI * 2); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.moveTo(x, y); ctx.lineTo(x + 5 * Math.cos(a), y + 5 * Math.sin(a)); } ctx.stroke(); break;
      case 'lamp': ctx.arc(x, y, 2.5, 0, Math.PI * 2); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ctx.moveTo(x + 4 * Math.cos(a), y + 4 * Math.sin(a)); ctx.lineTo(x + 6.5 * Math.cos(a), y + 6.5 * Math.sin(a)); } ctx.stroke(); break;
      default: ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.stroke();
    }
  }
}

function niceStep(raw: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const k of [1, 2, 5, 10]) if (k * pow >= raw) return k * pow;
  return 10 * pow;
}
function trimNum(v: number) { return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
