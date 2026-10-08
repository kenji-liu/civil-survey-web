// DXF 讀取：解析 ENTITIES 區段中與地形有關的圖元，並轉成測點
import type { SurveyPoint, ZRule } from '../core/model';
import { isValidZ } from '../core/model';

export interface P3 { x: number; y: number; z: number }

export type DxfEntity =
  | { type: 'POINT'; layer: string; x: number; y: number; z: number }
  | { type: 'INSERT'; layer: string; x: number; y: number; z: number; block: string; attribs: Array<{ tag: string; text: string }> }
  | { type: 'TEXT'; layer: string; x: number; y: number; z: number; text: string }
  | { type: 'POLY'; layer: string; pts: P3[]; closed: boolean; src: string; color?: number }
  | { type: '3DFACE'; layer: string; pts: P3[] };

export interface DxfData {
  version: string;
  encoding: string;
  entities: DxfEntity[];
  /** 圖層 → 圖元數 */
  layers: Map<string, number>;
  /** 圖層顏色（AutoCAD 色號 ACI） */
  layerColors: Map<string, number>;
  /** 不處理的圖元種類 → 數量 */
  ignored: Map<string, number>;
}

/** 依 $ACADVER 與 $DWGCODEPAGE 決定文字編碼 */
export function decodeDxf(buf: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  const ver = head.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(\S+)/)?.[1] ?? '';
  const cp = (head.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/)?.[1] ?? '').toUpperCase();
  let enc = 'utf-8';
  if (ver && ver < 'AC1021') {
    if (cp === 'ANSI_950') enc = 'big5';
    else if (cp === 'ANSI_936') enc = 'gbk';
    else if (cp === 'ANSI_932') enc = 'shift_jis';
    else if (cp.startsWith('ANSI_')) enc = 'windows-' + cp.slice(5);
  }
  if (enc === 'utf-8') {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; }
    catch { enc = 'big5'; }
  }
  try { return { text: new TextDecoder(enc).decode(bytes), encoding: enc }; }
  catch { return { text: new TextDecoder('latin1').decode(bytes), encoding: 'latin1' }; }
}

