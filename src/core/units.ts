// 單位與格式：度分秒 (ddd.mmss)、樁號 (0K+320.50)

export const DEG = Math.PI / 180;

/** 把 ddd.mmss 寫法（例：13.0257 = 13°02′57″）轉成十進位度。可接受字串以避免浮點誤差。 */
export function dmsToDeg(input: number | string): number {
  const s = typeof input === 'number' ? input.toFixed(8) : input.trim();
  if (s === '' || isNaN(Number(s))) return NaN;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s.replace(/^\+/, '');
  const [intPart, fracRaw = ''] = body.split('.');
  const frac = (fracRaw + '0000').slice(0, Math.max(4, fracRaw.length));
  const d = Number(intPart || '0');
  const m = Number(frac.slice(0, 2));
  const secStr = frac.slice(2, 4) + (frac.length > 4 ? '.' + frac.slice(4) : '');
  const sec = Number(secStr);
  const v = d + m / 60 + sec / 3600;
  return neg ? -v : v;
}

/** 十進位度轉 ddd.mmss 數字寫法（秒取到 secDecimals 位）。 */
export function degToDmsNumber(deg: number, secDecimals = 0): string {
  const { neg, d, m, s } = splitDms(deg, secDecimals);
  const sStr = s.toFixed(secDecimals).padStart(secDecimals ? 3 + secDecimals : 2, '0').replace('.', '');
  return `${neg ? '-' : ''}${d}.${String(m).padStart(2, '0')}${sStr}`;
}

/** 十進位度轉 13°02′57″ 顯示字串。 */
export function degToDmsText(deg: number, secDecimals = 0): string {
  const { neg, d, m, s } = splitDms(deg, secDecimals);
  const sStr = s.toFixed(secDecimals).padStart(secDecimals ? 3 + secDecimals : 2, '0');
  return `${neg ? '-' : ''}${d}°${String(m).padStart(2, '0')}′${sStr}″`;
}

function splitDms(deg: number, secDecimals: number) {
  const neg = deg < 0;
  const unit = Math.pow(10, secDecimals);
  // 以秒為單位四捨五入後再拆，避免 59.9999″ 這種進位錯誤
  let totalSec = Math.round(Math.abs(deg) * 3600 * unit) / unit;
  const d = Math.floor(totalSec / 3600);
  totalSec -= d * 3600;
  const m = Math.floor(totalSec / 60 + 1e-12);
  const s = Math.max(0, totalSec - m * 60);
  return { neg, d, m, s };
}

/** 樁號格式化：1234.5 → 1K+234.50 */
export function formatStation(m: number, decimals = 2): string {
  if (!isFinite(m)) return '—';
  const neg = m < 0;
  const unit = Math.pow(10, decimals);
  const total = Math.round(Math.abs(m) * unit) / unit;
  const km = Math.floor(total / 1000 + 1e-9);
  const rest = total - km * 1000;
  const restStr = rest.toFixed(decimals).padStart(decimals ? 4 + decimals : 3, '0');
  return `${neg ? '-' : ''}${km}K+${restStr}`;
}

/** 解析樁號：接受 "2K+320.50"、"2+320.5"、"2320.5" */
export function parseStation(s: string): number {
  const t = s.trim().toUpperCase().replace(/\s/g, '');
  const m = t.match(/^(-?)(\d+)K?\+(\d+(?:\.\d+)?)$/);
  if (m) {
    const v = Number(m[2]) * 1000 + Number(m[3]);
    return m[1] ? -v : v;
  }
  return Number(t);
}

export function fmt(v: number | null | undefined, d = 3): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return v.toFixed(d);
}

/** 千分位數字（報表用） */
export function fmtThousands(v: number, d = 2): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
