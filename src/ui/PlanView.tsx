// 平面定線圖（v3.4 風格）：平移縮放、圖層、IP 拖曳改線、圖面加樁、翻網格、補點、小地圖、迷航救援
import { useEffect, useRef, useState, useCallback } from 'react';
import type { XY, Bounds } from '../core/geom';
import { boundsOf } from '../core/geom';
import type { SurveyPoint, ZRule, BackdropItem } from '../core/model';
import { isValidZ } from '../core/model';
import type { Tin, ContourLine } from '../core/tin';
import type { Alignment } from '../core/alignment';
import type { GridResult } from '../core/earthwork-grid';
import { formatStation } from '../core/units';
import type { SamResult, LegendItem } from '../core/sam';

export type Tool = 'pan' | 'axis' | 'addsta' | 'addpt' | 'flip' | 'boundary';

export interface Layers {
  backdrop: boolean; axis: boolean; roadEdge: boolean; ipTangents: boolean; centipede: boolean; curveCentipede: boolean;
  cont1: boolean; cont5: boolean; contLabel: boolean; tin: boolean; points: boolean; ptZ: boolean; slopeShade: boolean;
  grid: boolean; sam: boolean; boundary: boolean; controls: boolean; stakes: boolean; ipTable: boolean;
}

export const DEFAULT_LAYERS: Layers = {
  backdrop: true, axis: true, roadEdge: true, ipTangents: true, centipede: true, curveCentipede: false,
  cont1: true, cont5: true, contLabel: true, tin: false, points: true, ptZ: false, slopeShade: false,
  grid: true, sam: true, boundary: true, controls: true, stakes: true, ipTable: true,
};

/** 疊加線：導線、觀測方向等 */
export interface Overlay { pts: XY[]; color: string; width?: number; dash?: boolean; labels?: string[] }

export interface PlanViewProps {
  points: SurveyPoint[];
  controls: Array<{ name: string; x: number; y: number }>;
  overlays: Overlay[];
  sam: SamResult | null;
  legend: LegendItem[];
  backdrop: BackdropItem[] | null;
  zRule: ZRule;
  tin: Tin | null;
  contours: ContourLine[];
  boundary: XY[] | null;
  alignment: Alignment | null;
  /** 路寬邊線（左、右，m）與橫斷面線長（單側，m） */
  road: { L: number; R: number; half: number };
  grid: GridResult | null;
  layers: Layers;
  tool: Tool;
  draft: XY[];
  selectedSta: number | null;
  highlightPoint: number | null;
  /** 改變時縮放到地形主區 */
  fitKey: number;
  /** 改變時飛到指定點 */
  focus: { x: number; y: number; key: number } | null;
  onWorldClick(p: XY): void;
  onFinishDraft(): void;
  onCancelDraft(): void;
  onCursor(p: XY | null, z: number | null): void;
  onPickPoint(id: number | null): void;
  /** 拖曳 IP 改線：end 為放開滑鼠 */
  onIpDrag(index: number, p: XY, end: boolean): void;
}

interface View { cx: number; cy: number; s: number }

const C = {
  bg: '#090c10', grid: '#121a26', gridText: '#3a4a62',
  pt: '#00e676', ptNull: '#ff3b5c', label: '#8b9bb4',
  tin: 'rgba(120,150,190,0.25)', minor: 'rgba(255,170,0,0.55)', major: '#ffaa00',
  boundary: '#ffe600', axis: '#ffe600', edge: '#3b82f6', ip: '#ff3b5c', stake: '#00e676', curve: '#e879f9',
  cut: 'rgba(255,59,92,', fill: 'rgba(0,240,255,', draft: '#ffe600', sel: '#ffffff',
};

