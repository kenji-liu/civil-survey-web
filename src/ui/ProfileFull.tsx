// 全螢幕縱斷面設計圖（v3.4）：VIP 拖曳、右鍵刪除、Shift+點擊新增 VIP、Alt+點擊新增落差、點擊選樁、下部資料框
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Derived } from '../store/derived';
import type { ProfileDisplay } from '../core/model';
import { PF_ROWS } from '../core/model';
import { buildProfile, checkProfileSpec, fmtGrade, otherLineZ, parseNotes, parseRanges, type VPI, type Profile } from '../core/profile';
import { formatStation } from '../core/units';

export interface ProfileFullProps {
  d: Derived;
  vpis: VPI[];
  pf: ProfileDisplay;
  selectedSta: number | null;
  onSelect(sta: number): void;
  onVipChange(index: number, sta: number, z: number): void;
  onAddVip(sta: number, z: number): void;
  onRemoveVip(index: number): void;
  onAddDrop(sta: number): void;
  onAlignHeadTail(): void;
  status(msg: string): void;
}

const COL = {
  bg: '#090c10', grid: '#151e2c', gridTxt: '#56657e', ground: '#e2e8f0', design: '#3b82f6', designBad: '#ff3b5c',
  cut: 'rgba(255,59,92,0.22)', fill: 'rgba(0,240,255,0.16)', vpi: '#00f0ff', stake: 'rgba(232,121,249,0.35)', drop: '#ffaa00',
  table: '#0d1118', tableLine: '#2b3b57', label: '#8b9bb4', sel: '#ffffff', note: '#ffe600', field: '#00e676',
};

