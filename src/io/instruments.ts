// 各廠牌全站儀原始記錄檔 → 3DF 觀測資料（依手冊第三章附件的格式）
// 角度輸出一律為 ddd.mmss；十進位度的格式（Sokkia SDR）會先換算。
import type { Station, Obs } from '../core/survey';
import { parse3DF } from '../core/survey';
import { degToDmsNumber } from '../core/units';

export type InstrumentFormat = 'auto' | '3df' | 'gts' | 'sss' | 'sdr33' | 'gsi' | 'nikon' | 'geodimeter' | 'zeiss';

export const INSTRUMENT_FORMATS: Array<[InstrumentFormat, string]> = [
  ['auto', '自動判斷'],
  ['3df', '3DF（本系統通用格式）'],
  ['gts', 'Topcon GTS'],
  ['sss', 'Topcon SSS（TS 系列）'],
  ['sdr33', 'Sokkia SDR33'],
  ['gsi', 'Leica GSI'],
  ['nikon', 'Nikon DTM'],
  ['geodimeter', 'Trimble Geodimeter'],
  ['zeiss', 'Zeiss Rec500 / M5'],
];

export interface InstrumentResult {
  format: InstrumentFormat;
  stations: Station[];
  /** 記錄器中直接存的座標點（Nikon 座標記錄等） */
  coords: Array<{ name: string; x: number; y: number; z: number | null; code: string }>;
  warnings: string[];
}