export function parseDxf(text: string, encoding = 'utf-8'): DxfData {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) { i -= 1; continue; } // 容錯：跳過空行造成的錯位
    pairs.push([code, lines[i + 1]]);
  }
  let version = '';
  for (let i = 0; i < Math.min(pairs.length, 2000); i++) {
    if (pairs[i][0] === 9 && pairs[i][1].trim() === '$ACADVER') { version = pairs[i + 1]?.[1].trim() ?? ''; break; }
  }
  // 找 ENTITIES 區段
  let start = -1;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === 'SECTION' && pairs[i + 1][0] === 2 && pairs[i + 1][1].trim() === 'ENTITIES') { start = i + 2; break; }
  }
  const data: DxfData = { version, encoding, entities: [], layers: new Map(), layerColors: new Map(), ignored: new Map() };
  // 圖層表的顏色
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === 'LAYER') {
      let name = '', color = NaN;
      for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j++) {
        if (pairs[j][0] === 2) name = pairs[j][1].trim();
        else if (pairs[j][0] === 62) color = parseInt(pairs[j][1], 10);
      }
      if (name && isFinite(color)) data.layerColors.set(name, Math.abs(color));
    }
    if (pairs[i][0] === 2 && pairs[i][1].trim() === 'ENTITIES') break;
  }
  if (start < 0) return data;
  // 切成一個個圖元（code 0 開頭）
  const ents: Array<{ type: string; g: Array<[number, string]> }> = [];
  for (let i = start; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) {
      const t = v.trim();
      if (t === 'ENDSEC') break;
      ents.push({ type: t, g: [] });
    } else if (ents.length) ents[ents.length - 1].g.push([c, v]);
  }
  const num = (g: Array<[number, string]>, code: number, def = NaN) => {
    const f = g.find(p => p[0] === code);
    return f ? parseFloat(f[1]) : def;
  };
  const str = (g: Array<[number, string]>, code: number) => g.find(p => p[0] === code)?.[1].trim() ?? '';
  const add = (e: DxfEntity) => {
    data.entities.push(e);
    data.layers.set(e.layer, (data.layers.get(e.layer) ?? 0) + 1);
  };
  const ignore = (t: string) => data.ignored.set(t, (data.ignored.get(t) ?? 0) + 1);

  for (let k = 0; k < ents.length; k++) {
    const { type, g } = ents[k];
    const layer = str(g, 8) || '0';
    switch (type) {
      case 'POINT':
        add({ type: 'POINT', layer, x: num(g, 10), y: num(g, 20), z: num(g, 30, 0) });
        break;
      case 'INSERT': {
        const attribs: Array<{ tag: string; text: string }> = [];
        const hasAttr = num(g, 66, 0) === 1;
        if (hasAttr) {
          while (k + 1 < ents.length && ents[k + 1].type === 'ATTRIB') { attribs.push({ tag: str(ents[k + 1].g, 2).toUpperCase(), text: cleanText(str(ents[k + 1].g, 1)) }); k++; }
          if (ents[k + 1]?.type === 'SEQEND') k++;
        }
        add({ type: 'INSERT', layer, x: num(g, 10), y: num(g, 20), z: num(g, 30, 0), block: str(g, 2), attribs });
        break;
      }
      case 'TEXT':
      case 'MTEXT':
        add({ type: 'TEXT', layer, x: num(g, 10), y: num(g, 20), z: num(g, 30, 0), text: cleanText(g.filter(p => p[0] === 1 || p[0] === 3).map(p => p[1]).join('')) });
        break;
      case 'LWPOLYLINE': {
        const elev = num(g, 38, 0);
        const pts: P3[] = [];
        let x = NaN;
        for (const [c, v] of g) {
          if (c === 10) x = parseFloat(v);
          else if (c === 20) pts.push({ x, y: parseFloat(v), z: elev });
        }
        add({ type: 'POLY', layer, pts, closed: (num(g, 70, 0) & 1) === 1, src: 'LWPOLYLINE', color: num(g, 62) });
        break;
      }
      case 'POLYLINE': {
        const flags = num(g, 70, 0);
        const elev = num(g, 30, 0);
        const is3d = (flags & 8) === 8;
        const pts: P3[] = [];
        while (k + 1 < ents.length && ents[k + 1].type === 'VERTEX') {
          const vg = ents[k + 1].g;
          const vf = num(vg, 70, 0);
          // 多面網格的面記錄（128 且非 64）不是頂點
          if (!((vf & 128) && !(vf & 64))) pts.push({ x: num(vg, 10), y: num(vg, 20), z: is3d || (vf & 64) ? num(vg, 30, 0) : elev });
          k++;
        }
        if (ents[k + 1]?.type === 'SEQEND') k++;
        if (flags & 16) { ignore('POLYLINE(網格)'); break; }
        add({ type: 'POLY', layer, pts, closed: (flags & 1) === 1, src: is3d ? '3D POLYLINE' : 'POLYLINE', color: num(g, 62) });
        break;
      }
      case 'LINE':
        add({ type: 'POLY', layer, pts: [{ x: num(g, 10), y: num(g, 20), z: num(g, 30, 0) }, { x: num(g, 11), y: num(g, 21), z: num(g, 31, 0) }], closed: false, src: 'LINE', color: num(g, 62) });
        break;
      case '3DFACE': {
        const pts: P3[] = [];
        for (let c = 0; c < 4; c++) pts.push({ x: num(g, 10 + c), y: num(g, 20 + c), z: num(g, 30 + c, 0) });
        add({ type: '3DFACE', layer, pts });
        break;
      }
      case 'ATTRIB': case 'VERTEX': case 'SEQEND':
        break;
      default:
        ignore(type);
    }
  }
  return data;
}

