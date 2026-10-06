// 3D 地形模擬（Three.js）：三角網地形、高程分層設色、垂直誇大、中心線與地物線
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Tin } from '../core/tin';
import type { Alignment } from '../core/alignment';
import type { Profile } from '../core/profile';
import type { SamResult, LegendItem } from '../core/sam';

export interface Terrain3DProps {
  tin: Tin;
  alignment: Alignment | null;
  profile: Profile;
  sam: SamResult | null;
  legend: LegendItem[];
  controls: Array<{ name: string; x: number; y: number; z: number | null }>;
  onClose(): void;
}

/** 高程分層設色：低處綠、中段黃褐、高處灰白 */
function ramp(t: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [[0, [0.16, 0.42, 0.28]], [0.35, [0.45, 0.6, 0.3]], [0.6, [0.72, 0.62, 0.38]], [0.85, [0.6, 0.5, 0.42]], [1, [0.88, 0.88, 0.86]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

export default function Terrain3D(props: Terrain3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const [exag, setExag] = useState(1.5);
  const [wire, setWire] = useState(false);
  const [showSam, setShowSam] = useState(true);

  useEffect(() => {
    const el = host.current!;
    const { tin } = props;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b0f14);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0f14, 1, 1e6);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1e6);

    // 局部座標：以三角網中心為原點，避免大座標（TWD97）造成的浮點抖動
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < tin.xs.length; i++) {
      minX = Math.min(minX, tin.xs[i]); maxX = Math.max(maxX, tin.xs[i]);
      minY = Math.min(minY, tin.ys[i]); maxY = Math.max(maxY, tin.ys[i]);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, z0 = tin.minZ;
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const toV = (x: number, y: number, z: number) => new THREE.Vector3(x - cx, (z - z0) * exag, -(y - cy));

    // 地形網格
    const n = tin.xs.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const dz = Math.max(tin.maxZ - tin.minZ, 1e-6);
    for (let i = 0; i < n; i++) {
      pos[3 * i] = tin.xs[i] - cx; pos[3 * i + 1] = (tin.zs[i] - z0) * exag; pos[3 * i + 2] = -(tin.ys[i] - cy);
      const [r, g, b] = ramp((tin.zs[i] - tin.minZ) / dz);
      col[3 * i] = r; col[3 * i + 1] = g; col[3 * i + 2] = b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(tin.tri), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    scene.add(mesh);
    if (wire) {
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
      scene.add(w);
    }
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x334022, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-span, span, span * 0.6);
    scene.add(sun);

    const lift = Math.max(span / 800, 0.05);
    const addLine = (pts: THREE.Vector3[], color: string | number, closed = false) => {
      if (pts.length < 2) return;
      const g = new THREE.BufferGeometry().setFromPoints(closed ? [...pts, pts[0]] : pts);
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
    };
    const ground = (x: number, y: number, z?: number | null) => toV(x, y, (z ?? tin.sample(x, y) ?? z0) + lift / Math.max(exag, 0.1));

    // 中心線（貼地）與設計縱坡線
    const al = props.alignment;
    if (al) {
      const gl: THREE.Vector3[] = [], dl: THREE.Vector3[] = [];
      const step = Math.max(al.length / 400, 0.5);
      for (let s = al.startStation; s <= al.endStation + 1e-6; s += step) {
        const sta = Math.min(s, al.endStation);
        const q = al.pointAt(sta)!;
        const gz = tin.sample(q.x, q.y);
        if (gz !== null) gl.push(ground(q.x, q.y, gz));
        const ez = props.profile.elevAt(sta);
        if (ez !== null) dl.push(toV(q.x, q.y, ez));
      }
      addLine(gl, 0x4fd1ff);
      addLine(dl, 0xffb347);
    }
    // 自動連線地物
    if (showSam && props.sam) {
      const L = new Map(props.legend.map(l => [l.code.toUpperCase(), l]));
      for (const ln of props.sam.lines) addLine(ln.pts.map(v => ground(v.x, v.y, v.z)), L.get(ln.feature)?.color ?? '#ffffff', ln.closed);
      for (const sy of props.sam.symbols) {
        const base = ground(sy.x, sy.y, sy.z);
        const h = Math.max(span / 120, 1.5) * (sy.feature === 'TR' ? 1.4 : 1);
        addLine([base, base.clone().add(new THREE.Vector3(0, h, 0))], L.get(sy.feature)?.color ?? '#ffffff');
      }
    }
    // 控制點：直立標竿
    for (const c of props.controls) {
      const gz = c.z ?? tin.sample(c.x, c.y);
      if (gz === null) continue;
      const base = toV(c.x, c.y, gz);
      addLine([base, base.clone().add(new THREE.Vector3(0, Math.max(span / 60, 3), 0))], 0xffe066);
    }

    camera.position.set(-span * 0.55, span * 0.55, span * 0.75);
    const ctrls = new OrbitControls(camera, renderer.domElement);
    ctrls.target.set(0, ((tin.maxZ + tin.minZ) / 2 - z0) * exag, 0);
    ctrls.enableDamping = true;
    ctrls.maxPolarAngle = Math.PI * 0.495;
    ctrls.update();

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const loop = () => { ctrls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctrls.dispose();
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [props.tin, props.alignment, props.profile, props.sam, props.legend, props.controls, exag, wire, showSam]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="view3d">
      <div ref={host} className="view3d-canvas" />
      <div className="view3d-ui">
        <label htmlFor="exag">垂直誇大 ×{exag.toFixed(1)}</label>
        <input id="exag" type="range" min={1} max={5} step={0.5} value={exag} onChange={e => setExag(Number(e.target.value))} />
        <label className="check" htmlFor="wire3d"><input id="wire3d" type="checkbox" checked={wire} onChange={e => setWire(e.target.checked)} /><span>三角網格線</span></label>
        <label className="check" htmlFor="sam3d"><input id="sam3d" type="checkbox" checked={showSam} onChange={e => setShowSam(e.target.checked)} /><span>地物線</span></label>
        <button type="button" className="btn primary" onClick={props.onClose}>回到 2D 平面</button>
      </div>
      <div className="view3d-hint">左鍵拖曳旋轉・右鍵拖曳平移・滾輪縮放　<span className="lg axis" />中心線（貼地）　<span className="lg cont" />設計縱坡線</div>
    </div>
  );
}
