import type { BuiltIn, Opening, Place, Pt, Room } from './types';
import { newId } from './types';
import { aabb, boxesOverlap, footprint, pointInPoly, type Box } from './geometry';

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

// A rectangular room with its top-left corner at origin
export function createRoom(name: string, w: number, d: number, origin: Pt, ceiling = 240): Room {
  const { x, z } = origin;
  return { id: newId(), name, outline: [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }], ceiling, squareCm: null, openings: [], builtIns: [] };
}

// Wall i of a room: start, end, length and the direction pointing out of the room
export function wallOf(room: Room, i: number): { a: Pt; b: Pt; length: number; dir: Pt; normalOut: Pt } {
  const n = room.outline.length;
  const a = room.outline[i % n], b = room.outline[(i + 1) % n];
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const dir = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  return { a, b, length, dir, normalOut: { x: dir.z, z: -dir.x } };
}

// The floor box of a room
export const roomBox = (room: Room): Box => aabb(room.outline);

// Names for the four walls as seen on screen (the plan is viewed from the window side, like the original planner)
export const WALL_NAMES = ['Bottom wall', 'Left wall', 'Top wall', 'Right wall'];
// Which end of each wall offsets are measured from, as seen on screen
export const WALL_START = ['right end', 'bottom end', 'left end', 'top end'];

// Rectangle outline in the standard corner order
function rectOutline(b: Box): Pt[] {
  return [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }];
}

// Checks a room outline doesn't overlap other rooms (allowing for wall thickness)
export function roomOverlap(place: Place, box: Box, ignoreId?: string): string | null {
  const t = place.wallThickness;
  for (const r of place.rooms) {
    if (r.id === ignoreId) continue;
    const b = roomBox(r);
    if (boxesOverlap(box, { x0: b.x0 - t, z0: b.z0 - t, x1: b.x1 + t, z1: b.z1 + t })) return r.name;
  }
  return null;
}

// Makes a new room on the outside of another room's wall, its corner offset cm along that wall
export function attachRoom(place: Place, target: { roomId: string; wall: number }, name: string, w: number, d: number, offset: number): Result<{ room: Room }> {
  const tr = place.rooms.find(r => r.id === target.roomId);
  if (!tr) return { ok: false, error: 'Pick a room to attach to' };
  const { a, dir, normalOut: n } = wallOf(tr, target.wall);
  const t = place.wallThickness;
  const p0 = { x: a.x + dir.x * offset + n.x * t, z: a.z + dir.z * offset + n.z * t };
  const p1 = { x: p0.x + dir.x * w, z: p0.z + dir.z * w };
  const p2 = { x: p1.x + n.x * d, z: p1.z + n.z * d };
  const box = aabb([p0, p1, p2, { x: p0.x + n.x * d, z: p0.z + n.z * d }]);
  const hit = roomOverlap(place, box);
  if (hit) return { ok: false, error: 'Overlaps ' + hit };
  const room = createRoom(name, box.x1 - box.x0, box.z1 - box.z0, { x: box.x0, z: box.z0 });
  room.outline = rectOutline(box);
  return { ok: true, room };
}

// Checks a door or window fits on its wall without hitting another one
export function checkOpening(room: Room, o: Omit<Opening, 'id'>, ignoreId?: string): string | null {
  if (o.wall < 0 || o.wall >= room.outline.length) return 'Pick a wall';
  const { length } = wallOf(room, o.wall);
  if (o.offset < 0 || o.width <= 0 || o.offset + o.width > length + 1e-6) return "Doesn't fit on this wall";
  if (o.kind === 'window' && o.top > room.ceiling) return 'Window top is above the ceiling';
  if (o.kind === 'window' && o.sill >= o.top) return 'Sill must be below the top';
  for (const p of room.openings) {
    if (p.id === ignoreId || p.wall !== o.wall) continue;
    if (o.offset < p.offset + p.width - 1e-6 && p.offset < o.offset + o.width - 1e-6) return 'Overlaps another door or window';
  }
  return null;
}

// Adds a door or window to a room's wall (mutates the room passed in)
export function addOpening(room: Room, o: Omit<Opening, 'id'>): Result<{ opening: Opening }> {
  const err = checkOpening(room, o);
  if (err) return { ok: false, error: err };
  const opening = { ...o, id: newId() };
  room.openings.push(opening);
  return { ok: true, opening };
}

// Checks a built-in lies fully inside its room
export function checkBuiltIn(room: Room, b: Omit<BuiltIn, 'id'>): string | null {
  if (b.h > room.ceiling) return 'Taller than the ceiling';
  const fp = footprint({ x: b.x, z: b.z }, b.w, b.d, b.rot);
  const rb = roomBox(room);
  for (const p of fp) if (p.x < rb.x0 - 1e-6 || p.x > rb.x1 + 1e-6 || p.z < rb.z0 - 1e-6 || p.z > rb.z1 + 1e-6) return 'Must be inside the room';
  return null;
}

// Adds a built-in box (like a closet) to a room (mutates the room passed in)
export function addBuiltIn(room: Room, b: Omit<BuiltIn, 'id'>): Result<{ builtIn: BuiltIn }> {
  const err = checkBuiltIn(room, b);
  if (err) return { ok: false, error: err };
  const builtIn = { ...b, id: newId() };
  room.builtIns.push(builtIn);
  return { ok: true, builtIn };
}

export interface WallSeg { a: Pt; b: Pt; thickness: number; side: Pt; holes: { from: number; to: number; sill: number; top: number; kind: 'door' | 'window' }[]; height: number; rooms: string[] }

interface Shared { tFrom: number; tTo: number; other: Room; otherWall: number }