export function detectFormat(text: string): InstrumentFormat {
  const t = text.slice(0, 4000);
  if (/^\s*(ST|SD|HD)\s*[:：]/m.test(t)) return '3df';
  if (/_'[^_]*_/.test(t) || /\?\+\d{8}m\d{7}\+\d{7}d/.test(t)) return 'gts';
  if (/^\s*STN[\t,]/m.test(t) || /^\s*JOB[\t,]/m.test(t)) return 'sss';
  if (/^\s*00NMSDR/m.test(t) || /^\s*09F1/m.test(t)) return 'sdr33';
  if (/^\*?11\d{4}[+-]\S{8,16}\s+21\./m.test(t)) return 'gsi';
  if (/^\s*\d+,\d,MD,/m.test(t)) return 'nikon';
  if (/^\s*(50|2|5)=\S+/m.test(t) && /\b7=\d/.test(t)) return 'geodimeter';
  if (/For M5\|/.test(t)) return 'zeiss';
  return '3df';
}

export function parseInstrument(text: string, format: InstrumentFormat = 'auto'): InstrumentResult {
  const f = format === 'auto' ? detectFormat(text) : format;
  const res: InstrumentResult = { format: f, stations: [], coords: [], warnings: [] };
  switch (f) {
    case '3df': res.stations = parse3DF(text).stations; break;
    case 'gts': parseGTS(text, res); break;
    case 'sss': parseSSS(text, res); break;
    case 'sdr33': parseSDR33(text, res); break;
    case 'gsi': parseGSI(text, res); break;
    case 'nikon': parseNikon(text, res); break;
    case 'geodimeter': parseGeodimeter(text, res); break;
    case 'zeiss': parseZeiss(text, res); break;
    default: break;
  }
  res.stations = res.stations.filter(s => s.obs.length || s.name);
  if (!res.stations.length && !res.coords.length) res.warnings.push('沒有讀到任何測站或觀測記錄，請確認儀器格式');
  return res;
}

const newStation = (name = '', bs = '', hi = 0, bsAngle = '0'): Station => ({ name, bs, hi, bsAngle, mode: 'SD', obs: [] });
const cur = (res: InstrumentResult) => {
  if (!res.stations.length) {
    res.stations.push(newStation('ST1'));
    res.warnings.push('檔案開頭沒有測站記錄，已建立測站 ST1，請在觀測手簿補上測站名、後視與儀器高');
  }
  return res.stations[res.stations.length - 1];
};
/** 去掉前導 0 的點號（000000B1 → B1；00001000 → 1000） */
const ptName = (s: string) => s.replace(/^0+(?=.)/, '').trim();
/** 7 位 DDDMMSS → ddd.mmss */
const dddmmss = (s: string) => `${Number(s.slice(0, s.length - 4))}.${s.slice(-4)}`;

// ---------- Topcon GTS ----------
// _'測站_ (後視_ )儀器高_ *代碼_ ,覘標高_ +點號_ ?+斜距(mm)m天頂距(DDDMMSS)+水平角(DDDMMSS)d…
function parseGTS(text: string, res: InstrumentResult) {
  const s = text.replace(/[\r\n]/g, '');
  // 欄位之間共用底線，結尾的底線用前瞻比對，不吃掉
  const re = /_(['()*,+])([^_]*)(?=_)|\?\+(\d{8})m(\d{7})\+(\d{7})d/g;
  let code = '', ht: number | null = null, pt = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[3]) {
      if (!pt) continue;
      const st = cur(res);
      st.obs.push({ name: pt, ht: ht ?? st.hi, hz: dddmmss(m[5]), v: dddmmss(m[4]), dist: Number(m[3]) / 1000, code });
      pt = ''; code = '';
      continue;
    }
    const [k, v] = [m[1], m[2].trim()];
    if (k === "'") res.stations.push(newStation(v));
    else if (k === '(') cur(res).bs = v;
    else if (k === ')') cur(res).hi = Number(v) || 0;
    else if (k === '*') code = v;
    else if (k === ',') ht = Number(v);
    else if (k === '+') pt = v;
  }
}

// ---------- Topcon SSS（TS-700 等）----------
// STN,測站,儀器高,  BKB,後視,後視方位,後視讀數  SS/FS/BS,點號,覘標高,代碼  SD,水平角,天頂距,斜距
function parseSSS(text: string, res: InstrumentResult) {
  let pending: { name: string; ht: number; code: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^([A-Z]{2,4})[\t,]?(.*)$/);
    if (!m) continue;
    const f = m[2].split(',').map(x => x.trim());
    switch (m[1]) {
      case 'STN': res.stations.push(newStation(f[0], '', Number(f[1]) || 0)); break;
      case 'BKB': { const st = cur(res); st.bs = f[0]; st.bsAngle = f[2] || f[1] || '0'; break; }
      case 'SS': case 'FS': case 'BS': pending = { name: f[0], ht: Number(f[1]) || 0, code: f[2] ?? '' }; break;
      case 'SD': {
        if (!pending) break;
        cur(res).obs.push({ name: pending.name, ht: pending.ht, hz: f[0], v: f[1], dist: Number(f[2]) || 0, code: pending.code });
        pending = null;
        break;
      }
      default: break;
    }
  }
}

// ---------- Sokkia SDR33 ----------
// 定寬欄位：記錄型態 4 碼、點號 4 碼（或 16 碼）、數值 10 碼（或 16 碼）；角度為十進位度
function parseSDR33(text: string, res: InstrumentResult) {
  const lines = text.split(/\r?\n/);
  const idW = lines.some(l => /^(02|09)/.test(l) && l.length > 70) ? 16 : 4;
  const numW = idW === 16 ? 16 : 10;
  let ht = 0;
  const fw = (l: string, start: number, w: number) => l.slice(start, start + w).trim();
  for (const l of lines) {
    const type = l.slice(0, 4);
    if (type === '02TP') {
      // 02TP 點號 N E Z 代碼 … 儀器高
      const id = fw(l, 4, idW);
      const nums = l.slice(4 + idW).match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      res.stations.push(newStation(id, '', nums[3] ?? 0));
      if (nums.length >= 3) res.coords.push({ name: id, x: nums[1], y: nums[0], z: nums[2], code: 'STN' });
    } else if (type === '03NM') {
      ht = Number(l.slice(4).trim()) || 0;
    } else if (type === '09F1' || type === '09F2') {
      const from = fw(l, 4, idW), to = fw(l, 4 + idW, idW);
      const rest = l.slice(4 + 2 * idW);
      const sd = Number(rest.slice(0, numW)), va = Number(rest.slice(numW, 2 * numW)), ha = Number(rest.slice(2 * numW, 3 * numW));
      const code = rest.slice(3 * numW).trim();
      if (![sd, va, ha].every(isFinite)) { res.warnings.push(`無法解讀：${l.trim()}`); continue; }
      let st = res.stations[res.stations.length - 1];
      if (!st || st.name !== from) { st = newStation(from); res.stations.push(st); }
      st.obs.push({ name: to, ht, hz: degToDmsNumber(ha, 1), v: degToDmsNumber(va, 1), dist: sd, code });
    }
  }
}

