import type { Pt } from './types';
import { aabb, pointInPoly, type Box } from './geometry';

// Room outlines are made of straight walls at right angles (a rectangle, an L, a T…), going the same way round as a rectangle's corners
const EPS = 1e-6;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

interface Grid { xs: number[]; zs: number[]; inside: boolean[][] }

// Splits a shape's bounding box into cells along every corner line and marks the cells inside
function gridOf(outlines: Pt[][]): Grid {
  const xs = [...new Set(outlines.flat().map(p => r6(p.x)))].sort((a, b) => a - b);
  const zs = [...new Set(outlines.flat().map(p => r6(p.z)))].sort((a, b) => a - b);
  const inside = xs.slice(1).map((_, i) => zs.slice(1).map((__, j) => {
    const c = { x: (xs[i] + xs[i + 1]) / 2, z: (zs[j] + zs[j + 1]) / 2 };
    return outlines.some(o => pointInPoly(c, o));
  }));
  return { xs, zs, inside };
}

// Every largest rectangle that fits inside the shape (any box inside the room fits in one of these)
export function rectsOf(outline: Pt[]): Box[] {
  if (outline.length === 4) return [aabb(outline)];
  const { xs, zs, inside } = gridOf([outline]);
  const nx = xs.length - 1, nz = zs.length - 1, out: [number, number, number, number][] = [];
  const full = (i0: number, i1: number, j0: number, j1: number) => {
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!inside[i][j]) return false;
    return true;
  };
  for (let i0 = 0; i0 < nx; i0++) for (let i1 = i0; i1 < nx; i1++) for (let j0 = 0; j0 < nz; j0++) for (let j1 = j0; j1 < nz; j1++) {
    if (!full(i0, i1, j0, j1)) continue;
    const grow = (i0 > 0 && full(i0 - 1, i1, j0, j1)) || (i1 < nx - 1 && full(i0, i1 + 1, j0, j1)) || (j0 > 0 && full(i0, i1, j0 - 1, j1)) || (j1 < nz - 1 && full(i0, i1, j0, j1 + 1));
    if (!grow) out.push([i0, i1, j0, j1]);
  }
  return out.map(([i0, i1, j0, j1]) => ({ x0: xs[i0], x1: xs[i1 + 1], z0: zs[j0], z1: zs[j1 + 1] }));
}

// Non-overlapping rectangles that together make up the shape
export function partsOf(outline: Pt[]): Box[] {
  if (outline.length === 4) return [aabb(outline)];
  const { xs, zs, inside } = gridOf([outline]);
  const rows: Box[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    let start = -1;
    for (let i = 0; i <= xs.length - 1; i++) {
      const on = i < xs.length - 1 && inside[i][j];
      if (on && start < 0) start = i;
      if (!on && start >= 0) { rows.push({ x0: xs[start], x1: xs[i], z0: zs[j], z1: zs[j + 1] }); start = -1; }
    }
  }
  // stack rows that line up exactly
  const out: Box[] = [];
  for (const b of rows) {
    const above = out.find(o => o.x0 === b.x0 && o.x1 === b.x1 && Math.abs(o.z1 - b.z0) < EPS);
    if (above) above.z1 = b.z1; else out.push({ ...b });
  }
  return out;
}

// The biggest rectangle in the room (where labels and new pieces go)
export function mainPart(outline: Pt[]): Box {
  return rectsOf(outline).sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
}

// Floor area in cm²
export function areaOf(outline: Pt[]): number {
  let s = 0;
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; s += a.x * b.z - b.x * a.z; }
  return s / 2;
}

const contains = (o: Box, b: Box) => b.x0 >= o.x0 - EPS && b.x1 <= o.x1 + EPS && b.z0 >= o.z0 - EPS && b.z1 <= o.z1 + EPS;

// Is a box fully on the room's floor?
export function boxInShape(b: Box, outline: Pt[]): boolean {
  return rectsOf(outline).some(r => contains(r, b));
}

// Nearest centre to target where a box of half-size hx × hz is fully on the floor (null if it can't fit anywhere)
export function clampInShape(outline: Pt[], hx: number, hz: number, target: Pt): Pt | null {
  let best: Pt | null = null, bestD = Infinity;
  for (const r of rectsOf(outline)) {
    if (hx * 2 > r.x1 - r.x0 + EPS || hz * 2 > r.z1 - r.z0 + EPS) continue;
    const p = { x: Math.min(Math.max(target.x, r.x0 + hx), r.x1 - hx), z: Math.min(Math.max(target.z, r.z0 + hz), r.z1 - hz) };
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    if (d < bestD - EPS) { best = p; bestD = d; }
  }
  return best;
}

// Drops repeated corners and corners in the middle of a straight wall
export function simplify(outline: Pt[]): Pt[] {
  let pts = outline.map(p => ({ x: r6(p.x), z: r6(p.z) }));
  for (let changed = true; changed && pts.length > 2;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const same = Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS;
      const straight = Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) < EPS;
      if (same || straight) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}

