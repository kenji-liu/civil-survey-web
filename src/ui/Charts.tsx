// 縱斷面圖與橫斷面圖
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../core/profile';
import type { StakeRow, SectionRow } from '../store/derived';
import { groundAt, type OZ } from '../core/section';
import { formatStation } from '../core/units';

const C = {
  bg: '#080b10', grid: '#18212d', axis: '#56657e', text: '#9fb0c6',
  ground: '#3ddc84', design: '#ffb347', tangent: 'rgba(255,92,122,0.7)', vpi: '#ff5c7a',
  sel: '#ffffff', cut: 'rgba(255,92,92,0.35)', fill: 'rgba(79,163,255,0.35)', cl: '#ff5c7a',
};

function useCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 400, h: 200 });
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ctx2d = () => {
    const c = cv.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, size.w * dpr); c.height = Math.max(1, size.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };
  return { wrap, cv, size, ctx2d };
}

function niceTicks(min: number, max: number, approx: number) {
  const raw = (max - min) / Math.max(approx, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 5, 10].map(k => k * pow).find(v => v >= raw) ?? pow * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return { ticks: out, step };
}

export function ProfileChart(props: {
  groundLine: Array<{ sta: number; z: number | null }>;
  profile: Profile;
  stakeRows: StakeRow[];
  selectedSta: number | null;
  onSelect(sta: number): void;
}) {
  const { wrap, cv, size, ctx2d } = useCanvas();
  const [hoverSta, setHoverSta] = useState<number | null>(null);
  const M = { l: 58, r: 14, t: 14, b: 40 };
  const range = (() => {
    const stas = props.groundLine.map(g => g.sta).concat(props.profile.vpis.map(v => v.sta));
    const zs: number[] = [];
    props.groundLine.forEach(g => g.z !== null && zs.push(g.z));
    props.profile.vpis.forEach(v => zs.push(v.z));
    if (!stas.length || !zs.length) return null;
    const s0 = Math.min(...stas), s1 = Math.max(...stas);
    let z0 = Math.min(...zs), z1 = Math.max(...zs);
    const pad = Math.max((z1 - z0) * 0.12, 1);
    z0 -= pad; z1 += pad;
    return { s0, s1: s1 > s0 ? s1 : s0 + 1, z0, z1 };
  })();

  useEffect(() => {
    const ctx = ctx2d();
    const { w: W, h: H } = size;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.font = '10px "JetBrains Mono", monospace';
    if (!range) {
      ctx.fillStyle = C.text; ctx.fillText('尚無縱斷面資料：請先建立中心線並載入地形', 16, 24);
      return;
    }
    const X = (s: number) => M.l + ((s - range.s0) / (range.s1 - range.s0)) * (W - M.l - M.r);
    const Y = (z: number) => H - M.b - ((z - range.z0) / (range.z1 - range.z0)) * (H - M.t - M.b);
    // 格線
    const zt = niceTicks(range.z0, range.z1, Math.max(3, (H - M.t - M.b) / 34));
    const st = niceTicks(range.s0, range.s1, Math.max(3, (W - M.l - M.r) / 90));
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    zt.ticks.forEach(z => { ctx.moveTo(M.l, Y(z)); ctx.lineTo(W - M.r, Y(z)); });
    st.ticks.forEach(s => { ctx.moveTo(X(s), M.t); ctx.lineTo(X(s), H - M.b); });
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    zt.ticks.forEach(z => ctx.fillText(z.toFixed(zt.step < 1 ? 1 : 0), M.l - 6, Y(z) + 3));
    ctx.textAlign = 'center';
    st.ticks.forEach(s => ctx.fillText(formatStation(s, 0), X(s), H - M.b + 14));
    ctx.textAlign = 'start';
    // 樁號刻度
    ctx.strokeStyle = C.axis; ctx.beginPath();
    props.stakeRows.forEach(r => { ctx.moveTo(X(r.stake.sta), H - M.b); ctx.lineTo(X(r.stake.sta), H - M.b + 4); });
    ctx.stroke();
    // 地面線
    ctx.strokeStyle = C.ground; ctx.lineWidth = 1.4; ctx.beginPath();
    let pen = false;
    props.groundLine.forEach(g => {
      if (g.z === null) { pen = false; return; }
      pen ? ctx.lineTo(X(g.sta), Y(g.z)) : ctx.moveTo(X(g.sta), Y(g.z));
      pen = true;
    });
    ctx.stroke();
    // 切線與 VPI
    const v = props.profile.vpis;
    if (v.length >= 2) {
      ctx.strokeStyle = C.tangent; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); v.forEach((q, i) => (i ? ctx.lineTo(X(q.sta), Y(q.z)) : ctx.moveTo(X(q.sta), Y(q.z)))); ctx.stroke();
      ctx.setLineDash([]);
      // 設計線
      ctx.strokeStyle = C.design; ctx.lineWidth = 2.2; ctx.beginPath();
      const n = Math.max(2, Math.round(W - M.l - M.r));
      for (let i = 0; i <= n; i++) {
        const s = v[0].sta + (i / n) * (v[v.length - 1].sta - v[0].sta);
        const z = props.profile.elevAt(s);
        if (z === null) continue;
        i ? ctx.lineTo(X(s), Y(z)) : ctx.moveTo(X(s), Y(z));
      }
      ctx.stroke();
      v.forEach((q, i) => {
        ctx.fillStyle = C.vpi;
        ctx.beginPath(); ctx.arc(X(q.sta), Y(q.z), 3.5, 0, Math.PI * 2); ctx.fill();
        if (i > 0 && i < v.length - 1) ctx.fillText(`VPI${i}${q.L > 0 ? ` L=${q.L}` : ''}`, X(q.sta) + 6, Y(q.z) - 8);
      });
      ctx.fillStyle = C.text;
      props.profile.grades.forEach((g, i) => {
        const sm = (v[i].sta + v[i + 1].sta) / 2, zm = (v[i].z + v[i + 1].z) / 2;
        ctx.fillText(`${(g * 100).toFixed(2)}%`, X(sm) - 18, Y(zm) - 10);
      });
      for (const c of props.profile.curves) {
        ctx.strokeStyle = C.design; ctx.beginPath();
        for (const s of [c.bvc, c.evc]) { const z = props.profile.elevAt(s); if (z !== null) { ctx.moveTo(X(s), Y(z) - 6); ctx.lineTo(X(s), Y(z) + 6); } }
        ctx.stroke();
      }
    }
    // 選取與滑鼠位置
    for (const [s, col] of [[props.selectedSta, C.sel], [hoverSta, 'rgba(255,255,255,0.35)']] as const) {
      if (s === null) continue;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(s), M.t); ctx.lineTo(X(s), H - M.b); ctx.stroke();
    }
    if (hoverSta !== null) {
      const g = groundNear(props.groundLine, hoverSta), d = props.profile.elevAt(hoverSta);
      const lines = [formatStation(hoverSta), `地面 ${g !== null ? g.toFixed(3) : '—'}`, `設計 ${d !== null ? d.toFixed(3) : '—'}`, `挖填 ${g !== null && d !== null ? (g - d >= 0 ? '挖 ' : '填 ') + Math.abs(g - d).toFixed(3) : '—'}`];
      const bx = Math.min(X(hoverSta) + 10, W - 150), by = M.t + 6;
      ctx.fillStyle = 'rgba(13,17,24,0.9)'; ctx.fillRect(bx, by, 140, 62);
      ctx.fillStyle = C.text; lines.forEach((t, i) => ctx.fillText(t, bx + 8, by + 14 + i * 14));
    }
    ctx.fillStyle = C.ground; ctx.fillText('— 原地面', W - M.r - 150, H - 8);
    ctx.fillStyle = C.design; ctx.fillText('— 設計線', W - M.r - 80, H - 8);
  });

  const staFromEvent = (e: React.PointerEvent) => {
    if (!range) return null;
    const r = cv.current!.getBoundingClientRect();
    const s = range.s0 + ((e.clientX - r.left - M.l) / (size.w - M.l - M.r)) * (range.s1 - range.s0);
    return s >= range.s0 && s <= range.s1 ? s : null;
  };

  return (
    <div ref={wrap} className="chart">
      <canvas
        ref={cv}
        style={{ width: size.w, height: size.h }}
        onPointerMove={e => setHoverSta(staFromEvent(e))}
        onPointerLeave={() => setHoverSta(null)}
        onClick={e => {
          const s = staFromEvent(e as unknown as React.PointerEvent);
          if (s === null || !props.stakeRows.length) return;
          const best = props.stakeRows.reduce((a, b) => (Math.abs(b.stake.sta - s) < Math.abs(a.stake.sta - s) ? b : a));
          props.onSelect(best.stake.sta);
        }}
      />
    </div>
  );
}

