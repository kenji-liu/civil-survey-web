// 全螢幕橫斷面（v3.4）：全線斷面矩陣總覽（一頁多圖）或單一樁號精細放大圖（含標尺）
import { useEffect, useRef, useState } from 'react';
import type { SectionRow } from '../store/derived';
import { groundAt, type OZ } from '../core/section';
import { formatStation } from '../core/units';

const COL = { bg: '#070a0e', grid: '#151e2c', txt: '#8b9bb4', ground: '#e2e8f0', design: '#3b82f6', cut: 'rgba(255,230,0,0.33)', fill: 'rgba(255,59,92,0.32)', cl: '#ff3b5c', solid: 'rgba(203,213,224,0.5)' };

function drawSection(ctx: CanvasRenderingContext2D, row: SectionRow, W: number, H: number, detail: boolean) {
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
  const r = row.result;
  const title = `樁號: ${formatStation(row.stake.sta)}${row.stake.label ? `（${row.stake.label}）` : ''}`;
  ctx.font = `600 ${detail ? 14 : 11}px "JetBrains Mono", "Noto Sans TC", monospace`;
  ctx.fillStyle = '#ffaa00'; ctx.fillText(title, 8, detail ? 22 : 15);
  if (!r) { ctx.fillStyle = COL.txt; ctx.fillText(row.reason ?? '無法計算', 8, 40); return; }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ff6b81'; ctx.fillText(`挖:${r.cutArea.toFixed(1)}m²`, W - 8 - (detail ? 140 : 76), detail ? 22 : 15);
  ctx.fillStyle = '#00f0ff'; ctx.fillText(`填:${r.fillArea.toFixed(1)}m²`, W - 8, detail ? 22 : 15);
  ctx.textAlign = 'start';
  // 設計線外 5 m 的地面線
  const o0 = Math.min(...r.design.map(q => q.o)) - 5, o1 = Math.max(...r.design.map(q => q.o)) + 5;
  const ground = r.ground.filter(q => q.o >= o0 && q.o <= o1);
  const all: OZ[] = [...ground, ...r.design, ...(row.solids ?? []).flatMap(s => s.poly)];
  const M = detail ? { l: 64, r: 20, t: 40, b: 36 } : { l: 34, r: 8, t: 24, b: 18 };
  let xa = Math.min(...all.map(q => q.o)), xb = Math.max(...all.map(q => q.o));
  let za = Math.min(...all.map(q => q.z)), zb = Math.max(...all.map(q => q.z));
  const padZ = Math.max((zb - za) * 0.08, 0.3);
  za -= padZ; zb += padZ;
  // 細看模式用同比例；總覽自動填滿
  let sx = (W - M.l - M.r) / Math.max(xb - xa, 1), sy = (H - M.t - M.b) / Math.max(zb - za, 0.5);
  if (detail) {
    const s = Math.min(sx, sy);
    const cx = (xa + xb) / 2, cz = (za + zb) / 2;
    xa = cx - (W - M.l - M.r) / 2 / s; xb = cx + (W - M.l - M.r) / 2 / s;
    za = cz - (H - M.t - M.b) / 2 / s; zb = cz + (H - M.t - M.b) / 2 / s;
    sx = sy = s;
  }
  const X = (o: number) => M.l + (o - xa) * sx, Y = (z: number) => H - M.b - (z - za) * sy;
  // 標尺方格
  const nice = (span: number, n: number) => { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 5, 10].map(k => k * p).find(v => v >= raw) ?? p * 10; };
  const ox = nice(xb - xa, detail ? 12 : 4), oz = nice(zb - za, detail ? 8 : 3);
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 1; ctx.font = `${detail ? 11 : 9}px "JetBrains Mono", monospace`; ctx.fillStyle = '#56657e';
  ctx.beginPath();
  for (let o = Math.ceil(xa / ox) * ox; o <= xb; o += ox) { ctx.moveTo(X(o), M.t); ctx.lineTo(X(o), H - M.b); }
  for (let z = Math.ceil(za / oz) * oz; z <= zb; z += oz) { ctx.moveTo(M.l, Y(z)); ctx.lineTo(W - M.r, Y(z)); }
  ctx.stroke();
  ctx.textAlign = 'center';
  for (let o = Math.ceil(xa / ox) * ox; o <= xb; o += ox) ctx.fillText(`${o > 0 ? '+' : ''}${Math.round(o * 10) / 10}m`, X(o), H - M.b + (detail ? 16 : 12));
  ctx.textAlign = 'right';
  for (let z = Math.ceil(za / oz) * oz; z <= zb; z += oz) ctx.fillText(z.toFixed(oz < 1 ? 1 : 0), M.l - 4, Y(z) + 3);
  ctx.textAlign = 'start';
  // 挖填
  const xs = new Set<number>();
  r.design.forEach(q => xs.add(q.o));
  ground.forEach(q => { if (q.o > r.design[0].o && q.o < r.design[r.design.length - 1].o) xs.add(q.o); });
  const sorted = [...xs].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const ga = groundAt(r.ground, a), gb = groundAt(r.ground, b), da = groundAt(r.design, a), db = groundAt(r.design, b);
    if (ga === null || gb === null || da === null || db === null) continue;
    const quad = (o1: number, g1: number, d1: number, o2: number, g2: number, d2: number, col: string) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X(o1), Y(g1)); ctx.lineTo(X(o2), Y(g2)); ctx.lineTo(X(o2), Y(d2)); ctx.lineTo(X(o1), Y(d1)); ctx.closePath(); ctx.fill();
    };
    const fa = ga - da, fb = gb - db;
    if ((fa >= 0) === (fb >= 0)) quad(a, ga, da, b, gb, db, fa + fb >= 0 ? COL.cut : COL.fill);
    else { const t = fa / (fa - fb), om = a + t * (b - a), zm = ga + t * (gb - ga); quad(a, ga, da, om, zm, zm, fa >= 0 ? COL.cut : COL.fill); quad(om, zm, zm, b, gb, db, fb >= 0 ? COL.cut : COL.fill); }
  }
  for (const s of row.solids ?? []) {
    ctx.fillStyle = COL.solid; ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.beginPath(); s.poly.forEach((q, i) => (i ? ctx.lineTo(X(q.o), Y(q.z)) : ctx.moveTo(X(q.o), Y(q.z)))); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.strokeStyle = COL.cl; ctx.setLineDash([6, 3, 2, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X(0), M.t); ctx.lineTo(X(0), H - M.b); ctx.stroke(); ctx.setLineDash([]);
  const line = (pts: OZ[], c: string, w: number) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(X(q.o), Y(q.z)) : ctx.moveTo(X(q.o), Y(q.z)))); ctx.stroke(); };
  line(ground, COL.ground, detail ? 1.8 : 1.3);
  line(r.design, COL.design, detail ? 2.6 : 1.8);
  if (detail) {
    ctx.fillStyle = '#93c5fd'; ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillText(`FH=${r.zc.toFixed(3)}`, X(0) + 6, Y(r.zc) - 8);
    for (const sd of [r.left, r.right]) {
      if (!sd.daylight) continue;
      ctx.fillStyle = sd.caught ? '#ffaa00' : '#ff3b5c';
      ctx.beginPath(); ctx.arc(X(sd.daylight.o), Y(sd.daylight.z), 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText(`${sd.daylight.o.toFixed(2)}, ${sd.daylight.z.toFixed(2)}`, X(sd.daylight.o) + (sd.daylight.o < 0 ? -110 : 8), Y(sd.daylight.z) - 8);
    }
  } else {
    ctx.fillStyle = '#56657e'; ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`DL:${za.toFixed(1)}  FH:${r.zc.toFixed(2)}`, M.l + 2, M.t + 10);
  }
}