// ---------- Leica GSI ----------
// 每個字組：WI(2) 資訊(4) 符號(1) 資料(8 或 16)；11 點號、21 水平角、22 天頂距、31 斜距、32 平距、33 高差、87 覘標高、88 儀器高
function parseGSI(text: string, res: InstrumentResult) {
  const words = text.replace(/\*/g, ' ').split(/\s+/).filter(w => /^\d{2}[\d.]{4}[+-]/.test(w));
  let o: Partial<Obs> & { sd?: number; hd?: number; dh?: number } = {};
  const flush = () => {
    if (!o.name) return;
    const st = cur(res);
    if (o.sd !== undefined && o.v !== undefined) {
      st.obs.push({ name: o.name, ht: o.ht ?? 0, hz: o.hz ?? '0', v: o.v, dist: o.sd, code: o.code ?? '' });
    } else if (o.hd !== undefined) {
      st.mode = 'HD';
      st.obs.push({ name: o.name, ht: o.ht ?? 0, hz: o.hz ?? '0', v: String(o.dh ?? 0), dist: o.hd, code: o.code ?? '' });
    }
    o = {};
  };
  const angle = (unit: string, data: string) => {
    const v = Number(data);
    switch (unit) {
      case '2': return degToDmsNumber((v / 100000) * 0.9, 1);           // 400 gon
      case '3': return degToDmsNumber(v / 100000, 1);                    // 十進位度
      case '4': { const s = data.padStart(8, '0'); return `${Number(s.slice(0, s.length - 5))}.${s.slice(-5)}`; } // DDDMMSSs
      default: return degToDmsNumber(v / 100000, 1);
    }
  };
  const dist = (unit: string, data: string) => {
    const v = Number(data);
    return unit === '6' ? v / 10000 : unit === '8' ? v / 100000 : v / 1000;
  };
  for (const w of words) {
    const wi = w.slice(0, 2), unit = w[5], sign = w[6] === '-' ? -1 : 1, data = w.slice(7);
    switch (wi) {
      case '11': flush(); o.name = ptName(data); break;
      case '21': o.hz = angle(unit, data); break;
      case '22': o.v = angle(unit, data); break;
      case '31': o.sd = sign * dist(unit, data); break;
      case '32': o.hd = sign * dist(unit, data); break;
      case '33': o.dh = sign * dist(unit, data); break;
      case '41': o.code = ptName(data); break;
      case '87': o.ht = sign * dist(unit, data); break;
      case '88': cur(res).hi = sign * dist(unit, data); break;
      default: break;
    }
  }
  flush();
}

