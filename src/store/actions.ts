// 編輯動作（側欄與全螢幕圖面共用）：VIP、落差、規範豎曲線長、頭尾對齊、曲線起訖交換、自訂加樁
import type { Project } from '../core/model';
import type { Derived } from './derived';
import { specVcLengths, type VPI, type Drop } from '../core/profile';
import { reverseIPs, setAllRadius, extraOf, type ExtraStation } from '../core/alignment';
import { update } from './store';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const sortV = (v: VPI[]) => [...v].sort((a, b) => a.sta - b.sta);

/** 目前實際使用的 VIP（單一坡度模式時是起終兩點） */
export function currentVpis(p: Project, d: Derived): VPI[] {
  return p.vpis.length >= 2 ? sortV(p.vpis) : d.profile.vpis.map(v => ({ ...v }));
}

export function setVpis(vpis: VPI[]) {
  update(q => ({ ...q, vpis: sortV(vpis).map(v => ({ sta: r3(v.sta), z: r3(v.z), L: Math.max(0, v.L || 0) })) }));
}

/** 新增 VIP；未指定時加在最長的坡段中點 */
export function addVip(p: Project, d: Derived, sta?: number, z?: number): string {
  const v = currentVpis(p, d);
  if (v.length < 2) return '請先繪製中心線';
  if (sta === undefined) {
    let bi = 0, bd = -1;
    for (let i = 0; i < v.length - 1; i++) { const len = v[i + 1].sta - v[i].sta; if (len > bd) { bd = len; bi = i; } }
    sta = (v[bi].sta + v[bi + 1].sta) / 2;
  }
  if (sta <= v[0].sta + 0.5 || sta >= v[v.length - 1].sta - 0.5) return 'VIP 必須在起點與終點之間';
  if (v.some(q => Math.abs(q.sta - sta!) < 0.5)) return '這個樁號已經有 VIP';
  const zz = z ?? d.profile.lineAt(sta) ?? v[0].z;
  setVpis([...v, { sta, z: zz, L: 20 }]);
  return `已新增 VIP @ ${sta.toFixed(2)} m，Z=${zz.toFixed(2)}、豎曲線 L=20 m`;
}

export function removeVip(p: Project, d: Derived, i: number): string {
  const v = currentVpis(p, d);
  if (i <= 0 || i >= v.length - 1) return '首尾交點不能刪除；要回到單一坡度請按「清除回單坡」';
  setVpis(v.filter((_, k) => k !== i));
  return `已刪除 VIP${i}`;
}

export function updateVip(p: Project, d: Derived, i: number, field: 'sta' | 'z' | 'L', val: number) {
  const v = currentVpis(p, d);
  if (!v[i] || !isFinite(val)) return;
  if (field === 'sta') { if (i === 0 || i === v.length - 1) return; const lo = v[i - 1].sta + 0.5, hi = v[i + 1].sta - 0.5; val = Math.max(lo, Math.min(hi, val)); }
  if (field === 'L') val = Math.max(0, val);
  v[i] = { ...v[i], [field]: val };
  setVpis(v);
}

/** 修改後坡：保持坡長，重算下一個 VIP 高程 */
export function updateVipGrade(p: Project, d: Derived, i: number, gPct: number) {
  const v = currentVpis(p, d);
  if (!v[i] || !v[i + 1] || !isFinite(gPct)) return;
  v[i + 1] = { ...v[i + 1], z: v[i].z + (gPct / 100) * (v[i + 1].sta - v[i].sta) };
  setVpis(v);
}

/** 由前一交點以坡度＋坡長接續新增 VIP */
export function addVipByGrade(p: Project, d: Derived, gPct: number, len: number): string {
  const v = currentVpis(p, d);
  if (v.length < 2) return '請先繪製中心線';
  if (!isFinite(gPct) || !(len > 0)) return '請輸入坡度(%)與坡長(m)';
  const ref = v[v.length - 2], sta = ref.sta + len;
  if (sta >= v[v.length - 1].sta - 0.5) return '超出 EP 樁號，請縮短坡長';
  setVpis([...v, { sta, z: ref.z + (gPct / 100) * len, L: 20 }]);
  return `已由前一交點以 ${gPct}% / ${len} m 接續新增 VIP`;
}

export function initVipsFromSimple(p: Project, d: Derived) { setVpis(currentVpis(p, d)); }
export function clearVips() { update(q => ({ ...q, vpis: [] })); }