/** 去除 MTEXT 格式碼並還原 \U+XXXX */
export function cleanText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[PpNn]/g, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[cCdDpP]/g, '')
    .trim();
}

/** 從文字取出高程數字（例：「▲702.35」、「EL=702.35」） */
export function numberInText(s: string): number | null {
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  // 文字中除了數字只允許少量符號，避免把「第3號」當成高程
  const rest = s.replace(m[0], '').replace(/[\s▲△●○.+=:：ELHZelhz高程]/g, '');
  if (rest.length > 2) return null;
  return Number(m[0]);
}

export interface DxfImportOptions {
  layers: Set<string>;
  usePoints: boolean;
  useText: boolean;
  usePolylines: boolean;
  /** 沿等高線加密取點間距（公尺），0 表示只取頂點 */
  densify: number;
  /** 重複點濾除距離 */
  minDist: number;
  /** 文字高程對應到無高程點的搜尋半徑 */
  textRadius: number;
  /** 剔除遠離主要地形的飛點（含 0,0 與圖框） */
  removeOutliers: boolean;
  zRule: ZRule;
}

export interface DxfImportReport {
  points: Omit<SurveyPoint, 'id'>[];
  fromPoints: number;
  fromText: number;
  fromLines: number;
  invalidZ: number;
  outliers: number;
  duplicates: number;
}