// ---------- Nikon DTM ----------
// 型態 0：測站（站名, 代碼, 儀器高, 後視, 後視讀數）；2：觀測（點號, 代碼, 斜距, 水平角, 天頂距, 覘標高）；1、4：座標（N, E, Z）
function parseNikon(text: string, res: InstrumentResult) {
  // DTM300 的記錄可能被換行拆開：以「數字,數字,MD,」開頭的行才是新記錄，其餘接到上一筆
  const records: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\d+,\d+,MD,/.test(line)) records.push(line.trim());
    else if (records.length && line.trim()) records[records.length - 1] += line.trim();
  }
  for (const raw of records) {
    const f = raw.split(',').map(x => x.trim());
    if (f.length < 5 || f[2] !== 'MD') continue;
    const type = f[1], name = f[3], code = f[4] ?? '';
    const nums = f.slice(5).filter(x => /^-?\d+(\.\d+)?$/.test(x));
    if (type === '0') {
      res.stations.push(newStation(name, f[6] ?? '', Number(f[5]) || 0, f[7] || '0'));
    } else if (type === '2' && nums.length >= 4) {
      cur(res).obs.push({ name, ht: Number(nums[3]) || 0, hz: nums[1], v: nums[2], dist: Number(nums[0]), code });
    } else if (nums.length >= 3) {
      res.coords.push({ name, y: Number(nums[0]), x: Number(nums[1]), z: Number(nums[2]), code });
    }
  }
  if (res.coords.length) res.warnings.push('座標記錄以 N、E、Z 順序讀入；若方向不對，請在測點頁對調 E/N');
}

// ---------- Trimble Geodimeter ----------
// 標籤＝值：2 測站、3 儀器高、62 後視、21 後視讀數、4 代碼、5 點號、6 覘標高、7 水平角、8 天頂距、9 斜距、11 平距、10 高差
function parseGeodimeter(text: string, res: InstrumentResult) {
  let o: Record<string, string> = {};
  const flush = () => {
    if (o['5'] === undefined) { o = {}; return; }
    const st = cur(res);
    if (o['9'] !== undefined) st.obs.push({ name: o['5'], ht: Number(o['6'] ?? 0), hz: o['7'] ?? '0', v: o['8'] ?? '90', dist: Number(o['9']), code: o['4'] ?? '' });
    else if (o['11'] !== undefined) { st.mode = 'HD'; st.obs.push({ name: o['5'], ht: Number(o['6'] ?? 0), hz: o['7'] ?? '0', v: o['10'] ?? '0', dist: Number(o['11']), code: o['4'] ?? '' }); }
    o = {};
  };
  for (const tok of text.split(/\s+/)) {
    const m = tok.match(/^(\d+)=(.*)$/);
    if (!m) continue;
    const [k, v] = [m[1], m[2]];
    if (k === '2') { flush(); res.stations.push(newStation(v)); }
    else if (k === '3') cur(res).hi = Number(v) || 0;
    else if (k === '62') cur(res).bs = v;
    else if (k === '21') cur(res).bsAngle = v;
    else if (k === '4') { flush(); o['4'] = v; }
    else if (k === '5') { if (o['5'] !== undefined) flush(); o['5'] = v; }
    else o[k] = v;
  }
  flush();
}

// ---------- Zeiss Rec500 / M5 ----------
// For M5|Adr n|PI1 點號|SD 值 m |Hz 值 DMS |V1 值 DMS |
function parseZeiss(text: string, res: InstrumentResult) {
  const records = text.replace(/\r/g, '').split(/(?=For M5\|)/).map(r => r.replace(/\n/g, ' '));
  for (const r of records) {
    if (!r.startsWith('For M5|')) continue;
    const blocks = r.split('|').map(b => b.trim());
    const adr = blocks[1]?.replace(/^Adr\s*/, '').trim() ?? '';
    const info = blocks[2] ?? '';
    const val = (key: string) => {
      for (const b of blocks.slice(3)) { const m = b.match(new RegExp(`^${key}\\s+(-?[\\d.]+)`)); if (m) return m[1]; }
      return undefined;
    };
    const ih = val('ih'), th = val('th');
    if (/^(KI|STN|TI\s+STATION)/i.test(info)) { res.stations.push(newStation(info.split(/\s+/).pop() ?? adr, '', Number(ih ?? 0))); continue; }
    if (ih !== undefined) cur(res).hi = Number(ih);
    const sd = val('SD'), hz = val('Hz'), v = val('V1') ?? val('V');
    if (sd === undefined || hz === undefined || v === undefined) continue;
    const name = info.replace(/^PI\d\s*/, '').trim().split(/\s+/).pop() || adr;
    cur(res).obs.push({ name, ht: Number(th ?? 0), hz, v, dist: Number(sd), code: '' });
  }
}