export function autoSpecL(p: Project, d: Derived): string {
  const v = currentVpis(p, d);
  if (v.length < 3) return '請先新增至少 1 個中間 VIP';
  setVpis(specVcLengths(v, p.pf.speed));
  return `已依 V=${p.pf.speed} km/h 參考值設定豎曲線長（進位到 5 m，空間不足者自動縮短）`;
}

/** 頭尾設計高對齊原地面 */
export function alignHeadTail(p: Project, d: Derived): string {
  const al = d.alignment;
  if (!al || !d.tin) return '需要中心線與地形';
  const z0 = d.tin.sample(al.input.ips[0].x, al.input.ips[0].y);
  const e = al.pointAt(al.endStation)!;
  const z1 = d.tin.sample(e.x, e.y);
  if (z0 === null || z1 === null) return '中心線起點或終點不在地形範圍內';
  if (p.vpis.length >= 2) {
    const v = currentVpis(p, d);
    v[0] = { ...v[0], z: z0 }; v[v.length - 1] = { ...v[v.length - 1], z: z1 };
    setVpis(v);
  } else update(q => ({ ...q, pfSimple: { z0: r3(z0), slope: Math.round(((z1 - z0) / al.length) * 100 * 1000) / 1000 } }));
  return `🔗 頭尾已對齊原地面高：BP ${z0.toFixed(2)}、EP ${z1.toFixed(2)}`;
}

// ---------------- 落差 ----------------
export function addDrop(sta: number, dz: number, name: string): string {
  if (!isFinite(sta) || !isFinite(dz)) return '請輸入落差樁號與 ΔZ';
  update(q => ({ ...q, drops: [...q.drops, { sta: r3(sta), dz, name: name || '防砂壩' }].sort((a, b) => a.sta - b.sta) }));
  return `已新增「${name || '防砂壩'}」落差 ΔZ=${dz} m @ ${sta.toFixed(2)}`;
}
export function updateDrop(i: number, v: Partial<Drop>) { update(q => ({ ...q, drops: q.drops.map((x, k) => (k === i ? { ...x, ...v } : x)).sort((a, b) => a.sta - b.sta) })); }
export function removeDrop(i: number) { update(q => ({ ...q, drops: q.drops.filter((_, k) => k !== i) })); }

// ---------------- 平曲線 ----------------
/** 曲線起訖交換：IP 反轉，縱坡、落差、加樁、水準地面高依里程鏡射 */
export function reverseAlignment(p: Project, d: Derived): string {
  const al = d.alignment;
  if (!al || !p.alignment) return '尚未建立中心線';
  const s0 = al.startStation, s1 = al.endStation;
  const m = (s: number) => r3(s0 + s1 - s);
  update(q => ({
    ...q,
    alignment: { ...q.alignment!, ips: reverseIPs(q.alignment!.ips), extraStations: q.alignment!.extraStations.map(extraOf).map(e => ({ ...e, sta: m(e.sta) })) },
    vpis: q.vpis.map(v => ({ ...v, sta: m(v.sta) })),
    pfSimple: { z0: q.pfSimple.z0 + (q.pfSimple.slope / 100) * (s1 - s0), slope: -q.pfSimple.slope },
    drops: q.drops.map(x => ({ ...x, sta: m(x.sta), dz: -x.dz })),
    profileGround: { ...q.profileGround, pts: q.profileGround.pts.map(x => ({ ...x, sta: m(x.sta) })) },
  }));
  return '⇄ 已交換中心線起訖點（縱坡、落差、加樁一併鏡射）';
}

export function setAllIpRadius(R: number): string {
  update(q => (q.alignment ? { ...q, alignment: { ...q.alignment, ips: setAllRadius(q.alignment.ips, R) } } : q));
  return R > 0 ? `所有轉折點已套用半徑 R=${R} m` : '所有轉折點已設為折點（R=0）';
}

export function addCustomStation(sta: number, name: string): string {
  if (!isFinite(sta)) return '請輸入里程';
  update(q => (q.alignment ? { ...q, alignment: { ...q.alignment, extraStations: [...q.alignment.extraStations.map(extraOf), { sta: r3(sta), name: name || '加樁' } as ExtraStation].sort((a, b) => a.sta - b.sta) } } : q));
  return `📍 已加樁 ${name || '加樁'} @ ${sta.toFixed(2)} m`;
}
export function removeCustomStation(i: number) { update(q => (q.alignment ? { ...q, alignment: { ...q.alignment, extraStations: q.alignment.extraStations.map(extraOf).filter((_, k) => k !== i) } } : q)); }
export function clearCustomStations() { update(q => (q.alignment ? { ...q, alignment: { ...q.alignment, extraStations: [] } } : q)); }