function groundNear(line: Array<{ sta: number; z: number | null }>, s: number) {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    if (s >= a.sta && s <= b.sta) {
      if (a.z === null || b.z === null) return null;
      return a.z + ((s - a.sta) / (b.sta - a.sta || 1)) * (b.z - a.z);
    }
  }
  return null;
}

export function SectionChart(props: { row: SectionRow | null }) {
  const { wrap, cv, size, ctx2d } = useCanvas();
  useEffect(() => {
    const ctx = ctx2d();
    const { w: W, h: H } = size;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.font = '10px "JetBrains Mono", monospace';
    const row = props.row;
    if (!row || !row.result) {
      ctx.fillStyle = C.text;
      ctx.fillText(row ? `${formatStation(row.stake.sta)}：${row.reason ?? '無法計算'}` : '請在縱斷面圖或樁號表選一個樁號', 16, 24);
      return;
    }
    const r = row.result;
    const all: OZ[] = [...r.ground, ...r.design];
    let o0 = Math.min(...all.map(p => p.o)), o1 = Math.max(...all.map(p => p.o));
    let z0 = Math.min(...all.map(p => p.z)), z1 = Math.max(...all.map(p => p.z));
    const M = { l: 48, r: 12, t: 30, b: 26 };
    // 等比例：縱橫比例相同
    const sx = (W - M.l - M.r) / Math.max(o1 - o0, 1), sy = (H - M.t - M.b) / Math.max(z1 - z0, 1);
    const s = Math.min(sx, sy);
    const oc = (o0 + o1) / 2, zc = (z0 + z1) / 2;
    o0 = oc - (W - M.l - M.r) / 2 / s; o1 = oc + (W - M.l - M.r) / 2 / s;
    z0 = zc - (H - M.t - M.b) / 2 / s; z1 = zc + (H - M.t - M.b) / 2 / s;
    const X = (o: number) => M.l + (o - o0) * s;
    const Y = (z: number) => H - M.b - (z - z0) * s;
    const zt = niceTicks(z0, z1, 5), ot = niceTicks(o0, o1, 8);
    ctx.strokeStyle = C.grid; ctx.beginPath();
    zt.ticks.forEach(z => { ctx.moveTo(M.l, Y(z)); ctx.lineTo(W - M.r, Y(z)); });
    ot.ticks.forEach(o => { ctx.moveTo(X(o), M.t); ctx.lineTo(X(o), H - M.b); });
    ctx.stroke();
    ctx.fillStyle = C.text; ctx.textAlign = 'right';
    zt.ticks.forEach(z => ctx.fillText(z.toFixed(zt.step < 1 ? 1 : 0), M.l - 5, Y(z) + 3));
    ctx.textAlign = 'center';
    ot.ticks.forEach(o => ctx.fillText(String(Math.round(o * 10) / 10), X(o), H - M.b + 13));
    ctx.textAlign = 'start';
    // 挖填著色
    const xs = new Set<number>();
    r.design.forEach(p => xs.add(p.o));
    r.ground.forEach(p => { if (p.o > r.design[0].o && p.o < r.design[r.design.length - 1].o) xs.add(p.o); });
    const sorted = [...xs].sort((a, b) => a - b);
    const dAt = (o: number) => groundAt(r.design, o);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      const ga = groundAt(r.ground, a), gb = groundAt(r.ground, b), da = dAt(a), db = dAt(b);
      if (ga === null || gb === null || da === null || db === null) continue;
      const fa = ga - da, fb = gb - db;
      const quad = (o1: number, g1: number, d1: number, o2: number, g2: number, d2: number, col: string) => {
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(X(o1), Y(g1)); ctx.lineTo(X(o2), Y(g2)); ctx.lineTo(X(o2), Y(d2)); ctx.lineTo(X(o1), Y(d1)); ctx.closePath(); ctx.fill();
      };
      if ((fa >= 0) === (fb >= 0)) quad(a, ga, da, b, gb, db, fa + fb >= 0 ? C.cut : C.fill);
      else {
        const t = fa / (fa - fb), om = a + t * (b - a), zm = ga + t * (gb - ga);
        quad(a, ga, da, om, zm, zm, fa >= 0 ? C.cut : C.fill);
        quad(om, zm, zm, b, gb, db, fb >= 0 ? C.cut : C.fill);
      }
    }
    // 構造物實體
    const solids = row.solids ?? [];
    for (const sol of solids) {
      ctx.fillStyle = 'rgba(203,213,224,0.55)'; ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      ctx.beginPath(); sol.poly.forEach((q, i) => (i ? ctx.lineTo(X(q.o), Y(q.z)) : ctx.moveTo(X(q.o), Y(q.z)))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 中心線
    ctx.strokeStyle = C.cl; ctx.setLineDash([8, 3, 2, 3]); ctx.beginPath(); ctx.moveTo(X(0), M.t - 6); ctx.lineTo(X(0), H - M.b); ctx.stroke(); ctx.setLineDash([]);
    // 地面與設計
    const line = (pts: OZ[], col: string, w: number) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.o), Y(p.z)) : ctx.moveTo(X(p.o), Y(p.z)))); ctx.stroke();
    };
    line(r.ground, C.ground, 1.4);
    line(r.design, C.design, 2.2);
    for (const side of [r.left, r.right]) {
      if (!side.daylight) continue;
      ctx.fillStyle = side.caught ? C.design : C.vpi;
      ctx.beginPath(); ctx.arc(X(side.daylight.o), Y(side.daylight.z), 3, 0, Math.PI * 2); ctx.fill();
    }
    // 標題與面積
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`${row.stake.label ? row.stake.label + '  ' : ''}${formatStation(row.stake.sta)}   設計高 ${r.zc.toFixed(3)}`, M.l, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff7b7b'; ctx.fillText(`挖 At = ${r.cutArea.toFixed(2)} m²`, W - M.r - 130, 18);
    ctx.fillStyle = '#6fb6ff'; ctx.fillText(`填 Af = ${r.fillArea.toFixed(2)} m²`, W - M.r, 18);
    ctx.textAlign = 'start';
    if (!r.left.caught || !r.right.caught) {
      ctx.font = '10px "Noto Sans TC", sans-serif';
      ctx.fillStyle = C.vpi;
      ctx.fillText('邊坡在取樣寬度內接不到地面，請加大橫斷取樣寬度', M.l, H - 6);
    }
  });
  return <div ref={wrap} className="chart"><canvas ref={cv} style={{ width: size.w, height: size.h }} /></div>;
}
