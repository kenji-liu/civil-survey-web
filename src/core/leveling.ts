// 直接水準計算（依手冊第五章）：開放、閉合、附合水準；支援中間視（樁號測量）
// 儀器高 HI = 已知高程 + 後視；前視點高程 = HI − 前視；中間視高程 = HI − 中間視。

export interface LevelRow {
  name: string;
  bs: number | null;   // 後視
  is: number | null;   // 中間視
  fs: number | null;   // 前視
  /** 與上一列的距離（公尺），用於按距離分配閉合差；可空白 */
  dist: number | null;
}

export type LevelEnd = 'open' | 'loop' | 'known';

export interface LevelInput {
  startZ: number;
  endMode: LevelEnd;
  endZ: number;
  /** 閉合差限度係數 C（±C√K mm） */
  tolC: number;
  rows: LevelRow[];
}

export const LEVEL_CLASSES: Array<[number, string]> = [
  [4, '一等水準 ±4√K'], [8, '二等水準 ±8√K'], [12, '三等水準 ±12√K'], [24, '支線往返 ±24√K'],
  [20, '土木工程 ±20√K'], [7, '水利工程 ±7√K'], [3, '精密水準 ±3√K'],
];

export interface LevelResultRow { name: string; hi: number | null; zRaw: number | null; corr: number; z: number | null; kind: 'start' | 'tp' | 'is' | 'end' }

export interface LevelResult {
  ok: boolean;
  error?: string;
  rows: LevelResultRow[];
  sumBS: number; sumFS: number;
  /** 閉合差（公尺），開放水準為 null */
  f: number | null;
  totalDist: number;
  /** 允許閉合差（公尺）；未填距離時為 null */
  allowed: number | null;
  pass: boolean | null;
  setups: number;
}

export function computeLeveling(inp: LevelInput): LevelResult {
  const rows = inp.rows.filter(r => r.name.trim() || r.bs !== null || r.fs !== null || r.is !== null);
  const empty: LevelResult = { ok: false, rows: [], sumBS: 0, sumFS: 0, f: null, totalDist: 0, allowed: null, pass: null, setups: 0 };
  if (rows.length < 2) return { ...empty, error: '至少要有兩列' };
  if (rows[0].bs === null) return { ...empty, error: '第一列（已知點）要有後視讀數' };
  const out: LevelResultRow[] = [];
  let hi: number | null = inp.startZ + rows[0].bs;
  let sumBS = rows[0].bs, sumFS = 0, setups = 1;
  const setupOf: number[] = [0];
  out.push({ name: rows[0].name, hi, zRaw: inp.startZ, corr: 0, z: inp.startZ, kind: 'start' });
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    let zRaw: number | null = null;
    let kind: LevelResultRow['kind'] = 'is';
    if (r.fs !== null) {
      if (hi === null) return { ...empty, error: `第 ${i + 1} 列前面缺少後視` };
      zRaw = hi - r.fs; sumFS += r.fs; kind = 'tp';
      setupOf.push(setups);
      if (r.bs !== null) { hi = zRaw + r.bs; sumBS += r.bs; setups++; } else hi = null;
    } else if (r.is !== null) {
      if (hi === null) return { ...empty, error: `第 ${i + 1} 列前面缺少後視` };
      zRaw = hi - r.is;
      setupOf.push(setups - 0.5);
    } else return { ...empty, error: `第 ${i + 1} 列（${r.name}）沒有讀數` };
    out.push({ name: r.name, hi: kind === 'tp' ? hi : null, zRaw, corr: 0, z: zRaw, kind });
  }
  // 最後一個前視點為終點
  let lastTp = -1;
  for (let i = out.length - 1; i > 0; i--) if (out[i].kind === 'tp') { lastTp = i; break; }
  if (lastTp < 0) return { ...empty, error: '沒有前視讀數，無法計算' };
  out[lastTp].kind = 'end';
  const zEnd = out[lastTp].zRaw!;
  const f = inp.endMode === 'open' ? null : zEnd - (inp.endMode === 'loop' ? inp.startZ : inp.endZ);
  // 累積距離
  const cum: number[] = [0];
  let total = 0;
  const hasDist = rows.slice(1).some(r => r.dist !== null && r.dist > 0);
  for (let i = 1; i < rows.length; i++) { total += rows[i].dist ?? 0; cum.push(total); }
  if (f !== null) {
    const totalSetups = setupOf[lastTp] || 1;
    out.forEach((o, i) => {
      if (i === 0) return;
      // 有距離就按距離比例，沒有就按測站數比例；終點之後的點不再分配
      const w = hasDist && total > 0 ? Math.min(cum[i] / cum[lastTp], 1) : Math.min(Math.max(setupOf[i], 0) / totalSetups, 1);
      o.corr = -f * w;
      o.z = o.zRaw! + o.corr;
    });
  }
  const allowed = hasDist && total > 0 ? (inp.tolC * Math.sqrt(total / 1000)) / 1000 : null;
  return {
    ok: true, rows: out, sumBS, sumFS, f, totalDist: total, allowed,
    pass: f !== null && allowed !== null ? Math.abs(f) <= allowed + 1e-12 : null,
    setups,
  };
}