/** 去掉離群點後的主要地形範圍（四分位距） */
function coreBounds(pts: XY[]): Bounds | null {
  if (pts.length < 8) return boundsOf(pts);
  const q = (arr: number[], t: number) => { const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * t, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const [x1, x3, y1, y3] = [q(xs, 0.25), q(xs, 0.75), q(ys, 0.25), q(ys, 0.75)];
  const ix = Math.max(x3 - x1, 1), iy = Math.max(y3 - y1, 1);
  return boundsOf(pts.filter(p => p.x >= x1 - 3 * ix && p.x <= x3 + 3 * ix && p.y >= y1 - 3 * iy && p.y <= y3 + 3 * iy));
}

export function PlanView(props: PlanViewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ cx: 0, cy: 0, s: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const history = useRef<View[]>([]);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; ip: number } | null>(null);
  const hover = useRef<XY | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 主要地形範圍（測點、三角網、中心線） */
  const dataPts = useCallback((): XY[] => {
    const pts: XY[] = [];
    const step = Math.max(1, Math.floor(props.points.length / 4000));
    for (let i = 0; i < props.points.length; i += step) pts.push(props.points[i]);
    for (const c of props.controls) pts.push(c);
    if (props.alignment) props.alignment.input.ips.forEach(p => pts.push(p));
    if (props.boundary) pts.push(...props.boundary);
    return pts;
  }, [props.points, props.controls, props.alignment, props.boundary]);

  const setViewH = (v: View) => { history.current.push(viewRef.current); if (history.current.length > 30) history.current.shift(); setView(v); };

  const fit = useCallback(() => {
    const b = coreBounds(dataPts());
    if (b) setViewH(fitBounds(b, size.w, size.h));
  }, [dataPts, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fit(); }, [props.fitKey, size.w > 0 && size.h > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (props.focus) setViewH({ cx: props.focus.x, cy: props.focus.y, s: Math.max(viewRef.current.s, 4) });
  }, [props.focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (v: View, sx: number, sy: number) => ({ x: (sx - size.w / 2) / v.s + v.cx, y: (size.h / 2 - sy) / v.s + v.cy });

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
    const s = Math.min(Math.max(v.s * Math.exp(-e.deltaY * 0.0015), 1e-4), 2000);
    setView({ s, cx: w.x - (sx - size.w / 2) / s, cy: w.y - (size.h / 2 - sy) / s });
  };

  const ipNear = (sx: number, sy: number) => {
    const al = props.alignment;
    if (!al || !props.layers.ipTangents) return -1;
    const v = viewRef.current;
    let best = -1, bd = 10;
    al.input.ips.forEach((q, i) => {
      const d = Math.hypot((q.x - v.cx) * v.s + size.w / 2 - sx, size.h / 2 - (q.y - v.cy) * v.s - sy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    const ip = props.tool === 'pan' && e.button === 0 ? ipNear(e.clientX - r.left, e.clientY - r.top) : -1;
    drag.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false, ip };
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
      if (!d.moved) return;
      if (d.ip >= 0) props.onIpDrag(d.ip, w, false);
      else setView({ ...v, cx: d.cx - dx / v.s, cy: d.cy + dy / v.s });
    } else if (props.draft.length || props.tool !== 'pan') setView({ ...v });
    else {
      const el = ref.current!;
      el.style.cursor = ipNear(e.clientX - r.left, e.clientY - r.top) >= 0 ? 'move' : 'default';
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const r = ref.current!.getBoundingClientRect();
    const w = toWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top);
    if (d.ip >= 0 && d.moved) { props.onIpDrag(d.ip, w, true); return; }
    if (d.moved || e.button !== 0) return;
    if (props.tool === 'pan') {
      const v = viewRef.current;
      let best: number | null = null, bd = 10 / v.s;
      for (const p of props.points) { const dd = Math.hypot(p.x - w.x, p.y - w.y); if (dd < bd) { bd = dd; best = p.id; } }
      props.onPickPoint(best);
      return;
    }
    props.onWorldClick(w);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') props.onFinishDraft();
    if (e.key === 'Escape') props.onCancelDraft();
    if (e.key === 'f' || e.key === 'F') fit();
  };

  // 迷航：視野完全沒有地形
  const b = boundsOf(dataPts());
  const wx0 = view.cx - size.w / 2 / view.s, wx1 = view.cx + size.w / 2 / view.s, wy0 = view.cy - size.h / 2 / view.s, wy1 = view.cy + size.h / 2 / view.s;
  const lost = !!b && (b.maxX < wx0 || b.minX > wx1 || b.maxY < wy0 || b.minY > wy1);

  return (
    <div ref={wrap} className="planview" tabIndex={0} onKeyDown={onKey} onPointerLeave={() => { hover.current = null; props.onCursor(null, null); }}>
      <canvas
        ref={ref}
        style={{ width: size.w, height: size.h, cursor: props.tool === 'pan' ? undefined : 'crosshair' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => { if (props.tool === 'boundary' || props.tool === 'axis') props.onFinishDraft(); }}
        onContextMenu={e => { e.preventDefault(); if (props.draft.length) props.onFinishDraft(); }}
      />
      <div className="plan-tools">
        <button type="button" onClick={fit} title="縮放到地形主區（F）">全圖</button>
        <button type="button" onClick={() => setView(v => ({ ...v, s: v.s * 1.4 }))} title="放大">＋</button>
        <button type="button" onClick={() => setView(v => ({ ...v, s: v.s / 1.4 }))} title="縮小">－</button>
      </div>
      <ScaleBar s={view.s} />
      {b && <Minimap pts={dataPts()} bounds={b} view={{ x0: wx0, x1: wx1, y0: wy0, y1: wy1 }} onCenter={(x, y) => setViewH({ ...viewRef.current, cx: x, cy: y })} onFit={fit} />}
      {lost && (
        <div className="rescue">
          <b>🧭 目前視野偏離地形區</b>
          <div className="row">
            <button type="button" className="btn cyan" onClick={fit}>🎯 立即飛回地形主區 (F)</button>
            <button type="button" className="btn" disabled={!history.current.length} onClick={() => { const p = history.current.pop(); if (p) setView(p); }}>⬅ 返回上一視角</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Minimap(props: { pts: XY[]; bounds: Bounds; view: { x0: number; x1: number; y0: number; y1: number }; onCenter(x: number, y: number): void; onFit(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 170, H = 110;
  const { bounds: b } = props;
  const pad = 6;
  const s = Math.min((W - 2 * pad) / Math.max(b.maxX - b.minX, 1), (H - 2 * pad) / Math.max(b.maxY - b.minY, 1));
  const ox = pad + (W - 2 * pad - (b.maxX - b.minX) * s) / 2, oy = pad + (H - 2 * pad - (b.maxY - b.minY) * s) / 2;
  const X = (x: number) => ox + (x - b.minX) * s, Y = (y: number) => H - oy - (y - b.minY) * s;
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.fillStyle = '#070a0e'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#00e676';
    for (const p of props.pts) ctx.fillRect(X(p.x), Y(p.y), 1.2, 1.2);
    ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 1.5;
    const v = props.view;
    ctx.strokeRect(X(v.x0), Y(v.y1), (v.x1 - v.x0) * s, (v.y1 - v.y0) * s);
  });
  return (
    <div className="minimap" title="點擊雷達任意位置可立即移動視角">
      <div className="minimap-hdr"><span>🧭 地形導航雷達</span><span onClick={props.onFit}>[置中]</span></div>
      <canvas ref={ref} width={W} height={H} onClick={e => {
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        props.onCenter(b.minX + (e.clientX - r.left - ox) / s, b.minY + (H - (e.clientY - r.top) - oy) / s);
      }} />
    </div>
  );
}

function ScaleBar({ s }: { s: number }) {
  const target = 100 / s;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map(k => k * pow).find(v => v * s >= 60) ?? pow * 10;
  return <div className="scalebar"><div style={{ width: nice * s }} /><span>{nice >= 1 ? nice : nice.toFixed(2)} m</span></div>;
}

export function fitBounds(b: Bounds, w: number, h: number): View {
  const dx = Math.max(b.maxX - b.minX, 1), dy = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((w - 80) / dx, (h - 80) / dy);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, s: Math.max(s, 1e-4) };
}

function draw(ctx: CanvasRenderingContext2D, p: PlanViewProps, v: View, W: number, H: number, hover: XY | null) {
  const L = p.layers;
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

  // 原 DXF 彩色底圖
  if (L.backdrop && p.backdrop) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    for (const it of p.backdrop) {
      const pts = it.pts;
      let any = false;
      for (let i = 0; i < pts.length; i += 2) if (inView(pts[i], pts[i + 1], 30 / v.s)) { any = true; break; }
      if (!any) continue;
      ctx.strokeStyle = it.c;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo(X(pts[i]), Y(pts[i + 1])) : ctx.moveTo(X(pts[i]), Y(pts[i + 1])));
      if (it.closed) ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 坡度陰影：依三角形坡度分級上色
  if (L.slopeShade && p.tin) {
    const { xs, ys, zs, tri } = p.tin;
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      if (!inView(xs[a], ys[a], 50 / v.s)) continue;
      const ux = xs[b] - xs[a], uy = ys[b] - ys[a], uz = zs[b] - zs[a], vx = xs[c] - xs[a], vy = ys[c] - ys[a], vz = zs[c] - zs[a];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const slope = (Math.atan2(Math.hypot(nx, ny), Math.abs(nz)) * 180) / Math.PI;
      ctx.fillStyle = slope < 15 ? 'rgba(0,230,118,0.25)' : slope < 30 ? 'rgba(255,230,0,0.28)' : slope < 45 ? 'rgba(255,170,0,0.33)' : 'rgba(255,59,92,0.38)';
      ctx.beginPath(); ctx.moveTo(X(xs[a]), Y(ys[a])); ctx.lineTo(X(xs[b]), Y(ys[b])); ctx.lineTo(X(xs[c]), Y(ys[c])); ctx.closePath(); ctx.fill();
    }
  }

  // 方格土方
  if (L.grid && p.grid) {
    let maxH = 1e-6;
    for (const c of p.grid.cells) maxH = Math.max(maxH, Math.max(c.cut, c.fill) / Math.max(c.area, 1e-6));
    for (const c of p.grid.cells) {
      if (!inView(c.x0 + c.size / 2, c.y0 + c.size / 2, c.size)) continue;
      const net = (c.cut - c.fill) / Math.max(c.area, 1e-6);
      ctx.fillStyle = (net >= 0 ? C.cut : C.fill) + Math.min(0.7, 0.12 + (0.58 * Math.abs(net)) / maxH) + ')';
      ctx.fillRect(X(c.x0), Y(c.y0 + c.size), c.size * v.s, c.size * v.s);
    }
  }

  // TIN
  if (L.tin && p.tin) {
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

  // 等高線（首曲線、計曲線分開控制）
  for (const major of [false, true]) {
    if (major ? !L.cont5 : !L.cont1) continue;
    ctx.strokeStyle = major ? C.major : C.minor;
    ctx.lineWidth = major ? 1.5 : 0.7;
    ctx.beginPath();
    for (const l of p.contours) {
      if (l.major !== major) continue;
      l.pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    }
    ctx.stroke();
  }
  if (L.contLabel && L.cont5) {
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const placed: Array<{ x: number; y: number }> = [];
    for (const l of p.contours) {
      if (!l.major || l.pts.length < 3) continue;
      const mid = l.pts[Math.floor(l.pts.length / 2)], nxt = l.pts[Math.floor(l.pts.length / 2) + 1] ?? mid;
      if (!inView(mid.x, mid.y)) continue;
      let len = 0;
      for (let i = 1; i < l.pts.length && len < 140; i++) len += Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y) * v.s;
      if (len < 140) continue;
      const sxm = X(mid.x), sym = Y(mid.y);
      if (placed.some(q => Math.abs(q.x - sxm) < 70 && Math.abs(q.y - sym) < 22)) continue;
      placed.push({ x: sxm, y: sym });
      let ang = Math.atan2(-(nxt.y - mid.y), nxt.x - mid.x);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save(); ctx.translate(sxm, sym); ctx.rotate(ang);
      const t = trimNum(l.level), w = ctx.measureText(t).width + 6;
      ctx.fillStyle = C.bg; ctx.fillRect(-w / 2, -7, w, 14);
      ctx.fillStyle = C.major; ctx.fillText(t, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  if (L.sam && p.sam) drawSam(ctx, p.sam, p.legend, v, X, Y);

  if (L.boundary && p.boundary && p.boundary.length >= 3) {
    ctx.strokeStyle = 'rgba(255,230,0,0.6)'; ctx.lineWidth = 1.2; ctx.setLineDash([8, 5]);
    ctx.beginPath();
    p.boundary.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }

  // 測點：十字
  if (L.points) {
    const area = Math.max((wx1 - wx0) * (wy1 - wy0), 1);
    let nIn = 0;
    for (const q of p.points) if (inView(q.x, q.y)) nIn++;
    const roomy = nIn > 0 && Math.sqrt(area / nIn) * v.s > 45;
    ctx.font = '10px "JetBrains Mono", monospace';
    const r = v.s > 3 ? 3 : 2;
    ctx.lineWidth = 1;
    for (const q of p.points) {
      if (!inView(q.x, q.y)) continue;
      const ok = isValidZ(q.z, p.zRule);
      const sx = X(q.x), sy = Y(q.y);
      ctx.strokeStyle = ok ? C.pt : C.ptNull;
      ctx.beginPath(); ctx.moveTo(sx - r, sy); ctx.lineTo(sx + r, sy); ctx.moveTo(sx, sy - r); ctx.lineTo(sx, sy + r); ctx.stroke();
      if (L.ptZ && roomy) { ctx.fillStyle = C.label; ctx.fillText(ok ? (q.z as number).toFixed(2) : '無高程', sx + 4, sy - 3); }
    }
    if (p.highlightPoint !== null) {
      const q = p.points.find(t => t.id === p.highlightPoint);
      if (q) { ctx.strokeStyle = C.sel; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 9, 0, Math.PI * 2); ctx.stroke(); }
    }
  }

  // 中心線、路寬邊線、橫斷面線、IP 切線
  const al = p.alignment;
  if (al) {
    const ds = Math.max(al.length / 2000, 0.5 / v.s);
    const line = (off: number) => {
      ctx.beginPath();
      for (let s = al.startStation, i = 0; s <= al.endStation + ds; s += ds, i++) {
        const q = al.pointAt(Math.min(s, al.endStation), off)!;
        i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y));
      }
      ctx.stroke();
    };
    if (L.centipede || L.curveCentipede) {
      ctx.lineWidth = 0.8;
      for (const st of al.stakes) {
        const curve = ['BC', 'MC', 'EC', 'TS', 'SC', 'CS', 'ST'].includes(st.kind);
        if (curve ? !L.curveCentipede : !L.centipede) continue;
        ctx.strokeStyle = curve ? 'rgba(232,121,249,0.55)' : 'rgba(0,230,118,0.45)';
        const a = al.pointAt(st.sta, -p.road.half)!, b = al.pointAt(st.sta, p.road.half)!;
        ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      }
    }
    if (L.roadEdge) {
      ctx.strokeStyle = C.edge; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
      line(-p.road.L); line(p.road.R);
      ctx.setLineDash([]);
    }
    if (L.ipTangents) {
      ctx.strokeStyle = 'rgba(255,59,92,0.75)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      al.input.ips.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (L.axis) { ctx.strokeStyle = C.axis; ctx.lineWidth = 2.4; line(0); }
    if (L.ipTangents) {
      ctx.font = '600 11px "Noto Sans TC", sans-serif';
      for (const q of al.input.ips) {
        ctx.fillStyle = C.ip; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = C.ip; ctx.fillText(q.name, X(q.x) + 8, Y(q.y) - 7);
      }
    }
    if (L.stakes) {
      ctx.font = '10px "JetBrains Mono", monospace';
      const labelEvery = v.s < 0.8 ? 5 : v.s < 1.6 ? 2 : 1;
      al.stakes.forEach((st, idx) => {
        const special = st.kind !== 'full';
        const len = special ? 11 : 7;
        const nx = Math.cos(st.az), ny = -Math.sin(st.az);
        const sx = X(st.x), sy = Y(st.y);
        const sel = p.selectedSta !== null && Math.abs(p.selectedSta - st.sta) < 1e-6;
        ctx.strokeStyle = sel ? C.sel : special ? C.curve : C.stake; ctx.lineWidth = sel ? 2.5 : 1.3;
        ctx.beginPath(); ctx.moveTo(sx - nx * len, sy + ny * len); ctx.lineTo(sx + nx * len, sy - ny * len); ctx.stroke();
        if (special || idx % labelEvery === 0 || sel) {
          ctx.fillStyle = sel ? C.sel : special ? C.curve : C.label;
          const t = (st.label ? st.label + ' ' : '') + formatStation(st.sta, st.kind === 'full' ? 0 : 2);
          ctx.save(); ctx.translate(sx + nx * (len + 3), sy - ny * (len + 3));
          let ang = Math.atan2(-ny, nx);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) { ang += Math.PI; ctx.rotate(ang); ctx.textAlign = 'right'; } else ctx.rotate(ang);
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
    ctx.beginPath(); o.pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y)))); ctx.stroke(); ctx.setLineDash([]);
    if (o.labels) {
      ctx.fillStyle = o.color; ctx.font = '600 11px "JetBrains Mono", monospace';
      o.pts.forEach((q, i) => { if (o.labels![i]) { ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 3, 0, Math.PI * 2); ctx.fill(); ctx.fillText(o.labels![i], X(q.x) + 6, Y(q.y) + 14); } });
    }
  }

  // 控制點
  if (L.controls && p.controls.length) {
    ctx.font = '600 11px "JetBrains Mono", monospace';
    for (const c of p.controls) {
      if (!inView(c.x, c.y)) continue;
      const sx = X(c.x), sy = Y(c.y);
      ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 1.6; ctx.fillStyle = 'rgba(255,230,0,0.18)';
      ctx.beginPath(); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 6, sy + 4.5); ctx.lineTo(sx - 6, sy + 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe600'; ctx.fillText(c.name, sx + 8, sy - 6);
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
  // 圖面加樁：游標投影到中心線的預覽
  if (p.tool === 'addsta' && al && hover) {
    let best = al.startStation, bd = Infinity;
    for (let s = al.startStation; s <= al.endStation; s += Math.max(al.length / 800, 0.2)) { const q = al.pointAt(s)!; const d = (q.x - hover.x) ** 2 + (q.y - hover.y) ** 2; if (d < bd) { bd = d; best = s; } }
    const q = al.pointAt(best)!;
    ctx.strokeStyle = C.curve; ctx.lineWidth = 2;
    const a = al.pointAt(best, -p.road.half)!, b2 = al.pointAt(best, p.road.half)!;
    ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b2.x), Y(b2.y)); ctx.stroke();
    ctx.fillStyle = C.curve; ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillText(formatStation(best), X(q.x) + 10, Y(q.y) - 10);
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
        const side = ln.reverse ? 1 : -1;
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
      case 'tree': ctx.arc(x, y, 5, 0, Math.PI * 2); for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; ctx.moveTo(x, y); ctx.lineTo(x + 5 * Math.cos(a), y + 5 * Math.sin(a)); } ctx.stroke(); break;
      case 'lamp': ctx.arc(x, y, 2.5, 0, Math.PI * 2); for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; ctx.moveTo(x + 4 * Math.cos(a), y + 4 * Math.sin(a)); ctx.lineTo(x + 6.5 * Math.cos(a), y + 6.5 * Math.sin(a)); } ctx.stroke(); break;
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
