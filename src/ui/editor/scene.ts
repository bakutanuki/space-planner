import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Item, Place, Pt, Room } from '../../model/types';
import { squareOf } from '../../model/types';
import { buildWalls, roomBox } from '../../model/rooms';
import { areaOf, mainPart } from '../../model/shape';
import { effectiveElevation } from '../../model/stacking';
import { levelForHeight } from '../../model/levels';
import { isWallItem } from '../../model/placement';
import { footprint, type Box } from '../../model/geometry';
import { formatM, formatSquares } from '../../model/units';
import { box, buildFurniture, mat } from './furniture3d';

export type ViewMode = '2d' | '3d';
const M = (cm: number) => cm / 100;

interface WallView { group: THREE.Group; mats: { m: THREE.MeshStandardMaterial; op: number }[]; c: THREE.Vector3; n: THREE.Vector3 }
interface ItemView { key: string; holder: THREE.Group }

// Draws a place with three.js and handles cameras, picking and wall fading
export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  persp = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
  ctl3: OrbitControls;
  ctl2: OrbitControls;
  mode: ViewMode = '2d';
  private roomsGroup = new THREE.Group();
  private itemsGroup = new THREE.Group();
  private marksGroup = new THREE.Group();
  private walls: WallView[] = [];
  private items = new Map<string, ItemView>();
  private roomsKey = '';
  private place: Place | null = null;
  private pending = false;
  private ray = new THREE.Raycaster();
  onRender: (() => void) | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--scene').trim() || '#e9e6e0');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd6ccbb, 2.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(4.5, 7.5, 1.5); sun.target.position.set(0, 0, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    this.scene.add(sun, sun.target, this.roomsGroup, this.itemsGroup, this.marksGroup);
    this.ortho.up.set(0, 0, 1);
    this.ctl3 = new OrbitControls(this.persp, this.renderer.domElement);
    Object.assign(this.ctl3, { maxPolarAngle: Math.PI * 0.49, minDistance: 0.5, maxDistance: 60, screenSpacePanning: true });
    this.ctl2 = new OrbitControls(this.ortho, this.renderer.domElement);
    Object.assign(this.ctl2, { enableRotate: false, screenSpacePanning: true, minZoom: 0.2, maxZoom: 20 });
    this.ctl2.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.ctl2.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    for (const c of [this.ctl2, this.ctl3]) c.addEventListener('change', () => this.requestRender());
    this.setMode('2d');
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  get camera(): THREE.Camera { return this.mode === '2d' ? this.ortho : this.persp; }
  get controls(): OrbitControls { return this.mode === '2d' ? this.ctl2 : this.ctl3; }

  // Switch between the flat plan and the 3D view
  setMode(m: ViewMode) {
    this.mode = m;
    this.ctl2.enabled = m === '2d'; this.ctl3.enabled = m === '3d';
    this.requestRender();
  }

  resize() {
    const r = this.container.getBoundingClientRect(), w = Math.max(r.width, 1), h = Math.max(r.height, 1);
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this.fitOrtho();
    this.requestRender();
  }

  private orthoBox: Box | null = null;
  private fitOrtho() {
    const b = this.orthoBox; if (!b) return;
    const r = this.container.getBoundingClientRect(), a = Math.max(r.width, 1) / Math.max(r.height, 1);
    const hw = M(b.x1 - b.x0) / 2 + 0.4, hh = M(b.z1 - b.z0) / 2 + 0.4;
    const half = Math.max(hh, hw / a);
    Object.assign(this.ortho, { left: -half * a, right: half * a, top: half, bottom: -half });
    this.ortho.updateProjectionMatrix();
  }

  // Point both cameras at a part of the place (cm box)
  frame(b: Box) {
    this.orthoBox = b;
    const cx = M(b.x0 + b.x1) / 2, cz = M(b.z0 + b.z1) / 2;
    this.ortho.zoom = 1; this.fitOrtho();
    this.ortho.position.set(cx, 50, cz); this.ctl2.target.set(cx, 0, cz); this.ortho.lookAt(cx, 0, cz); this.ctl2.update();
    const r = this.container.getBoundingClientRect(), a = Math.max(r.width, 1) / Math.max(r.height, 1);
    const size = Math.max(M(b.x1 - b.x0), M(b.z1 - b.z0));
    const dist = (size * 1.25 + 0.6) / Math.min(1, a * 1.35);
    const tgt = new THREE.Vector3(cx, 0, M(b.z0) + M(b.z1 - b.z0) * 0.43);
    this.ctl3.target.copy(tgt);
    this.persp.position.copy(tgt).addScaledVector(new THREE.Vector3(0, 3.9, -4.4).normalize(), dist);
    this.ctl3.update();
    this.requestRender();
  }

  // Draw (or update) everything for a place
  setPlace(place: Place, opts: { tint: boolean; overlaps: Set<string>; selected: string | null; group?: Set<string> }) {
    this.place = place;
    const rk = JSON.stringify([place.rooms, place.wallThickness, place.gridOn, place.squareCm, this.mode]);
    if (rk !== this.roomsKey) { this.roomsKey = rk; this.buildRooms(place); }
    const seen = new Set<string>();
    for (const it of place.items) {
      if (it.removed) continue;
      seen.add(it.id);
      const elev = effectiveElevation(place, it);
      const color = opts.tint ? levelForHeight(elev).color : '';
      const mounted = isWallItem(it) || (it.type === 'tv' && !it.sitsOn && it.elevation > 0);
      const key = JSON.stringify([it.type, it.name, it.w, it.d, it.h, color, mounted, it.color ?? '']);
      let v = this.items.get(it.id);
      if (!v || v.key !== key) {
        if (v) { this.itemsGroup.remove(v.holder); dispose(v.holder); }
        const model = buildFurniture(it, { mounted });
        if (color) model.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat(new THREE.Color(color).getHex(), { r: 0.7 }); });
        const holder = new THREE.Group(); holder.add(model);
        holder.traverse(o => { o.userData.itemId = it.id; });
        v = { key, holder }; this.items.set(it.id, v); this.itemsGroup.add(holder);
      }
      v.holder.position.set(M(it.x), M(elev), M(it.z));
      v.holder.rotation.y = (it.rot * Math.PI) / 180;
    }
    for (const [id, v] of this.items) if (!seen.has(id)) { this.itemsGroup.remove(v.holder); dispose(v.holder); this.items.delete(id); }
    this.buildMarks(place, opts.overlaps, opts.selected, opts.group ?? new Set());
    this.requestRender();
  }

  // Selection highlight and red overlap outlines, always drawn on top
  private buildMarks(place: Place, overlaps: Set<string>, selected: string | null, group: Set<string>) {
    for (const c of [...this.marksGroup.children]) { this.marksGroup.remove(c); dispose(c); }
    for (const it of place.items) {
      if (it.removed) continue;
      const isSel = it.id === selected || group.has(it.id), isOver = overlaps.has(it.id);
      if (!isSel && !isOver) continue;
      const round = it.type === 'roundTable' || it.type === 'beanbag';
      if (isSel) {
        const fp = footprint(it, it.w + 6, it.d + 6, it.rot);
        const shape = new THREE.Shape(fp.map(p => new THREE.Vector2(M(p.x), -M(p.z))));
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x2f6fde, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }));
        fill.rotation.x = -Math.PI / 2; fill.position.y = 0.006; fill.renderOrder = 5; this.marksGroup.add(fill);
      }
      const color = isOver ? 0xd93025 : 0x2f6fde;
      const pts = round ? circlePts(it, it.w / 2 + (isSel ? 3 : 0)) : footprint(it, it.w + (isSel ? 6 : 0), it.d + (isSel ? 6 : 0), it.rot);
      this.marksGroup.add(strip(pts, isOver ? 0.03 : 0.02, color));
    }
  }

  private buildRooms(place: Place) {
    for (const c of [...this.roomsGroup.children]) { this.roomsGroup.remove(c); dispose(c); }
    this.walls = [];
    const two = this.mode === '2d';
    for (const room of place.rooms) {
      this.roomsGroup.add(floorMesh(room, squareOf(place, room), place.gridOn, this.renderer));
      const b = room.outline.length === 4 ? roomBox(room) : mainPart(room.outline), sq = squareOf(place, room);
      const lines = room.outline.length === 4
        ? [room.name, `${formatSquares(b.x1 - b.x0, sq).replace(' sq', '')} × ${formatSquares(b.z1 - b.z0, sq)}`, `${formatM(b.x1 - b.x0).replace(' m', '')} × ${formatM(b.z1 - b.z0)}`]
        : [room.name, `${(areaOf(room.outline) / 10000).toFixed(2)} m²`];
      this.roomsGroup.add(floorLabel(lines, M(b.x0 + b.x1) / 2, M(b.z0 + b.z1) / 2, Math.min(M(b.x1 - b.x0) * 0.75, 2.4)));
      for (const bi of room.builtIns) {
        const g = new THREE.Group();
        box(M(bi.w), M(bi.h), M(bi.d), mat(0x1c1916, { r: 0.6 }), 0, M(bi.h) / 2, 0, g);
        box(0.012, Math.min(2.1, M(bi.h) * 0.9), 0.01, mat(0x6b5f55), 0, Math.min(1.05, M(bi.h) * 0.45), -M(bi.d) / 2 - 0.005, g);
        g.position.set(M(bi.x), 0, M(bi.z)); g.rotation.y = (bi.rot * Math.PI) / 180;
        this.roomsGroup.add(g);
      }
    }
    for (const s of buildWalls(place)) {
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const g = new THREE.Group(), m = mat(two ? 0x4a4640 : 0xf2efe9, { r: 0.95, t: true });
      const mats = [{ m, op: 1 }];
      const T = M(s.thickness), H = M(s.height);
      const seg = (s0: number, s1: number, y0: number, y1: number) => { if (s1 - s0 > 0.001 && y1 - y0 > 0.001) box(s1 - s0, y1 - y0, T, m, (s0 + s1) / 2, (y0 + y1) / 2, 0, g); };
      let cur = 0;
      for (const hl of s.holes) {
        const a = M(hl.from), bb = M(hl.to);
        seg(cur, a, 0, H); seg(a, bb, 0, M(hl.sill)); if (!two) seg(a, bb, M(hl.top), H); cur = bb; // the plan view leaves out the wall above openings so doors show as gaps
        if (hl.kind === 'window') {
          const gm = mat(0x9cc7f0, { r: 0.2, t: true, op: two ? 0.9 : 0.45 });
          const gl = new THREE.Mesh(new THREE.BoxGeometry(bb - a, M(hl.top - hl.sill), 0.01), gm);
          gl.position.set((a + bb) / 2, M(hl.sill + hl.top) / 2, 0); g.add(gl); mats.push({ m: gm, op: gm.opacity });
        }
      }
      seg(cur, M(len), 0, H);
      g.position.set(M(s.a.x), 0, M(s.a.z));
      g.rotation.y = Math.atan2(-(s.b.z - s.a.z), s.b.x - s.a.x);
      this.roomsGroup.add(g);
      const mid = { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 };
      this.walls.push({ group: g, mats, c: new THREE.Vector3(M(mid.x), 0, M(mid.z)), n: new THREE.Vector3(s.side.x, 0, s.side.z) });
    }
  }

  requestRender() { if (!this.pending) { this.pending = true; requestAnimationFrame(() => this.render()); } }

  // Draws a frame; in 3D a wall fades when it stands between the camera and what you look at
  render() {
    this.pending = false;
    const cam = this.camera.position, tgt = this.controls.target;
    for (const w of this.walls) {
      const hide = this.mode === '3d' && cam.clone().sub(w.c).dot(w.n) * tgt.clone().sub(w.c).dot(w.n) < 0;
      for (const x of w.mats) { x.m.opacity = hide ? 0.07 : x.op; x.m.depthWrite = !hide; }
      w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = !hide; });
    }
    this.renderer.render(this.scene, this.camera);
    this.onRender?.();
  }

  private setRay(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
  }

  // Which piece is under the pointer
  pick(cx: number, cy: number): string | null {
    this.setRay(cx, cy);
    const hits = this.ray.intersectObjects(this.itemsGroup.children, true);
    return hits.length ? (hits[0].object.userData.itemId as string) : null;
  }

  // Where on the floor the pointer is (cm)
  floorPoint(cx: number, cy: number): Pt | null {
    this.setRay(cx, cy);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x * 100, z: p.z * 100 } : null;
  }

  // Screen position (CSS px inside the stage) of a floor point in cm
  project(p: Pt, yCm = 0): { x: number; y: number } {
    const v = new THREE.Vector3(M(p.x), M(yCm), M(p.z)).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
  }

  // PNG of the current view
  snapshot(): Promise<Blob | null> {
    this.render();
    return new Promise(res => this.renderer.domElement.toBlob(b => res(b), 'image/png'));
  }

  dispose() {
    this.ctl2.dispose(); this.ctl3.dispose();
    dispose(this.scene); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

// Frees GPU memory used by an object and its children
function dispose(o: THREE.Object3D) {
  o.traverse(x => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mm of mats) { const map = (mm as THREE.MeshStandardMaterial).map; if (map && !map.userData.shared) map.dispose(); mm.dispose(); }
  });
}

