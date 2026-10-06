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
  return p;
}

function round(v: number, d = 3) { const f = Math.pow(10, d); return Math.round(v * f) / f; }
