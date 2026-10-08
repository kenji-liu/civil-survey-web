// 縱斷面：縱坡交點 (VPI)、拋物線豎曲線、防砂壩／固床工垂直落差
// z(x) = z_BVC + g1·x + A/(2L)·x²，x 為距 BVC 的距離，A = g2 − g1；中距 e = A·L/8
// 設計高程 Z(s) = 縱坡線(含豎曲線) − Σ(樁號 ≤ s 的落差 ΔZ)；落差處取下游側，elevBefore 取上游側。
// 豎曲線長 L 太長而與前後重疊時自動縮短（reqL 保留原輸入值）。

export interface VPI { sta: number; z: number; /** 豎曲線長，0 表示不設 */ L: number }

/** 垂直落差構造物：沿樁號增加方向下降 dz（m，負值為上升） */
export interface Drop { sta: number; dz: number; name: string }

export interface VerticalCurve {
  index: number; sta: number; z: number;
  /** 實際採用的豎曲線長（可能被縮短）與原輸入值 */
  L: number; reqL: number;
  g1: number; g2: number; A: number; e: number;
  bvc: number; evc: number;
  type: 'crest' | 'sag';
}

export interface Profile {
  vpis: VPI[];
  drops: Drop[];
  curves: VerticalCurve[];
  grades: number[];
  warnings: string[];
  /** 設計高（含落差，落差處取下游） */
  elevAt(sta: number): number | null;
  /** 設計高（落差處取上游） */
  elevBefore(sta: number): number | null;
  /** 縱坡線本身（不含落差） */
  lineAt(sta: number): number | null;
  gradeAt(sta: number): number | null;
  /** 樁號 s 之前（含）的累計落差 */
  dropShift(sta: number, strict?: boolean): number;
}

export function buildProfile(input: VPI[], dropsIn: Drop[] = []): Profile {
  const vpis = [...input].filter(v => isFinite(v.sta) && isFinite(v.z)).sort((a, b) => a.sta - b.sta);
  const drops = [...dropsIn].filter(d => isFinite(d.sta) && isFinite(d.dz)).sort((a, b) => a.sta - b.sta);
  const warnings: string[] = [];
  const grades: number[] = [];
  for (let i = 0; i < vpis.length - 1; i++) {
    const ds = vpis[i + 1].sta - vpis[i].sta;
    grades.push(ds > 0 ? (vpis[i + 1].z - vpis[i].z) / ds : 0);
  }
  const curves: VerticalCurve[] = [];
  let prevEvc = vpis[0]?.sta ?? 0;
  for (let i = 1; i < vpis.length - 1; i++) {
    const v = vpis[i];
    const g1 = grades[i - 1], g2 = grades[i], A = g2 - g1;
    const reqL = Math.max(0, v.L || 0);
    if (!(reqL > 0) || Math.abs(A) < 1e-12) { prevEvc = v.sta; continue; }
    // 不得與前一段豎曲線重疊，也不得超過下一個交點
    const L = Math.max(0, Math.min(reqL, 2 * (v.sta - prevEvc), 2 * (vpis[i + 1].sta - v.sta)));
    if (L < reqL - 1e-6) warnings.push(`VPI${i} 豎曲線長 ${reqL} m 與前後重疊，已縮短為 ${L.toFixed(2)} m`);
    if (L <= 1e-9) { prevEvc = v.sta; continue; }
    curves.push({ index: i, sta: v.sta, z: v.z, L, reqL, g1, g2, A, e: (A * L) / 8, bvc: v.sta - L / 2, evc: v.sta + L / 2, type: A < 0 ? 'crest' : 'sag' });
    prevEvc = v.sta + L / 2;
  }

  const segIndex = (sta: number) => {
    for (let i = 0; i < vpis.length - 1; i++) if (sta <= vpis[i + 1].sta) return i;
    return vpis.length - 2;
  };
  const inRange = (sta: number) => vpis.length >= 2 && sta >= vpis[0].sta - 1e-6 && sta <= vpis[vpis.length - 1].sta + 1e-6;
  const lineAt = (sta: number) => {
    if (!inRange(sta)) return null;
    for (const c of curves) {
      if (sta >= c.bvc && sta <= c.evc) {
        const x = sta - c.bvc;
        return c.z - c.g1 * (c.L / 2) + c.g1 * x + (c.A / (2 * c.L)) * x * x;
      }
    }
    const i = segIndex(sta);
    return vpis[i].z + grades[i] * (sta - vpis[i].sta);
  };
  const dropShift = (sta: number, strict = false) => {
    let sh = 0;
    for (const d of drops) if (strict ? d.sta < sta - 1e-6 : d.sta <= sta + 1e-6) sh += d.dz;
    return sh;
  };
  const elevAt = (sta: number) => { const z = lineAt(sta); return z === null ? null : z - dropShift(sta, false); };
  const elevBefore = (sta: number) => { const z = lineAt(sta); return z === null ? null : z - dropShift(sta, true); };
  const gradeAt = (sta: number) => {
    if (vpis.length < 2) return null;
    for (const c of curves) if (sta >= c.bvc && sta <= c.evc) return c.g1 + (c.A * (sta - c.bvc)) / c.L;
    return grades[segIndex(sta)];
  };
  return { vpis, drops, curves, grades, warnings, elevAt, elevBefore, lineAt, gradeAt, dropShift };
}

