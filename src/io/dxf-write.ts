// DXF 匯出：AutoCAD R12（AC1009）格式，相容性最高。中文以 \U+XXXX 寫出。
import type { XY } from '../core/geom';

interface Layer { name: string; color: number }

export class DxfWriter {
  private layers = new Map<string, Layer>();
  private body: string[] = [];

  layer(name: string, color: number) {
    this.layers.set(name, { name, color });
    return this;
  }

  private ensure(layer: string) {
    if (!this.layers.has(layer)) this.layers.set(layer, { name: layer, color: 7 });
  }

  private g(code: number, value: string | number) {
    this.body.push(String(code), typeof value === 'number' ? (isIntCode(code) ? String(Math.round(value)) : fmtNum(value)) : value);
  }

  point(layer: string, x: number, y: number, z = 0) {
    this.ensure(layer);
    this.g(0, 'POINT'); this.g(8, layer); this.g(10, x); this.g(20, y); this.g(30, z);
  }

  line(layer: string, a: { x: number; y: number; z?: number }, b: { x: number; y: number; z?: number }) {
    this.ensure(layer);
    this.g(0, 'LINE'); this.g(8, layer);
    this.g(10, a.x); this.g(20, a.y); this.g(30, a.z ?? 0);
    this.g(11, b.x); this.g(21, b.y); this.g(31, b.z ?? 0);
  }

  text(layer: string, x: number, y: number, height: number, s: string, rotationDeg = 0, z = 0) {
    this.ensure(layer);
    this.g(0, 'TEXT'); this.g(8, layer);
    this.g(10, x); this.g(20, y); this.g(30, z);
    this.g(40, height); this.g(1, encodeText(s));
    if (rotationDeg) this.g(50, rotationDeg);
  }

  /** 2D 多段線（固定高程，等高線用） */
  polyline(layer: string, pts: XY[], closed = false, elevation = 0) {
    if (pts.length < 2) return;
    this.ensure(layer);
    this.g(0, 'POLYLINE'); this.g(8, layer); this.g(66, 1);
    this.g(10, 0); this.g(20, 0); this.g(30, elevation);
    this.g(70, closed ? 1 : 0);
    for (const p of pts) { this.g(0, 'VERTEX'); this.g(8, layer); this.g(10, p.x); this.g(20, p.y); this.g(30, elevation); }
    this.g(0, 'SEQEND'); this.g(8, layer);
  }

  /** 3D 多段線 */
  polyline3d(layer: string, pts: Array<{ x: number; y: number; z: number }>, closed = false) {
    if (pts.length < 2) return;
    this.ensure(layer);
    this.g(0, 'POLYLINE'); this.g(8, layer); this.g(66, 1);
    this.g(10, 0); this.g(20, 0); this.g(30, 0);
    this.g(70, 8 | (closed ? 1 : 0));
    for (const p of pts) { this.g(0, 'VERTEX'); this.g(8, layer); this.g(10, p.x); this.g(20, p.y); this.g(30, p.z); this.g(70, 32); }
    this.g(0, 'SEQEND'); this.g(8, layer);
  }

  face3d(layer: string, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }) {
    this.ensure(layer);
    this.g(0, '3DFACE'); this.g(8, layer);
    const v = [a, b, c, c];
    v.forEach((p, i) => { this.g(10 + i, p.x); this.g(20 + i, p.y); this.g(30 + i, p.z); });
  }

  toString(): string {
    const out: string[] = [];
    const g = (c: number, v: string | number) => out.push(String(c), String(v));
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, 6);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, this.layers.size + 1);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    for (const L of this.layers.values()) {
      if (L.name === '0') continue;
      g(0, 'LAYER'); g(2, L.name); g(70, 0); g(62, L.color); g(6, 'CONTINUOUS');
    }
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    const tail = ['0', 'ENDSEC', '0', 'EOF'];
    // 圖元可能有數十萬行，不用展開運算子以免堆疊溢位
    return out.join('\r\n') + '\r\n' + (this.body.length ? this.body.join('\r\n') + '\r\n' : '') + tail.join('\r\n') + '\r\n';
  }
}

/** DXF 規定為整數的群組碼，必須寫成不帶小數點的整數 */
function isIntCode(c: number): boolean {
  return (c >= 60 && c <= 99) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) || (c >= 370 && c <= 389) || (c >= 400 && c <= 409) || (c >= 1060 && c <= 1071);
}

function fmtNum(v: number): string {
  if (!isFinite(v)) return '0';
  return Number.isInteger(v) ? v.toFixed(1) : v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

/** 非 ASCII 字元轉成 AutoCAD 認得的 \U+XXXX */
export function encodeText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c < 128 ? ch : c <= 0xffff ? `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}` : '?';
  }
  return out;
}