function circlePts(c: Pt, r: number): Pt[] {
  return Array.from({ length: 32 }, (_, i) => ({ x: c.x + r * Math.cos((i / 32) * Math.PI * 2), z: c.z + r * Math.sin((i / 32) * Math.PI * 2) }));
}

// Closed outline made of thin flat strips, drawn over everything
function strip(pts: Pt[], width: number, color: number): THREE.Group {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = M(Math.hypot(b.x - a.x, b.z - a.z));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len + width, width), m);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(M(a.x + b.x) / 2, 0.012, M(a.z + b.z) / 2); mesh.renderOrder = 6;
    g.add(mesh);
  }
  return g;
}

const floorTex = new Map<string, THREE.CanvasTexture>();
// One repeating floor tile (a square with its grid line, or plain), shared by every floor that uses it
function tileTexture(tileCm: number, grid: boolean, renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const key = tileCm + ':' + grid;
  const hit = floorTex.get(key);
  if (hit) return hit;
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#dccfb8'; g.fillRect(0, 0, n, n);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dots = Math.min(4000, (n * n * Math.max(0.15, 30 / tileCm)) / 90);
  for (let i = 0; i < dots; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(150,130,100,0.18)' : 'rgba(255,255,255,0.22)';
    g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  if (grid) { g.fillStyle = '#b4a68e'; const lw = Math.max(1.5, n * 0.012); g.fillRect(0, 0, lw, n); g.fillRect(0, 0, n, lw); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.userData.shared = true;
  floorTex.set(key, tex);
  return tex;
}

// Floor in the room's own shape; grid lines start at the room's corner and match the room's square size
function floorMesh(room: Room, squareCm: number, grid: boolean, renderer: THREE.WebGLRenderer): THREE.Mesh {
  const b = roomBox(room), tile = M(grid ? squareCm : 100);
  const shape = new THREE.Shape(room.outline.map(p => new THREE.Vector2(M(p.x - b.x0), -M(p.z - b.z0))));
  const geo = new THREE.ShapeGeometry(shape), pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, 1 + pos.getY(i) / tile);
  const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tileTexture(grid ? squareCm : 100, grid, renderer), roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(M(b.x0), 0, M(b.z0));
  floor.receiveShadow = true;
  return floor;
}

// Flat text on the floor, readable in the plan view
function floorLabel(lines: string[], x: number, z: number, width: number): THREE.Mesh {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96 * lines.length + 24;
  const g = c.getContext('2d')!;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.font = (i === 0 ? '600 64px' : '400 46px') + ' Archivo, Helvetica, Arial, sans-serif'; g.fillStyle = i === 0 ? '#6b675f' : '#8a8277'; g.fillText(l, 256, 60 + i * 96); });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, (width * c.height) / c.width), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI;
  m.position.set(x, 0.004, z);
  return m;
}