// Traces the edge of a set of cells into one outline (null if the cells make more than one piece or touch only at a corner)
function trace(g: Grid): Pt[] | null {
  const edges = new Map<string, Pt[]>();
  const key = (p: Pt) => p.x + ',' + p.z;
  const add = (a: Pt, b: Pt) => { const k = key(a); if (!edges.has(k)) edges.set(k, []); edges.get(k)!.push(b); };
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < g.xs.length - 1 && j < g.zs.length - 1 && g.inside[i][j];
  let count = 0;
  for (let i = 0; i < g.xs.length - 1; i++) for (let j = 0; j < g.zs.length - 1; j++) {
    if (!on(i, j)) continue;
    const x0 = g.xs[i], x1 = g.xs[i + 1], z0 = g.zs[j], z1 = g.zs[j + 1];
    if (!on(i, j - 1)) { add({ x: x0, z: z0 }, { x: x1, z: z0 }); count++; }
    if (!on(i + 1, j)) { add({ x: x1, z: z0 }, { x: x1, z: z1 }); count++; }
    if (!on(i, j + 1)) { add({ x: x1, z: z1 }, { x: x0, z: z1 }); count++; }
    if (!on(i - 1, j)) { add({ x: x0, z: z1 }, { x: x0, z: z0 }); count++; }
  }
  if (!count || [...edges.values()].some(v => v.length > 1)) return null;
  const start = edges.keys().next().value as string;
  const [sx, sz] = start.split(',').map(Number);
  const out: Pt[] = [{ x: sx, z: sz }];
  let cur = edges.get(start)![0];
  while (key(cur) !== start) {
    out.push(cur);
    const nx = edges.get(key(cur));
    if (!nx || out.length > count) return null;
    cur = nx[0];
  }
  if (out.length !== count) return null;
  return simplify(out);
}

// The room's outline with a rectangle added on (null if they don't join into one shape, or only meet at a corner)
export function addRect(outline: Pt[], b: Box): Pt[] | null {
  const res = trace(gridOf([outline, [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }]]));
  return res && validShape(res) ? res : null;
}

// Do any two walls cross or touch (other than neighbours meeting at their shared corner)?
function selfTouches(o: Pt[]): boolean {
  const n = o.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = o[i], b = o[(i + 1) % n], c = o[j], d = o[(j + 1) % n];
    const ax0 = Math.min(a.x, b.x), ax1 = Math.max(a.x, b.x), az0 = Math.min(a.z, b.z), az1 = Math.max(a.z, b.z);
    const cx0 = Math.min(c.x, d.x), cx1 = Math.max(c.x, d.x), cz0 = Math.min(c.z, d.z), cz1 = Math.max(c.z, d.z);
    if (ax0 <= cx1 + EPS && cx0 <= ax1 + EPS && az0 <= cz1 + EPS && cz0 <= az1 + EPS) return true;
  }
  return false;
}

// Is this a usable room outline: right-angled walls, at least 4 of them, the right way round, not crossing itself?
export function validShape(o: Pt[]): boolean {
  if (o.length < 4 || o.length % 2) return false;
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.z - b.z) > EPS) return false;
  }
  return areaOf(o) > EPS && !selfTouches(o);
}

// Slides wall i straight out (positive) or in (negative); the walls either side stretch to follow
export function moveWall(outline: Pt[], i: number, delta: number): Pt[] | null {
  const n = outline.length, a = outline[i], b = outline[(i + 1) % n];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const nx = (b.z - a.z) / len, nz = -(b.x - a.x) / len;
  const o = outline.map((p, k) => (k === i || k === (i + 1) % n ? { x: r6(p.x + nx * delta), z: r6(p.z + nz * delta) } : { ...p }));
  // the neighbouring walls must not turn back on themselves
  for (const [p, q] of [[(i + n - 1) % n, i], [(i + 1) % n, (i + 2) % n]]) {
    const d0 = { x: outline[q].x - outline[p].x, z: outline[q].z - outline[p].z }, d1 = { x: o[q].x - o[p].x, z: o[q].z - o[p].z };
    if (d0.x * d1.x + d0.z * d1.z < -EPS) return null;
  }
  const s = simplify(o);
  return validShape(s) ? s : null;
}

// Screen names for walls (the plan is seen from the window side, so +x is screen left and +z is screen up)
const SIDE: Record<string, [string, string, string]> = {
  // outward direction → [name, end measured from, how to tell several apart]
  '0,-1': ['Bottom wall', 'right end', 'x'],
  '1,0': ['Left wall', 'bottom end', 'z'],
  '0,1': ['Top wall', 'left end', 'x'],
  '-1,0': ['Right wall', 'top end', 'z'],
};
const sideKey = (o: Pt[], i: number) => {
  const a = o[i], b = o[(i + 1) % o.length], len = Math.hypot(b.x - a.x, b.z - a.z);
  return `${Math.round((b.z - a.z) / len)},${Math.round(-(b.x - a.x) / len)}`;
};

// "Top wall", or "Top wall (left part)" when the room has more than one top wall
export function wallName(o: Pt[], i: number): string {
  const k = sideKey(o, i), s = SIDE[k];
  if (!s) return 'Wall ' + (i + 1);
  const same = o.map((_, j) => j).filter(j => sideKey(o, j) === k);
  if (same.length < 2) return s[0];
  const mid = (j: number) => (s[2] === 'x' ? -(o[j].x + o[(j + 1) % o.length].x) : -(o[j].z + o[(j + 1) % o.length].z));
  same.sort((p, q) => mid(p) - mid(q));
  const pos = same.indexOf(i);
  const words = s[2] === 'x' ? ['left', 'middle', 'right'] : ['upper', 'middle', 'lower'];
  const word = same.length === 2 ? words[pos === 0 ? 0 : 2] : same.length === 3 ? words[pos] : String(pos + 1);
  return `${s[0]} (${word} part)`;
}

// Which end of wall i offsets are measured from, as seen on screen
export function wallStart(o: Pt[], i: number): string {
  return SIDE[sideKey(o, i)]?.[1] ?? 'start';
}

// Is wall i a top/bottom wall (runs left–right on screen)?
export const wallIsLevel = (o: Pt[], i: number) => Math.abs(o[i].z - o[(i + 1) % o.length].z) < EPS;