export function dxfToPoints(data: DxfData, o: DxfImportOptions): DxfImportReport {
  const rep: DxfImportReport = { points: [], fromPoints: 0, fromText: 0, fromLines: 0, invalidZ: 0, outliers: 0, duplicates: 0 };
  const cand: Array<{ x: number; y: number; z: number | null; name?: string; code?: string; src: 'pt' | 'txt' | 'line' }> = [];
  const ents = data.entities.filter(e => o.layers.has(e.layer));
  const zOk = (z: number) => isValidZ(z, o.zRule);

  // 1. 點與圖塊
  const marks: Array<{ x: number; y: number; z: number | null; code: string; name?: string }> = [];
  if (o.usePoints) {
    for (const e of ents) {
      if (e.type === 'POINT' || e.type === 'INSERT') {
        if (!isFinite(e.x) || !isFinite(e.y)) continue;
        let z: number | null = zOk(e.z) ? e.z : null;
        let name: string | undefined, code = e.type === 'INSERT' ? e.block : e.layer;
        if (e.type === 'INSERT') {
          // 測量圖塊屬性：ELEV 高程、PNTS 點號、DESC 代碼（烏石坑等測量圖常見）
          const tag = (...keys: string[]) => e.attribs.find(a => keys.includes(a.tag))?.text;
          const elev = tag('ELEV', 'Z', 'H', 'HEIGHT', 'EL', '高程');
          if (elev !== undefined) { const v = numberInText(elev); if (v !== null && zOk(v)) z = v; }
          name = tag('PNTS', 'PNT', 'PT', 'NO', 'POINT', '點號') || undefined;
          code = tag('DESC', 'CODE', '代碼') || code;
          if (z === null) for (const a of e.attribs) { if (['PNTS', 'PNT', 'PT', 'NO', 'POINT'].includes(a.tag)) continue; const v = numberInText(a.text); if (v !== null && zOk(v)) { z = v; break; } }
        }
        marks.push({ x: e.x, y: e.y, z, code, name });
      }
    }
  }
  // 2. 高程文字：先配給附近無高程的點，配不到就自成一點
  if (o.useText) {
    const texts = ents.filter((e): e is Extract<DxfEntity, { type: 'TEXT' }> => e.type === 'TEXT')
      .map(e => ({ x: e.x, y: e.y, v: numberInText(e.text) }))
      .filter(t => t.v !== null && zOk(t.v) && isFinite(t.x) && isFinite(t.y));
    const r2 = o.textRadius * o.textRadius;
    for (const t of texts) {
      let best = -1, bestD = r2;
      for (let i = 0; i < marks.length; i++) {
        const dx = marks[i].x - t.x, dy = marks[i].y - t.y, d2 = dx * dx + dy * dy;
        if (d2 <= bestD) { bestD = d2; best = i; }
      }
      if (best >= 0) {
        if (marks[best].z === null) marks[best].z = t.v;
        continue; // 已有高程的點旁邊的標註文字，不重複建點
      }
      cand.push({ x: t.x, y: t.y, z: t.v, src: 'txt' });
    }
  }
  for (const m of marks) cand.push({ x: m.x, y: m.y, z: m.z, code: m.code, name: m.name, src: 'pt' });
  // 3. 等高線與 3D 線
  if (o.usePolylines) {
    for (const e of ents) {
      if (e.type !== 'POLY' && e.type !== '3DFACE') continue;
      const pts = e.pts.filter(p => isFinite(p.x) && isFinite(p.y));
      const closed = e.type === '3DFACE' || e.closed;
      const nSeg = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < pts.length; i++) cand.push({ ...pts[i], z: zOk(pts[i].z) ? pts[i].z : null, src: 'line' });
      if (o.densify > 0 && e.type === 'POLY') {
        for (let i = 0; i < nSeg; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if (!zOk(a.z) || !zOk(b.z)) continue;
          const L = Math.hypot(b.x - a.x, b.y - a.y);
          const n = Math.floor(L / o.densify);
          for (let s = 1; s < n; s++) {
            const t = (s * o.densify) / L;
            cand.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z), src: 'line' });
          }
        }
      }
    }
  }
  // 4. 無效高程：線上的點直接捨棄；點與文字保留為無高程點（仍可展點）
  let list = cand.filter(c => {
    if (c.z === null) { rep.invalidZ++; return c.src !== 'line'; }
    return true;
  });
  // 5. 飛點
  if (o.removeOutliers && list.length > 10) {
    const keep = outlierMask(list);
    rep.outliers = keep.filter(k => !k).length;
    list = list.filter((_, i) => keep[i]);
  }
  // 6. 重複點（格網雜湊）
  if (o.minDist > 0) {
    const cell = o.minDist;
    const grid = new Map<string, Array<{ x: number; y: number }>>();
    const out: typeof list = [];
    for (const p of list) {
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      let dup = false;
      for (let dx = -1; dx <= 1 && !dup; dx++) for (let dy = -1; dy <= 1 && !dup; dy++) {
        for (const q of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < cell * cell) { dup = true; break; }
        }
      }
      if (dup) { rep.duplicates++; continue; }
      const k = `${gx},${gy}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
      out.push(p);
    }
    list = out;
  }
  let n = 1;
  for (const p of list) {
    if (p.src === 'pt') rep.fromPoints++; else if (p.src === 'txt') rep.fromText++; else rep.fromLines++;
    rep.points.push({ name: p.name || `D${n}`, x: p.x, y: p.y, z: p.z, code: p.code }); n++;
  }
  return rep;
}

/** 以四分位距判斷 XY 飛點：距離主要地形太遠（含 0,0 與圖框角點） */
export function outlierMask(pts: Array<{ x: number; y: number }>, k = 3): boolean[] {
  const q = (arr: number[], p: number) => {
    const s = [...arr].sort((a, b) => a - b);
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const [x1, x3, y1, y3] = [q(xs, 0.25), q(xs, 0.75), q(ys, 0.25), q(ys, 0.75)];
  const ix = Math.max(x3 - x1, 1), iy = Math.max(y3 - y1, 1);
  return pts.map(p => p.x >= x1 - k * ix && p.x <= x3 + k * ix && p.y >= y1 - k * iy && p.y <= y3 + k * iy && !(p.x === 0 && p.y === 0));
}
