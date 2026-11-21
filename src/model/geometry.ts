import type { Pt } from './types';

export type Box = { x0: number; z0: number; x1: number; z1: number };
const EPS = 1e-6;

// Corners of a w × d rectangle centred at c, turned by rotDeg (same turn direction as three.js rotation.y)
export function footprint(c: Pt, w: number, d: number, rotDeg: number): Pt[] {
  const t = (rotDeg * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => ({
    x: c.x + lx * cs + lz * sn,
    z: c.z - lx * sn + lz * cs,
  }));
}

// Turns a local offset by rotDeg the same way footprint does
export function rotateVec(v: Pt, rotDeg: number): Pt {
  const t = (rotDeg * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  return { x: v.x * cs + v.z * sn, z: -v.x * sn + v.z * cs };
}

// Smallest axis-aligned box around some points (snapped to remove float noise)
export function aabb(pts: Pt[]): Box {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    x0: r(Math.min(...pts.map(p => p.x))), z0: r(Math.min(...pts.map(p => p.z))),
    x1: r(Math.max(...pts.map(p => p.x))), z1: r(Math.max(...pts.map(p => p.z))),
  };
}

export const boxToPoly = (b: Box): Pt[] => [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }];
export const boxesOverlap = (a: Box, b: Box) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;

// Do two convex shapes overlap? Edges only touching does not count
export function polysIntersect(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q.z - p.z, nz = p.x - q.x;
      const len = Math.hypot(nx, nz) || 1;
      const proj = (s: Pt[]) => s.map(v => (v.x * nx + v.z * nz) / len);
      const pa = proj(a), pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) + EPS || Math.max(...pb) <= Math.min(...pa) + EPS) return false;
    }
  }
  return true;
}

// Does a circle overlap a convex shape?
export function circleIntersectsPoly(c: Pt, r: number, p: Pt[]): boolean {
  if (pointInPoly(c, p)) return true;
  for (let i = 0; i < p.length; i++) if (distToSegment(c, p[i], p[(i + 1) % p.length]) < r - EPS) return true;
  return false;
}

// Is a point inside a shape?
export function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > pt.z) !== (b.z > pt.z) && pt.x < ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Shortest distance from a point to a line segment
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

// Shortest distance between two segments
export function segToSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b));
}