export function ProfileFull(props: ProfileFullProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [drag, setDrag] = useState<{ i: number; sta: number; z: number } | null>(null);
  const [hoverVip, setHoverVip] = useState(-1);
  const [hoverSta, setHoverSta] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { d, pf } = props;
  const al = d.alignment;
  // 拖曳時用暫時的 VIP 重算設計線（不寫入專案，放開才確定）
  const vpis = useMemo(() => {
    const v = [...props.vpis].sort((a, b) => a.sta - b.sta);
    if (drag && v[drag.i]) v[drag.i] = { ...v[drag.i], sta: drag.sta, z: drag.z };
    return v;
  }, [props.vpis, drag]);
  const prof: Profile = useMemo(() => (drag ? buildProfile(vpis, d.profile.drops) : d.profile), [drag, vpis, d.profile]);
  const spec = useMemo(() => checkProfileSpec(prof, pf.speed), [prof, pf.speed]);

  const rows = PF_ROWS.filter(([k]) => pf.rows.includes(k));
  const rowH = 20;
  const padL = 118, padR = 30, padT = 70;
  const tableH = rows.length * rowH + 4;
  const padB = tableH + 18;
  const W = size.w, H = size.h;
  const gW = Math.max(50, W - padL - padR), gH = Math.max(50, H - padT - padB);

  const fieldZ = (sta: number, side: -1 | 1) => {
    if (!al || !d.tin) return null;
    const q = al.pointAt(sta, side * pf.fieldOff);
    return q ? d.tin.sample(q.x, q.y) : null;
  };
  const notes = useMemo(() => parseNotes(pf.notes), [pf.notes]);
  const ranges = useMemo(() => parseRanges(pf.ranges), [pf.ranges]);

  // 比例
  const range = useMemo(() => {
    if (!al) return null;
    const s0 = al.startStation, s1 = al.endStation;
    const zs: number[] = [];
    d.groundLine.forEach(g => g.z !== null && zs.push(g.z));
    vpis.forEach(v => zs.push(v.z - prof.dropShift(v.sta)));
    for (const dr of prof.drops) { const a = prof.elevBefore(dr.sta), b = prof.elevAt(dr.sta); if (a !== null) zs.push(a); if (b !== null) zs.push(b); }
    if (!zs.length) return null;
    let z0 = Math.min(...zs), z1 = Math.max(...zs);
    const pxX = gW / Math.max(s1 - s0, 1);
    if (pf.vEx > 0) {
      const span = gH / (pxX * pf.vEx);
      const mid = (z0 + z1) / 2;
      z0 = mid - span / 2; z1 = mid + span / 2;
    } else {
      const pad = Math.max((z1 - z0) * 0.1, 0.5);
      z0 -= pad; z1 += pad * 1.8; // 上方留空間給備註
    }
    return { s0, s1, z0, z1, vex: (gH / (z1 - z0)) / pxX };
  }, [al, d.groundLine, vpis, prof, gW, gH, pf.vEx]);

  const X = (s: number) => padL + ((s - (range?.s0 ?? 0)) / ((range ? range.s1 - range.s0 : 1) || 1)) * gW;
  const Y = (z: number) => padT + gH - ((z - (range?.z0 ?? 0)) / ((range ? range.z1 - range.z0 : 1) || 1)) * gH;
  const invS = (x: number) => (range ? range.s0 + ((x - padL) / gW) * (range.s1 - range.s0) : 0);
  const invZ = (y: number) => (range ? range.z0 + ((padT + gH - y) / gH) * (range.z1 - range.z0) : 0);

  useEffect(() => {
    const c = cv.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    if (!al || !range) {
      ctx.fillStyle = COL.label; ctx.font = '14px "Noto Sans TC", sans-serif';
      ctx.fillText('尚無縱斷面：請先在平面圖繪製中心線並載入地形', padL, padT + 40);
      return;
    }
    const mono = (sz: number, w = 400) => `${w} ${sz}px "JetBrains Mono", monospace`;
    // 標題
    ctx.fillStyle = '#fff'; ctx.font = '700 17px "Chakra Petch", "Noto Sans TC", sans-serif';
    ctx.fillText(pf.title, padL, 30);
    ctx.fillStyle = COL.label; ctx.font = mono(11);
    ctx.fillText(`平曲線總長 L=${al.length.toFixed(2)} m｜VIP ${Math.max(0, vpis.length - 2)} 個｜落差 ${prof.drops.length} 處｜垂直誇大 ×${range.vex.toFixed(1)}｜規範 V=${pf.speed} km/h`, padL, 48);
    // 方格
    const zSpan = range.z1 - range.z0;
    const zStep = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find(s => gH / (zSpan / s) > 26) ?? 100;
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1; ctx.font = mono(10); ctx.fillStyle = COL.gridTxt; ctx.textAlign = 'right';
    ctx.beginPath();
    for (let z = Math.ceil(range.z0 / zStep) * zStep; z <= range.z1; z += zStep) { ctx.moveTo(padL, Y(z)); ctx.lineTo(padL + gW, Y(z)); ctx.fillText(`${z.toFixed(zStep < 1 ? 1 : 0)} m`, padL - 6, Y(z) + 3); }
    ctx.stroke(); ctx.textAlign = 'start';
    ctx.strokeStyle = COL.tableLine; ctx.strokeRect(padL, padT, gW, gH);
    // 區間備註
    ctx.font = '600 11px "Noto Sans TC", sans-serif';
    ranges.forEach((r, i) => {
      const y = padT + 14 + (i % 3) * 16, a = X(Math.max(r.s1, range.s0)), b = X(Math.min(r.s2, range.s1));
      ctx.strokeStyle = COL.note; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a, y + 5); ctx.lineTo(a, y); ctx.lineTo(b, y); ctx.lineTo(b, y + 5); ctx.stroke();
      ctx.fillStyle = COL.note; ctx.textAlign = 'center'; ctx.fillText(r.text, (a + b) / 2, y - 3); ctx.textAlign = 'start';
    });
    // 樁號線
    for (const r of d.stakeRows) {
      const x = X(r.stake.sta);
      const sel = props.selectedSta !== null && Math.abs(props.selectedSta - r.stake.sta) < 1e-6;
      ctx.strokeStyle = sel ? COL.sel : r.stake.kind === 'full' ? 'rgba(86,101,126,0.35)' : COL.stake;
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(x, padT + gH); ctx.lineTo(x, r.ground !== null ? Y(r.ground) : padT); ctx.stroke();
    }
    // 挖填著色
    const N = Math.max(100, Math.round(gW));
    for (let i = 0; i < N; i++) {
      const sa = range.s0 + ((range.s1 - range.s0) * i) / N, sb = range.s0 + ((range.s1 - range.s0) * (i + 1)) / N;
      const ga = groundNear(d.groundLine, sa), gb = groundNear(d.groundLine, sb), da = prof.elevAt(sa), db = prof.elevAt(sb);
      if (ga === null || gb === null || da === null || db === null) continue;
      ctx.fillStyle = ga + gb >= da + db ? COL.cut : COL.fill;
      ctx.beginPath(); ctx.moveTo(X(sa), Y(ga)); ctx.lineTo(X(sb), Y(gb)); ctx.lineTo(X(sb), Y(db)); ctx.lineTo(X(sa), Y(da)); ctx.closePath(); ctx.fill();
    }
    // 左右田面線
    if (pf.showField) {
      for (const side of [-1, 1] as const) {
        ctx.strokeStyle = COL.field; ctx.lineWidth = 1; ctx.setLineDash(side < 0 ? [6, 3] : [2, 3]);
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i <= 300; i++) {
          const s = range.s0 + ((range.s1 - range.s0) * i) / 300, z = fieldZ(s, side);
          if (z === null) { pen = false; continue; }
          pen ? ctx.lineTo(X(s), Y(z)) : ctx.moveTo(X(s), Y(z)); pen = true;
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // 原地面
    ctx.strokeStyle = COL.ground; ctx.lineWidth = 1.6; ctx.beginPath();
    let pen = false;
    for (const g of d.groundLine) { if (g.z === null) { pen = false; continue; } pen ? ctx.lineTo(X(g.sta), Y(g.z)) : ctx.moveTo(X(g.sta), Y(g.z)); pen = true; }
    ctx.stroke();
    // 其他設計線
    for (const ln of pf.lines) {
      if (!ln.visible) continue;
      ctx.strokeStyle = ln.color; ctx.lineWidth = 1.4; ctx.setLineDash([7, 4]);
      ctx.beginPath(); let pn = false, last: [number, number] | null = null;
      for (let i = 0; i <= 400; i++) {
        const s = range.s0 + ((range.s1 - range.s0) * i) / 400, z = otherLineZ(ln, s, t => prof.elevAt(t));
        if (z === null) { pn = false; continue; }
        pn ? ctx.lineTo(X(s), Y(z)) : ctx.moveTo(X(s), Y(z)); pn = true; last = [X(s), Y(z)];
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (last) { ctx.fillStyle = ln.color; ctx.font = mono(10, 600); ctx.fillText(`${ln.code} ${ln.name}`, last[0] - 70, last[1] - 6); }
    }
    // 設計線（逐段，超過規範的段落畫紅色）
    const seg = (a: number, b: number, bad: boolean) => {
      ctx.strokeStyle = bad ? COL.designBad : COL.design; ctx.lineWidth = 2.4; ctx.beginPath();
      const n = Math.max(2, Math.round(((b - a) / (range.s1 - range.s0)) * gW / 2));
      for (let i = 0; i <= n; i++) {
        const s = a + ((b - a) * i) / n;
        const z = i === n ? prof.elevBefore(s) : prof.elevAt(s);
        if (z === null) continue;
        i ? ctx.lineTo(X(s), Y(z)) : ctx.moveTo(X(s), Y(z));
      }
      ctx.stroke();
    };
    const cuts = [...vpis.map(v => v.sta), ...prof.drops.map(dr => dr.sta)].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const segIdx = vpis.findIndex((v, k) => k < vpis.length - 1 && cuts[i] >= v.sta - 1e-9 && cuts[i] < vpis[k + 1].sta - 1e-9);
      seg(cuts[i], cuts[i + 1], spec.segBad.has(segIdx));
    }
    // 落差
    for (const dr of prof.drops) {
      const a = prof.elevBefore(dr.sta), b = prof.elevAt(dr.sta);
      if (a === null || b === null) continue;
      ctx.strokeStyle = COL.drop; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X(dr.sta), Y(a)); ctx.lineTo(X(dr.sta), Y(b)); ctx.stroke();
      ctx.fillStyle = COL.drop; ctx.font = '600 11px "Noto Sans TC", sans-serif';
      ctx.fillText(`${dr.name} ΔZ=${dr.dz}`, X(dr.sta) + 5, Math.min(Y(a), Y(b)) - 6);
    }
    // 豎曲線 BVC / EVC
    ctx.strokeStyle = COL.vpi; ctx.lineWidth = 1;
    for (const c of prof.curves) for (const s of [c.bvc, c.evc]) { const z = prof.elevAt(s); if (z !== null) { ctx.beginPath(); ctx.moveTo(X(s), Y(z) - 7); ctx.lineTo(X(s), Y(z) + 7); ctx.stroke(); } }
    // 坡度文字
    ctx.font = mono(10.5, 600); ctx.textAlign = 'center';
    prof.grades.forEach((g, i) => {
      const a = vpis[i], b = vpis[i + 1];
      const m = (a.sta + b.sta) / 2, zm = prof.lineAt(m);
      if (zm === null) return;
      ctx.fillStyle = spec.segBad.has(i) ? COL.designBad : '#93c5fd';
      ctx.fillText(`${fmtGrade(g, pf.slopeFmt)}  L=${(b.sta - a.sta).toFixed(1)}`, X(m), Y(zm - prof.dropShift(m)) + 18);
    });
    ctx.textAlign = 'start';
    // VIP
    vpis.forEach((v, i) => {
      const z = v.z - prof.dropShift(v.sta);
      const x = X(v.sta), y = Y(z);
      const end = i === 0 || i === vpis.length - 1;
      const bad = spec.curveBad.has(i);
      ctx.fillStyle = bad ? COL.designBad : COL.vpi;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = hoverVip === i || drag?.i === i ? 2.5 : 1;
      ctx.beginPath(); ctx.arc(x, y, hoverVip === i || drag?.i === i ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const c = prof.curves.find(k => k.index === i);
      const lab = end ? (i === 0 ? 'BP' : 'EP') : `VIP${i}`;
      ctx.fillStyle = bad ? COL.designBad : COL.vpi; ctx.font = mono(10.5, 600);
      const lines = [`${lab} ${formatStation(v.sta)}`, `Z=${v.z.toFixed(2)}`];
      if (c) lines.push(`L=${c.L.toFixed(1)}${c.L < c.reqL - 1e-6 ? '（縮短）' : ''} e=${c.e.toFixed(3)}`);
      if (!end && pf.showA) lines.push(`A=${((prof.grades[i] - prof.grades[i - 1]) * 100).toFixed(2)}%`);
      lines.forEach((t, k) => ctx.fillText(t, x + 8, y - 30 + k * 12));
    });
    // 備註（引線）
    ctx.font = '600 11px "Noto Sans TC", sans-serif';
    const topY = pf.leaderH > 0 ? null : padT + 64;
    notes.forEach(n => {
      const z = prof.elevAt(n.sta);
      if (z === null || n.sta < range.s0 || n.sta > range.s1) return;
      const x = X(n.sta), y = Y(z);
      const ty = topY ?? y - pf.leaderH;
      ctx.strokeStyle = COL.note; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, ty); ctx.lineTo(x + 8, ty); ctx.stroke();
      ctx.fillStyle = COL.note; ctx.fillText(n.text, x + 10, ty + 4);
    });
    // 下部資料框
    const ty0 = H - padB + 10;
    ctx.fillStyle = COL.table; ctx.fillRect(8, ty0, W - 16, tableH);
    ctx.strokeStyle = COL.tableLine; ctx.lineWidth = 1;
    rows.forEach(([, label], i) => {
      const y = ty0 + i * rowH;
      ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke();
      ctx.fillStyle = '#00f0ff'; ctx.font = '600 11px "Noto Sans TC", sans-serif';
      ctx.fillText(label, 14, y + 14);
    });
    ctx.beginPath(); ctx.moveTo(8, ty0 + tableH); ctx.lineTo(W - 8, ty0 + tableH); ctx.moveTo(padL - 4, ty0); ctx.lineTo(padL - 4, ty0 + tableH); ctx.stroke();
    ctx.font = mono(10); ctx.textAlign = 'center';
    let lastX = -1e9;
    let prevSta: number | null = null;
    d.stakeRows.forEach(r => {
      const x = X(r.stake.sta);
      const special = r.stake.kind !== 'full' || r.side !== undefined;
      const room = x - lastX > 54;
      const dist = prevSta === null ? 0 : r.stake.sta - prevSta;
      prevSta = r.stake.sta;
      if (!room && !special) return;
      if (!room && special && x - lastX < 14) return;
      lastX = x;
      const lt = rows.some(rw => rw[0] === 'lt') ? fieldZ(r.stake.sta, -1) : null, rt = rows.some(rw => rw[0] === 'rt') ? fieldZ(r.stake.sta, 1) : null;
      const note = notes.find(n => Math.abs(n.sta - r.stake.sta) < 0.01)?.text ?? '';
      const val: Record<string, [string, string?]> = {
        name: [r.stake.label || '-', special ? '#e879f9' : undefined],
        sta: [formatStation(r.stake.sta)],
        dist: [dist ? dist.toFixed(2) : ''],
        ground: [r.ground?.toFixed(2) ?? '—'],
        design: [r.design?.toFixed(2) ?? '—', '#93c5fd'],
        cutfill: [r.dh === null ? '—' : `${r.dh >= 0 ? '+' : ''}${r.dh.toFixed(2)}`, r.dh === null ? undefined : r.dh >= 0 ? '#ff6b81' : '#00f0ff'],
        cut: [r.dh !== null && r.dh > 0 ? r.dh.toFixed(2) : '', '#ff6b81'],
        fill: [r.dh !== null && r.dh < 0 ? (-r.dh).toFixed(2) : '', '#00f0ff'],
        lt: [lt?.toFixed(2) ?? ''], rt: [rt?.toFixed(2) ?? ''],
        grade: [''], note: [note, COL.note],
      };
      rows.forEach(([k], i) => {
        if (k === 'grade') return;
        const [t, c] = val[k] ?? [''];
        ctx.fillStyle = c ?? '#e2e8f0';
        ctx.fillText(t, x, ty0 + i * rowH + 14);
      });
    });
    // 坡度列：以 VIP 區間置中
    const gi = rows.findIndex(rw => rw[0] === 'grade');
    if (gi >= 0) prof.grades.forEach((g, i) => {
      const a = X(vpis[i].sta), b = X(vpis[i + 1].sta);
      ctx.fillStyle = spec.segBad.has(i) ? COL.designBad : '#ffaa00';
      ctx.fillText(fmtGrade(g, pf.slopeFmt), (a + b) / 2, ty0 + gi * rowH + 14);
      ctx.strokeStyle = COL.tableLine; ctx.beginPath(); ctx.moveTo(b, ty0 + gi * rowH); ctx.lineTo(b, ty0 + (gi + 1) * rowH); ctx.stroke();
    });
    ctx.textAlign = 'start';
    // 滑鼠位置讀數
    if (hoverSta !== null && hoverSta >= range.s0 && hoverSta <= range.s1) {
      const g = groundNear(d.groundLine, hoverSta), z = prof.elevAt(hoverSta);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.moveTo(X(hoverSta), padT); ctx.lineTo(X(hoverSta), padT + gH); ctx.stroke();
      const txt = [`${formatStation(hoverSta)}`, `地面 ${g?.toFixed(3) ?? '—'}`, `設計 ${z?.toFixed(3) ?? '—'}`, g !== null && z !== null ? `${g - z >= 0 ? '挖' : '填'} ${Math.abs(g - z).toFixed(3)}` : ''];
      const bx = Math.min(X(hoverSta) + 10, W - 150);
      ctx.fillStyle = 'rgba(13,17,24,0.92)'; ctx.fillRect(bx, padT + 6, 136, 62);
      ctx.fillStyle = '#e2e8f0'; ctx.font = mono(10.5);
      txt.forEach((t, i) => ctx.fillText(t, bx + 8, padT + 20 + i * 14));
    }
  });

  const pos = (e: React.PointerEvent | React.MouseEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const vipAt = (x: number, y: number) => {
    let best = -1, bd = 12;
    vpis.forEach((v, i) => { const dd = Math.hypot(X(v.sta) - x, Y(v.z - prof.dropShift(v.sta)) - y); if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  const inGraph = (x: number, y: number) => x >= padL && x <= padL + gW && y >= padT && y <= padT + gH;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !range) return;
    const { x, y } = pos(e);
    const i = vipAt(x, y);
    if (i >= 0 && !e.shiftKey && !e.altKey) {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ i, sta: vpis[i].sta, z: vpis[i].z });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!range) return;
    const { x, y } = pos(e);
    if (drag) {
      const end = drag.i === 0 || drag.i === vpis.length - 1;
      const lo = drag.i > 0 ? vpis[drag.i - 1].sta + 1 : range.s0, hi = drag.i < vpis.length - 1 ? vpis[drag.i + 1].sta - 1 : range.s1;
      const sta = end ? vpis[drag.i].sta : Math.max(lo, Math.min(hi, Math.round(invS(x) * 100) / 100));
      setDrag({ ...drag, sta, z: Math.round((invZ(y) + prof.dropShift(sta)) * 1000) / 1000 });
      return;
    }
    setHoverVip(vipAt(x, y));
    setHoverSta(inGraph(x, y) ? invS(x) : null);
  };
  const onUp = () => {
    if (!drag) return;
    const sorted = [...props.vpis].sort((a, b) => a.sta - b.sta);
    const changed = !sorted[drag.i] || sorted[drag.i].sta !== drag.sta || sorted[drag.i].z !== drag.z;
    if (changed) props.onVipChange(drag.i, drag.sta, drag.z);
    setDrag(null);
  };
  const onClick = (e: React.MouseEvent) => {
    if (!range || drag) return;
    const { x, y } = pos(e);
    if (!inGraph(x, y) && y < H - padB + 10) return;
    const s = invS(x);
    if (e.shiftKey && inGraph(x, y)) { props.onAddVip(Math.round(s * 100) / 100, Math.round((invZ(y) + prof.dropShift(s)) * 1000) / 1000); return; }
    if (e.altKey && inGraph(x, y)) { props.onAddDrop(Math.round(s * 100) / 100); return; }
    if (!d.stakeRows.length) return;
    const best = d.stakeRows.reduce((a, b) => (Math.abs(b.stake.sta - s) < Math.abs(a.stake.sta - s) ? b : a));
    props.onSelect(best.stake.sta);
  };
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = pos(e);
    const i = vipAt(x, y);
    if (i > 0 && i < vpis.length - 1) props.onRemoveVip(i);
    else if (i >= 0) props.status('首尾交點不能刪除');
  };

  const exportPng = () => {
    cv.current!.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `${pf.title || '縱斷面圖'}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    props.status('🖼 已輸出縱斷面圖 PNG');
  };

  return (
    <div ref={wrap} className="fullview">
      <canvas ref={cv} style={{ width: W, height: H, cursor: drag ? 'grabbing' : hoverVip >= 0 ? 'grab' : 'crosshair' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onClick={onClick} onContextMenu={onContext}
        onPointerLeave={() => { setHoverSta(null); setHoverVip(-1); }} />
      <div className="float-bar" style={{ left: 'auto', right: 10, transform: 'none' }}>
        <span className="ttl">📈 全螢幕縱斷面設計圖</span>
        <button type="button" className="btn amber" onClick={props.onAlignHeadTail}>🔗 頭尾對齊原地面高</button>
        <button type="button" className="btn" onClick={exportPng}>🖼 PNG</button>
        <span className="hint2">拖曳 VIP 改位置・右鍵 VIP 刪除｜點擊選樁｜<b>Shift+點擊</b> 新增 VIP｜<b>Alt+點擊</b> 新增防砂壩落差</span>
      </div>
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
