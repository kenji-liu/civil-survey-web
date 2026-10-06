// 點檔匯入匯出（CSV / TXT）
import type { SurveyPoint, ZRule } from '../core/model';
import { isValidZ } from '../core/model';

export type ColumnOrder = 'PENZ' | 'PNEZ' | 'ENZ' | 'NEZ';

export const COLUMN_ORDER_LABEL: Record<ColumnOrder, string> = {
  PENZ: '點號, E(X), N(Y), Z, 代碼',
  PNEZ: '點號, N(Y), E(X), Z, 代碼',
  ENZ: 'E(X), N(Y), Z, 代碼',
  NEZ: 'N(Y), E(X), Z, 代碼',
};

export interface CsvParseResult {
  points: Omit<SurveyPoint, 'id'>[];
  skippedLines: number;
  nullZ: number;
}

/** 解碼文字檔：先試 UTF-8，失敗改用 Big5（台灣常見的舊檔） */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('big5').decode(buf);
  }
}

export function parsePointText(text: string, order: ColumnOrder, rule: ZRule): CsvParseResult {
  const points: Omit<SurveyPoint, 'id'>[] = [];
  let skippedLines = 0, nullZ = 0, auto = 1;
  const hasName = order === 'PENZ' || order === 'PNEZ';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const cols = line.includes(',') ? line.split(',') : line.includes('\t') ? line.split('\t') : line.split(/\s+/);
    const c = cols.map(s => s.trim().replace(/^"|"$/g, ''));
    const off = hasName ? 1 : 0;
    const a = Number(c[off]), b = Number(c[off + 1]);
    if (c.length < off + 2 || c[off] === '' || c[off + 1] === '' || !isFinite(a) || !isFinite(b)) { skippedLines++; continue; }
    const [x, y] = order === 'PNEZ' || order === 'NEZ' ? [b, a] : [a, b];
    const zRaw = c[off + 2] !== undefined && c[off + 2] !== '' ? Number(c[off + 2]) : NaN;
    const z = isValidZ(zRaw, rule) ? zRaw : null;
    if (z === null) nullZ++;
    const code = c.slice(off + 3).filter(Boolean).join(' ') || undefined;
    points.push({ name: hasName && c[0] ? c[0] : `P${auto}`, x, y, z, code });
    auto++;
  }
  return { points, skippedLines, nullZ };
}

/** 一般 CSV 輸出（含 BOM，Excel 開啟中文不亂碼） */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n');
}
