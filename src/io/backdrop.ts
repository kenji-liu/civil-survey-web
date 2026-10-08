// DXF 彩色線條底圖：保留原圖的等高線、水路、圖框等線條（依 AutoCAD 色號上色），只做顯示用
import type { DxfData } from './dxf-read';
import type { BackdropItem } from '../core/model';

/** AutoCAD 色號 → 深色背景下的顯示色（依 v3.4） */
export function aciToColor(aci: number | undefined, layer = ''): string {
  const map: Record<number, string> = {
    1: '#ff3b5c', 2: '#ffe600', 3: '#00e676', 4: '#00f0ff', 5: '#3b82f6', 6: '#e879f9', 7: '#cbd5e1', 8: '#64748b', 9: '#94a3b8',
    30: '#ff9f1c', 40: '#ffbf69', 50: '#ffe66d',
  };
  const c = Math.abs(Math.round(aci ?? 0));
  if (map[c]) return map[c];
  const u = layer.toUpperCase();
  if (u === 'AC' || u.includes('CONT')) return '#00e676';
  if (u === 'IDX' || u.includes('SEC')) return '#e879f9';
  if (u.includes('380') || u.includes('WATER')) return '#00f0ff';
  return '#00e676';
}

/** 取出選定圖層的線條（256 = 隨圖層色）；總頂點數超過上限時截斷 */
export function dxfBackdrop(data: DxfData, layers: Set<string>, maxVerts = 400000): { items: BackdropItem[]; truncated: boolean } {
  const items: BackdropItem[] = [];
  let n = 0;
  for (const e of data.entities) {
    if (e.type !== 'POLY' || !layers.has(e.layer)) continue;
    const pts = e.pts.filter(q => isFinite(q.x) && isFinite(q.y));
    if (pts.length < 2) continue;
    if (n + pts.length > maxVerts) return { items, truncated: true };
    const aci = e.color === undefined || !isFinite(e.color) || e.color === 256 ? data.layerColors.get(e.layer) : e.color;
    items.push({ c: aciToColor(aci, e.layer), pts: pts.flatMap(q => [q.x, q.y]), closed: e.closed });
    n += pts.length;
  }
  return { items, truncated: false };
}