// Finds the parts of a room's wall that face another room across one wall thickness
function sharedSpans(place: Place, room: Room, wi: number): Shared[] {
  const w = wallOf(room, wi);
  const out: Shared[] = [];
  for (const other of place.rooms) {
    if (other.id === room.id) continue;
    for (let j = 0; j < other.outline.length; j++) {
      const v = wallOf(other, j);
      if (Math.abs(w.normalOut.x + v.normalOut.x) > 1e-6 || Math.abs(w.normalOut.z + v.normalOut.z) > 1e-6) continue;
      const dist = (v.a.x - w.a.x) * w.normalOut.x + (v.a.z - w.a.z) * w.normalOut.z;
      if (Math.abs(dist - place.wallThickness) > 0.5) continue;
      const ta = (v.a.x - w.a.x) * w.dir.x + (v.a.z - w.a.z) * w.dir.z;
      const tb = (v.b.x - w.a.x) * w.dir.x + (v.b.z - w.a.z) * w.dir.z;
      const from = Math.max(0, Math.min(ta, tb)), to = Math.min(w.length, Math.max(ta, tb));
      if (to - from > 1e-6) out.push({ tFrom: from, tTo: to, other, otherWall: j });
    }
  }
  return out.sort((x, y) => x.tFrom - y.tFrom);
}

// Openings of a room's wall turned into positions along this wall
function holesFor(room: Room, wi: number) {
  return room.openings.filter(o => o.wall === wi).map(o => ({ from: o.offset, to: o.offset + o.width, sill: o.kind === 'door' ? 0 : o.sill, top: o.top, kind: o.kind }));
}

// Every wall piece to draw, with door and window holes; shared walls come out once
export function buildWalls(place: Place): WallSeg[] {
  const T = place.wallThickness, segs: WallSeg[] = [];
  place.rooms.forEach((room, ri) => {
    for (let wi = 0; wi < room.outline.length; wi++) {
      const w = wallOf(room, wi);
      const shared = sharedSpans(place, room, wi);
      const own = holesFor(room, wi);
      // cut the wall into own pieces and shared pieces
      const cuts: { from: number; to: number; sh?: Shared }[] = [];
      let cur = -T / 2;
      for (const s of shared) {
        if (s.tFrom > cur) cuts.push({ from: cur, to: s.tFrom });
        cuts.push({ from: s.tFrom, to: s.tTo, sh: s });
        cur = s.tTo;
      }
      if (cur < w.length + T / 2) cuts.push({ from: cur, to: w.length + T / 2 });
      for (const c of cuts) {
        let from = c.from, to = c.to;
        if (c.sh) {
          const oi = place.rooms.indexOf(c.sh.other);
          if (oi < ri) continue; // the earlier room already drew it
          if (Math.abs(from) < 1e-6) from = -T / 2;
          if (Math.abs(to - w.length) < 1e-6) to = w.length + T / 2;
        }
        if (to - from < 1e-6) continue;
        const holes = own.filter(h => h.from >= from - 1e-6 && h.to <= to + 1e-6);
        if (c.sh) {
          const ow = wallOf(c.sh.other, c.sh.otherWall);
          for (const h of holesFor(c.sh.other, c.sh.otherWall)) {
            const pa = { x: ow.a.x + ow.dir.x * h.from, z: ow.a.z + ow.dir.z * h.from };
            const pb = { x: ow.a.x + ow.dir.x * h.to, z: ow.a.z + ow.dir.z * h.to };
            const ta = (pa.x - w.a.x) * w.dir.x + (pa.z - w.a.z) * w.dir.z, tb = (pb.x - w.a.x) * w.dir.x + (pb.z - w.a.z) * w.dir.z;
            const f = Math.min(ta, tb), t2 = Math.max(ta, tb);
            if (f >= from - 1e-6 && t2 <= to + 1e-6 && !holes.some(x => Math.abs(x.from - f) < 1 && Math.abs(x.to - t2) < 1)) holes.push({ ...h, from: f, to: t2 });
          }
        }
        const off = { x: w.normalOut.x * T / 2, z: w.normalOut.z * T / 2 };
        const at = (t: number) => ({ x: round(w.a.x + w.dir.x * t + off.x), z: round(w.a.z + w.dir.z * t + off.z) });
        segs.push({
          a: at(from), b: at(to), thickness: T, side: w.normalOut,
          holes: holes.map(h => ({ ...h, from: h.from - from, to: h.to - from })).sort((x, y) => x.from - y.from),
          height: c.sh ? Math.max(room.ceiling, c.sh.other.ceiling) : room.ceiling,
          rooms: c.sh ? [room.id, c.sh.other.id] : [room.id],
        });
      }
    }
  });
  return segs;
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;

// Door gaps (on the wall's centre line) that join two rooms
export function connectingDoors(place: Place, roomA: string, roomB: string): { a: Pt; b: Pt }[] {
  const out: { a: Pt; b: Pt }[] = [];
  for (const s of buildWalls(place)) {
    if (!(s.rooms.includes(roomA) && s.rooms.includes(roomB) && s.rooms.length === 2)) continue;
    const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
    const dir = { x: (s.b.x - s.a.x) / len, z: (s.b.z - s.a.z) / len };
    for (const h of s.holes) if (h.kind === 'door') out.push({ a: { x: s.a.x + dir.x * h.from, z: s.a.z + dir.z * h.from }, b: { x: s.a.x + dir.x * h.to, z: s.a.z + dir.z * h.to } });
  }
  return out;
}

// Which room contains a point (if any)
export function roomAt(place: Place, p: Pt): Room | undefined {
  return place.rooms.find(r => pointInPoly(p, r.outline));
}
