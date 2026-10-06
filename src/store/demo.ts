// 示範資料：一段野溪谷地（TWD97 座標範圍），用來展示完整流程
import { newProject, type Project, type SurveyPoint } from '../core/model';
import { buildAlignment } from '../core/alignment';

const E0 = 243000, N0 = 2687000;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 溪床中心線 y(x)：蜿蜒由西向東 */
const streamY = (x: number) => 150 + 28 * Math.sin(x / 70) + 10 * Math.sin(x / 23);

/** 地形高程（局部座標 x: 0~420, y: 0~320） */
export function demoTerrain(x: number, y: number): number {
  const floor = 712 - 0.045 * x;                  // 溪床往東下降
  const d = Math.abs(y - streamY(x));
  const side = 0.26 * d + 0.0007 * d * d;         // 兩岸坡面
  const bumps = 2.2 * Math.sin(x / 31) * Math.cos(y / 27) + 1.4 * Math.sin((x + y) / 19);
  const terrace = y > streamY(x) ? 1.5 * Math.tanh((d - 40) / 8) + 1.5 : 0; // 北岸階地
  return floor + side + bumps + terrace;
}

export function demoProject(): Project {
  const p = newProject('示範：野溪護岸與便道工程');
  p.info = { name: '示範：野溪護岸與便道工程', code: 'DEMO-001', owner: '示範資料', site: '示範溪段', designer: '' };
  const r = rng(20261006);
  const pts: SurveyPoint[] = [];
  let id = 1;
  // 碎部點：約 8m 間距的抖動網格
  for (let gx = 0; gx <= 420; gx += 8) {
    for (let gy = 0; gy <= 320; gy += 8) {
      const x = gx + (r() - 0.5) * 6, y = gy + (r() - 0.5) * 6;
      if (x < 0 || y < 0 || x > 420 || y > 320) continue;
      pts.push({ id: id, name: String(id), x: E0 + x, y: N0 + y, z: round(demoTerrain(x, y) + (r() - 0.5) * 0.1), code: 'GND' });
      id++;
    }
  }
  // 溪床線
  for (let x = 0; x <= 420; x += 5) {
    const y = streamY(x);
    pts.push({ id, name: `S${id}`, x: E0 + x, y: N0 + y, z: round(demoTerrain(x, y) - 0.6), code: 'STRM' });
    id++;
  }
  // 兩筆常見的錯誤資料：無高程點、-9999，示範自動排除
  pts.push({ id: id++, name: 'BAD1', x: E0 + 210, y: N0 + 40, z: null, code: 'NOZ' });
  pts.push({ id: id++, name: 'BAD2', x: E0 + 230, y: N0 + 60, z: null, code: 'NOZ' });
  p.points = pts;
  p.boundary = [
    { x: E0 + 6, y: N0 + 6 }, { x: E0 + 414, y: N0 + 6 }, { x: E0 + 414, y: N0 + 314 }, { x: E0 + 6, y: N0 + 314 },
  ];
  p.contour = { interval: 1, majorEvery: 5, labels: true };
  p.grid = { cell: 10, designMode: 'flat', designZ: 730, slopePct: 0, slopeAzDeg: 90 };
  p.alignment = {
    name: 'A 便道',
    startStation: 0,
    interval: 20,
    minGap: 2,
    extraStations: [],
    ips: [
      { name: 'BP', x: E0 + 30, y: N0 + 228, curve: null },
      { name: 'IP1', x: E0 + 150, y: N0 + 250, curve: { kind: 'R', value: 80 } },
      { name: 'IP2', x: E0 + 270, y: N0 + 205, curve: { kind: 'R', value: 100 } },
      { name: 'EP', x: E0 + 390, y: N0 + 232, curve: null },
    ],
  };
  // 縱坡：依地面高抓起終點，中間設一個交點
  const al = buildAlignment(p.alignment)!;
  const zAt = (sta: number) => { const q = al.pointAt(sta)!; return demoTerrain(q.x - E0, q.y - N0); };
  const L = al.length;
  p.vpis = [
    { sta: 0, z: round(zAt(0) - 0.5), L: 0 },
    { sta: round(L * 0.45), z: round(zAt(L * 0.45) - 1.2), L: 60 },
    { sta: round(L), z: round(zAt(L) - 0.4), L: 0 },
  ];
  addSurveyDemo(p, r, al);
  return p;
}