function Cell({ row, sel, onClick }: { row: SectionRow; sel: boolean; onClick(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = ref.current!, dpr = window.devicePixelRatio || 1, H = 208;
    c.width = w * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSection(ctx, row, w, H, false);
  });
  return <div ref={box} className={`cross-cell ${sel ? 'sel' : ''}`} onClick={onClick} title="點一下放大檢視"><canvas ref={ref} style={{ width: w, height: 208 }} /></div>;
}

export function CrossFull(props: { sections: SectionRow[]; selectedSta: number | null; onSelect(sta: number): void; mode: 'GRID' | 'SINGLE'; setMode(m: 'GRID' | 'SINGLE'): void }) {
  const { sections, selectedSta } = props;
  const idx = Math.max(0, sections.findIndex(s => selectedSta !== null && Math.abs(s.stake.sta - selectedSta) < 1e-6));
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (props.mode !== 'SINGLE' || !cv.current || !sections[idx]) return;
    const c = cv.current, dpr = window.devicePixelRatio || 1, W = size.w, H = size.h - 54;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSection(ctx, sections[idx], W, H, true);
  });
  const go = (k: number) => { const s = sections[Math.max(0, Math.min(sections.length - 1, k))]; if (s) props.onSelect(s.stake.sta); };
  return (
    <div ref={wrap} className="fullview" style={{ background: '#090c10' }}>
      <div className="float-bar">
        <span className="ttl">📊 橫斷面檢視：</span>
        <button type="button" className={`btn ${props.mode === 'GRID' ? 'active' : ''}`} onClick={() => props.setMode('GRID')}>🗂️ 全線斷面矩陣總覽（一頁多圖）</button>
        <button type="button" className={`btn ${props.mode === 'SINGLE' ? 'active' : ''}`} onClick={() => props.setMode('SINGLE')}>🔍 單一樁號精細放大圖（含標尺）</button>
        <span className="muted">選擇樁號：</span>
        <select aria-label="選擇樁號" value={idx} onChange={e => go(Number(e.target.value))}>
          {sections.map((s, i) => <option key={i} value={i}>{formatStation(s.stake.sta)} {s.stake.label}</option>)}
        </select>
        <button type="button" className="btn" disabled={idx <= 0} onClick={() => go(idx - 1)}>◀ 上一樁</button>
        <button type="button" className="btn" disabled={idx >= sections.length - 1} onClick={() => go(idx + 1)}>下一樁 ▶</button>
      </div>
      {!sections.length && <div className="empty" style={{ paddingTop: 70 }}>尚無橫斷面：請先建立中心線、縱坡與地形。</div>}
      {props.mode === 'GRID' ? (
        <div className="cross-grid">
          {sections.map((s, i) => <Cell key={`${s.stake.sta}-${s.stake.label}-${i}`} row={s} sel={i === idx} onClick={() => { props.onSelect(s.stake.sta); props.setMode('SINGLE'); }} />)}
        </div>
      ) : sections[idx] && <canvas ref={cv} style={{ position: 'absolute', top: 54, left: 0, width: size.w, height: size.h - 54 }} />}
    </div>
  );
}
