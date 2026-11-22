import * as THREE from 'three';
import type { Item } from '../../model/types';

type MatOpts = { r?: number; m?: number; e?: number; ei?: number; t?: boolean; op?: number };
// A surface material (colour, roughness, metal, glow)
export function mat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.8, metalness: o.m ?? 0, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.op ?? 1 });
}
// A colour made darker (f < 1) or lighter (f > 1)
export function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}
// A box at a position inside a group (all metres)
export function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), m);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

// Sofa with arms, seat cushions and back (ported from the original planner, scaled to the item's height)
function sofa(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  const lea = mat(c ?? 0xd8caae, { r: 0.5 }), seam = mat(c !== undefined ? shade(c, 0.93) : 0xcdbe9f, { r: 0.55 });
  const k = h / 0.85, armW = Math.min(0.2, w * 0.15), backT = Math.min(0.22, d * 0.3), armH = 0.62 * k, seats = w > 1.8 ? 3 : w > 1.1 ? 2 : 1;
  const inner = w - 2 * armW, cw = inner / seats;
  box(inner, 0.28 * k, d - backT, lea, 0, 0.14 * k, backT / 2, g);
  for (let i = 0; i < seats; i++) {
    box(cw - 0.02, 0.14 * k, d - backT - 0.03, i % 2 ? lea : seam, -inner / 2 + cw * (i + 0.5), 0.35 * k, backT / 2 + 0.01, g);
    box(cw - 0.02, 0.42 * k, 0.14, i % 2 ? lea : seam, -inner / 2 + cw * (i + 0.5), 0.63 * k, -d / 2 + backT + 0.05, g);
  }
  box(inner, h, backT, lea, 0, h / 2, -d / 2 + backT / 2, g);
  box(armW, armH, d, lea, -(w / 2 - armW / 2), armH / 2, 0, g);
  box(armW, armH, d, lea, w / 2 - armW / 2, armH / 2, 0, g);
}

// Wooden TV stand with shelves (the original planner's stand)
function stand(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  const wood = mat(c ?? 0x4a3a2c, { r: 0.7 }), dark = mat(c !== undefined ? shade(c, 0.6) : 0x2a221b, { r: 0.7 }), k = h / 0.6;
  box(w, 0.04, d, wood, 0, h - 0.02, 0, g);
  box(w, 0.03, d, wood, 0, 0.30 * k, 0, g);
  box(w, 0.03, d, wood, 0, 0.06 * k, 0, g);
  box(w * 0.36, 0.24 * k, d * 0.96, dark, 0, 0.18 * k, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.03, h, 0.03, mat(0x1b1b1b), sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02), g);
}

// Flat TV; on a stand it gets a small foot, on a wall it's just the panel
function tv(w: number, d: number, h: number, g: THREE.Group, mounted: boolean, c?: number) {
  const foot = mounted ? 0 : Math.min(0.08, h * 0.15);
  if (foot) { box(Math.min(0.36, w * 0.4), 0.03, Math.max(d, 0.05), mat(0x151515), 0, 0.015, 0, g); box(0.06, foot, Math.max(d * 0.8, 0.03), mat(0x151515), 0, foot / 2, 0, g); }
  const ph = h - foot;
  box(w, ph, d, mat(c ?? 0x111111, { r: 0.4 }), 0, foot + ph / 2, 0, g);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w - 0.03, 0.01), Math.max(ph - 0.03, 0.01)), mat(0x1c3a66, { r: 0.25, e: 0x0d2347, ei: 0.6 }));
  scr.position.set(0, foot + ph / 2, d / 2 + 0.001); g.add(scr);
}

// Coffee or dining table: top on four thin legs
function table(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  box(w, 0.04, d, mat(c ?? 0x5b3a26, { r: 0.6 }), 0, h - 0.02, 0, g);
  const lm = mat(0x151515, { r: 0.4, m: 0.5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h - 0.04, 6), lm);
    leg.position.set(sx * (w / 2 - Math.min(0.07, w / 4)), (h - 0.04) / 2, sz * (d / 2 - Math.min(0.07, d / 4))); leg.castShadow = true; g.add(leg);
  }
}

// Round table on a single stem
function roundTable(w: number, h: number, g: THREE.Group, c?: number) {
  const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.04, 40), mat(c ?? 0x5b3a26, { r: 0.6 }));
  top.position.y = h - 0.02; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h - 0.04, 12), mat(0x151515, { m: 0.5, r: 0.4 }));
  stem.position.y = (h - 0.04) / 2; stem.castShadow = true; g.add(stem);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.22, w * 0.25, 0.02, 24), mat(0x151515, { m: 0.5, r: 0.4 }));
  base.position.y = 0.01; g.add(base);
}

// Nightstand / side table: a block with a drawer line (original side table)
function side(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  box(w, h, d, mat(c ?? 0xd9c6a2, { r: 0.7 }), 0, h / 2, 0, g);
  box(w * 0.9, 0.012, 0.01, mat(c !== undefined ? shade(c, 0.8) : 0xb9a581), 0, h * 0.68, d / 2 + 0.001, g);
}