/** 測量計算示範：控制點、四已知點導線、觀測手簿、沿中心線的水準測量。觀測值由真實幾何反算再加微小誤差。 */
function addSurveyDemo(p: Project, r: () => number, al: NonNullable<ReturnType<typeof buildAlignment>>) {
  const P = (x: number, y: number) => ({ x: E0 + x, y: N0 + y, z: round(demoTerrain(x, y)) });
  const K1 = P(20, 212), K2 = P(12, 286), K3 = P(402, 246), K4 = P(410, 302);
  const T1 = P(140, 266), T2 = P(266, 220);
  p.controls = [
    { name: 'K1', ...K1 }, { name: 'K2', ...K2 }, { name: 'K3', ...K3 }, { name: 'K4', ...K4 },
  ];
  const noise = (s: number) => (r() - 0.5) * 2 * s;
  const azDeg = (a: { x: number; y: number }, b: { x: number; y: number }) => ((Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI) + 360) % 360;
  const dms = (deg: number) => {
    deg = ((deg % 360) + 360) % 360;
    let s = Math.round(deg * 3600);
    const d = Math.floor(s / 3600); s -= d * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return `${d}.${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
  };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  // 導線 K2→[K1→T1→T2→K3]→K4，角度加 ±3″、距離加 ±3 mm 的誤差
  const seq = [K2, K1, T1, T2, K3, K4];
  const names = ['K1', 'T1', 'T2', 'K3'];
  p.traverse = {
    type: 'link-4', startAz: '0', backsight: 'K2', foresight: 'K4',
    rows: names.map((name, i) => {
      const prev = seq[i], cur = seq[i + 1], next = seq[i + 2];
      const beta = azDeg(cur, next) - azDeg(cur, prev) + noise(3 / 3600);
      return { name, angle: dms(beta), dist: i < 3 ? round(dist(cur, next) + noise(0.003)) : 0, dh: i < 3 ? round(next.z - cur.z + noise(0.004)) : null };
    }),
  };
  // 觀測手簿：K1 後視 K2，觀測 10 個碎部點與轉站點 T1；再由 T1 後視 K1 觀測 6 點
  const book = (st: typeof K1, stName: string, bs: typeof K1, bsName: string, targets: Array<{ x: number; y: number; name: string }>) => {
    const hi = 1.5;
    return {
      name: stName, bs: bsName, hi, bsAngle: '0', mode: 'SD' as const,
      obs: targets.map(t => {
        const q = P(t.x, t.y);
        const hd = dist(st, q), vd = q.z + 1.5 - (st.z + hi);
        const sd = Math.hypot(hd, vd);
        const zen = Math.acos(vd / sd) * 180 / Math.PI;
        const hz = azDeg(st, q) - azDeg(st, bs);
        return { name: t.name, ht: 1.5, hz: dms(hz + noise(2 / 3600)), v: dms(zen + noise(2 / 3600)), dist: round(sd + noise(0.002)), code: t.name.startsWith('T') ? '' : 'GND' };
      }),
    };
  };
  const ring = (cx: number, cy: number, n: number, rad: number, start: number) => Array.from({ length: n }, (_, k) => ({ x: cx + rad * Math.cos(k * 2 * Math.PI / n), y: cy + rad * Math.sin(k * 2 * Math.PI / n), name: String(start + k) }));
  p.stations = [
    book(K1, 'K1', K2, 'K2', [...ring(20, 212, 10, 28, 501), { x: 140, y: 266, name: 'T1' }]),
    book(T1, 'T1', K1, 'K1', ring(140, 266, 6, 22, 601)),
  ];
  // 水準：K1 → 沿中心線各樁（中間視／轉點）→ K3
  const stakes = al.stakes.map(s => ({ name: formatSta(s.sta), z: demoTerrain(s.x - E0, s.y - N0), x: s.x - E0, y: s.y - N0 }));
  const route = [{ name: 'K1', z: K1.z, x: 20, y: 212 }, ...stakes, { name: 'K3', z: K3.z, x: 402, y: 246 }];
  const rows: Project['level']['rows'] = [];
  let i = 0;
  const rd = (v: number) => Math.round((v + noise(0.0008)) * 1000) / 1000;
  while (i < route.length - 1) {
    // 這一站往前看到第 j 點為止，讀數都在 0.3 ~ 3.9 m 內
    let j = i + 1;
    while (j + 1 < route.length && j - i < 4) {
      const span = route.slice(i, j + 2).map(q => q.z);
      if (Math.max(...span) - Math.min(...span) > 3.4) break;
      j++;
    }
    const span = route.slice(i, j + 1).map(q => q.z);
    const hi = Math.max(...span) + 0.5;
    if (i === 0) rows.push({ name: route[0].name, bs: rd(hi - route[0].z), is: null, fs: null, dist: null });
    else rows[rows.length - 1].bs = rd(hi - route[i].z);
    for (let k = i + 1; k <= j; k++) {
      const q = route[k];
      const d = round(Math.hypot(q.x - route[k - 1].x, q.y - route[k - 1].y), 1);
      rows.push(k === j ? { name: q.name, bs: null, is: null, fs: rd(hi - q.z), dist: d } : { name: q.name, bs: null, is: rd(hi - q.z), fs: null, dist: d });
    }
    i = j;
  }
  p.level = { startZ: K1.z, endMode: 'known', endZ: K3.z, tolC: 20, rows };
}

function formatSta(m: number) {
  const km = Math.floor(m / 1000 + 1e-9);
  const rest = m - km * 1000;
  return `${km}+${Math.abs(m % 1) > 1e-6 ? rest.toFixed(2).padStart(6, '0') : rest.toFixed(0).padStart(3, '0')}`;
}

function round(v: number, d = 3) { const f = Math.pow(10, d); return Math.round(v * f) / f; }