// ---------------- 規範檢查（參考值，依 v3.4 內建表） ----------------
/** 各設計速率：最大縱坡 g（%）、凸形 K 值 kc、凹形 K 值 ks */
export const PF_SPEC: Record<number, { g: number; kc: number; ks: number }> = {
  30: { g: 12, kc: 2, ks: 6 }, 40: { g: 11, kc: 4, ks: 9 }, 50: { g: 10, kc: 7, ks: 13 },
  60: { g: 9, kc: 11, ks: 18 }, 70: { g: 8, kc: 17, ks: 23 }, 80: { g: 7, kc: 26, ks: 30 },
};

export interface SpecReport { segBad: Set<number>; curveBad: Set<number>; lines: Array<{ ok: boolean; text: string }> }

const vipLabel = (i: number, n: number) => (i === 0 ? 'BP' : i === n - 1 ? 'EP' : `VIP${i}`);

/** 最小豎曲線長：Lmin = max(K·|A|, 0.6·V)，A 以 % 計；坡差 ≤ 0.5% 免設 */
export function minVcLength(Apct: number, speed: number): number | null {
  const sp = PF_SPEC[speed] ?? PF_SPEC[40];
  if (Math.abs(Apct) <= 0.5) return null;
  return Math.max((Apct < 0 ? sp.kc : sp.ks) * Math.abs(Apct), 0.6 * speed);
}

export function checkProfileSpec(p: Profile, speed: number): SpecReport {
  const sp = PF_SPEC[speed] ?? PF_SPEC[40];
  const n = p.vpis.length;
  const out: SpecReport = { segBad: new Set(), curveBad: new Set(), lines: [] };
  p.grades.forEach((g, i) => {
    if (Math.abs(g) * 100 > sp.g + 1e-9) {
      out.segBad.add(i);
      out.lines.push({ ok: false, text: `${vipLabel(i, n)}→${vipLabel(i + 1, n)} 縱坡 ${(Math.abs(g) * 100).toFixed(2)}% 超過限值 ${sp.g}%` });
    }
  });
  for (let i = 1; i < n - 1; i++) {
    const A = (p.grades[i] - p.grades[i - 1]) * 100;
    const Lmin = minVcLength(A, speed);
    if (Lmin === null) continue;
    const L = p.curves.find(c => c.index === i)?.L ?? 0;
    if (L < Lmin - 1e-6) {
      out.curveBad.add(i);
      out.lines.push({ ok: false, text: `VIP${i}（${A < 0 ? '凸' : '凹'}形 A=${Math.abs(A).toFixed(2)}%）豎曲線長 ${L.toFixed(1)} m 小於最小 ${Lmin.toFixed(1)} m` });
    }
  }
  if (!out.lines.length) out.lines.push({ ok: true, text: `縱坡與豎曲線長都符合 ${speed} km/h 的參考限值` });
  return out;
}