// Folded treadmill (original)
function treadmill(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  const k = h / 1.42;
  box(w, 0.1 * k, d, mat(0x2b2b2b, { r: 0.5 }), 0, 0.05 * k, 0, g);
  box(w * 0.94, 1.32 * k, Math.min(0.12, d * 0.4), mat(c ?? 0xeeeeee, { r: 0.4 }), 0, 0.76 * k, -d / 2 + Math.min(0.09, d * 0.3), g);
  box(w * 0.7, 1.14 * k, 0.01, mat(0x222222, { r: 0.9 }), 0, 0.76 * k, -d / 2 + Math.min(0.155, d * 0.5), g);
}

// Glowing lamp (original), as tall as the item
function lamp(w: number, h: number, g: THREE.Group, light: boolean, c?: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(w / 2 - 0.02, 0.01), w / 2, h, 24), mat(c ?? 0xfff1d0, { r: 0.6, e: c ?? 0xffd88a, ei: c !== undefined ? 0.35 : 0.85 }));
  m.position.y = h / 2; m.castShadow = true; g.add(m);
  if (light) { const pl = new THREE.PointLight(0xffd59a, 1.4, 3, 1); pl.position.y = h * 0.75; g.add(pl); }
}

// Squashed ball (original bean bag)
function beanbag(w: number, h: number, g: THREE.Group, c?: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 28, 18), mat(c ?? 0x6c7075, { r: 0.45 }));
  m.scale.y = h / w; m.position.y = h / 2; m.castShadow = true; g.add(m);
}

// Chair with seat at about 45% of its height and a back
function chair(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  const wood = mat(c ?? 0x7a5a3c, { r: 0.6 }), seatY = Math.min(0.46, h * 0.5);
  box(w, 0.04, d, wood, 0, seatY, 0, g);
  box(w, h - seatY, 0.03, wood, 0, seatY + (h - seatY) / 2, -d / 2 + 0.015, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.03, seatY, 0.03, wood, sx * (w / 2 - 0.02), seatY / 2, sz * (d / 2 - 0.02), g);
}

// Bed: frame, mattress, pillows, headboard at the back
function bed(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  const frameH = h * 0.45, head = Math.min(0.06, d * 0.05);
  box(w, frameH, d, mat(c ?? 0x8b6f52, { r: 0.7 }), 0, frameH / 2, 0, g);
  box(w - 0.04, h - frameH, d - head - 0.02, mat(0xf3efe7, { r: 0.9 }), 0, frameH + (h - frameH) / 2, head / 2, g);
  const pw = w > 1.2 ? (w - 0.12) / 2 : w - 0.08;
  for (const sx of w > 1.2 ? [-1, 1] : [0]) box(pw - 0.04, 0.1, 0.35, mat(0xffffff, { r: 0.9 }), sx * (pw / 2 + 0.02), h + 0.05, -d / 2 + head + 0.22, g);
  box(w, Math.max(h + 0.45, 0.9), head, mat(c !== undefined ? shade(c, 0.8) : 0x6e5640, { r: 0.7 }), 0, Math.max(h + 0.45, 0.9) / 2, -d / 2 + head / 2, g);
}

// Framed poster or picture
function poster(w: number, d: number, h: number, g: THREE.Group, c?: number) {
  box(w, h, d, mat(0x2b2724, { r: 0.6 }), 0, h / 2, 0, g);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w - 0.06, 0.01), Math.max(h - 0.06, 0.01)), mat(c ?? 0xc9a66b, { r: 0.8 }));
  art.position.set(0, h / 2, d / 2 + 0.001); g.add(art);
}

// Plain box, or a stand-style cabinet when named like a stand
function plainBox(item: Item, w: number, d: number, h: number, g: THREE.Group, c?: number) {
  if (/stand|media|tv/i.test(item.name)) stand(w, d, h, g, c);
  else box(w, h, d, mat(c ?? 0xb9ab95, { r: 0.75 }), 0, h / 2, 0, g);
}

// 3D model of a piece: footprint w × d, height h, front facing +z, sitting on y = 0
export function buildFurniture(item: Item, opts: { mounted?: boolean; lights?: boolean } = {}): THREE.Group {
  const g = new THREE.Group(), w = item.w / 100, d = item.d / 100, h = item.h / 100;
  const c = item.color ? parseInt(item.color.slice(1), 16) : undefined;
  switch (item.type) {
    case 'sofa': sofa(w, d, h, g, c); break;
    case 'tv': tv(w, d, h, g, !!opts.mounted, c); break;
    case 'table': table(w, d, h, g, c); break;
    case 'roundTable': roundTable(w, h, g, c); break;
    case 'nightstand': side(w, d, h, g, c); break;
    case 'treadmill': treadmill(w, d, h, g, c); break;
    case 'lamp': lamp(w, h, g, opts.lights !== false, c); break;
    case 'beanbag': beanbag(w, h, g, c); break;
    case 'chair': chair(w, d, h, g, c); break;
    case 'bed': bed(w, d, h, g, c); break;
    case 'poster': poster(w, d, h, g, c); break;
    case 'shelf': box(w, h, d, mat(c ?? 0x9a7b58, { r: 0.6 }), 0, h / 2, 0, g); break;
    case 'rug': box(w, Math.max(h, 0.005), d, mat(c ?? 0xa8584a, { r: 1 }), 0, Math.max(h, 0.005) / 2, 0, g); break;
    default: plainBox(item, w, d, h, g, c);
  }
  return g;
}