/** 依規範設定各 VIP 豎曲線長（進位到 5 m） */
export function specVcLengths(vpis: VPI[], speed: number): VPI[] {
  const s = [...vpis].sort((a, b) => a.sta - b.sta);
  return s.map((v, i) => {
    if (i === 0 || i === s.length - 1) return { ...v, L: 0 };
    const g1 = (v.z - s[i - 1].z) / (v.sta - s[i - 1].sta), g2 = (s[i + 1].z - v.z) / (s[i + 1].sta - v.sta);
    const Lmin = minVcLength((g2 - g1) * 100, speed);
    return Lmin === null ? v : { ...v, L: Math.ceil(Lmin / 5) * 5 };
  });
}

// ---------------- 其他設計線、備註 ----------------
export interface OtherLine { code: string; name: string; color: string; mode: 'abs' | 'rel'; visible: boolean; text: string }

/** 解析「樁號, 數值」每行一筆 */
export function parseStaValues(text: string): Array<{ sta: number; z: number }> {
  return text.split(/\r?\n/).map(t => t.split(/[,，\s\t]+/).filter(Boolean)).filter(a => a.length >= 2 && isFinite(+a[0]) && isFinite(+a[1]))
    .map(a => ({ sta: +a[0], z: +a[1] })).sort((a, b) => a.sta - b.sta);
}

/** 其他設計線在樁號 s 的高程（線性內插；相對模式加上中心設計高） */
export function otherLineZ(ln: OtherLine, s: number, design: (s: number) => number | null): number | null {
  const p = parseStaValues(ln.text);
  if (!p.length) return null;
  let z: number;
  if (s <= p[0].sta) z = p[0].z;
  else if (s >= p[p.length - 1].sta) z = p[p.length - 1].z;
  else {
    let i = 0;
    while (i < p.length - 2 && s >= p[i + 1].sta) i++;
    const t = (s - p[i].sta) / (p[i + 1].sta - p[i].sta || 1);
    z = p[i].z + t * (p[i + 1].z - p[i].z);
  }
  if (ln.mode === 'rel') { const d = design(s); return d === null ? null : d + z; }
  return z;
}

export function parseNotes(text: string): Array<{ sta: number; text: string }> {
  return text.split(/\r?\n/).map(l => l.match(/^\s*([-\d.]+)\s*[,，\s]\s*(.+)$/)).filter((m): m is RegExpMatchArray => !!m).map(m => ({ sta: +m[1], text: m[2].trim() }));
}

export function parseRanges(text: string): Array<{ s1: number; s2: number; text: string }> {
  return text.split(/\r?\n/).map(l => l.match(/^\s*([-\d.]+)\s*[,，\s]\s*([-\d.]+)\s*[,，\s]\s*(.+)$/)).filter((m): m is RegExpMatchArray => !!m).map(m => ({ s1: +m[1], s2: +m[2], text: m[3].trim() }));
}

/** 坡度顯示：百分比、1:n、角度 */
export function fmtGrade(g: number, f: 'pct' | 'ratio' | 'deg'): string {
  if (f === 'ratio') return Math.abs(g) < 1e-6 ? '平' : `${g > 0 ? '+' : '-'}1:${(1 / Math.abs(g)).toFixed(1)}`;
  if (f === 'deg') return `${((Math.atan(g) * 180) / Math.PI).toFixed(2)}°`;
  return `${g >= 0 ? '+' : ''}${(g * 100).toFixed(2)}%`;
}
