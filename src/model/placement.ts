import type { Item, Place, Pt, Room } from './types';
import { squareOf } from './types';
import { aabb, boxesOverlap, distToSegment, footprint, segToSegDist, type Box } from './geometry';
import { connectingDoors, roomAt, roomBox, wallOf } from './rooms';
import { boxInShape, clampInShape } from './shape';

// Posters, shelves and wall-mounted TVs hang on a wall
export const isWallItem = (item: Item): boolean =>
  item.type === 'poster' || item.type === 'shelf' || (item.type === 'tv' && item.elevation > 0 && item.sitsOn === null);

// Half-size of the box around a turned piece
export function halfExtents(item: { w: number; d: number; rot: number }): { hx: number; hz: number } {
  const b = aabb(footprint({ x: 0, z: 0 }, item.w, item.d, item.rot));
  return { hx: b.x1, hz: b.z1 };
}

export type PlaceResult = { ok: true; x: number; z: number; roomId: string; rot: number } | { ok: false; error: string };

// Where a piece ends up when dragged towards target: kept in its room, out of built-ins, rooms changed only through doors
export function placeItem(place: Place, item: Item, target: Pt): PlaceResult {
  let room = place.rooms.find(r => r.id === item.roomId) ?? roomAt(place, target) ?? place.rooms[0];
  if (!room) return { ok: false, error: 'Add a room first' };
  const other = roomAt(place, target);
  if (other && other.id !== room.id) {
    const from = { x: item.x, z: item.z };
    if (connectingDoors(place, room.id, other.id).some(d => segToSegDist(from, target, d.a, d.b) <= 5)) room = other;
  }
  let rot = item.rot;
  let { x, z } = target;
  if (isWallItem(item)) ({ x, z, rot } = snapToWall(room, item, target));
  const { hx, hz } = halfExtents({ ...item, rot });
  const fits = (p: Pt) => boxInShape({ x0: p.x - hx, z0: p.z - hz, x1: p.x + hx, z1: p.z + hz }, room!.outline);
  const c = clampInShape(room.outline, hx, hz, { x, z });
  if (!c) return { ok: false, error: 'Too big for ' + room.name };
  ({ x, z } = c);
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const b of room.builtIns) {
      if (item.elevation >= b.h) continue;
      const bb = aabb(footprint(b, b.w, b.d, b.rot));
      const ib: Box = { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz };
      if (!boxesOverlap(ib, bb)) continue;
      // try the four ways out and keep the shortest one that stays in the room
      const opts = [
        { x: bb.x0 - hx, z }, { x: bb.x1 + hx, z }, { x, z: bb.z0 - hz }, { x, z: bb.z1 + hz },
      ].filter(fits);
      if (!opts.length) return { ok: false, error: "Doesn't fit next to the " + b.name.toLowerCase() };
      opts.sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
      ({ x, z } = opts[0]);
      moved = true;
    }
    if (!moved) break;
  }
  return { ok: true, x: clean(x), z: clean(z), roomId: room.id, rot };
}
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

// Turns a wall piece to face into the room and pushes its back flat against the nearest wall
function snapToWall(room: Room, item: Item, p: Pt): { x: number; z: number; rot: number } {
  let wi = 0, best = Infinity;
  for (let i = 0; i < room.outline.length; i++) {
    const w = wallOf(room, i), d = distToSegment(p, w.a, w.b);
    if (d < best) { best = d; wi = i; }
  }
  const w = wallOf(room, wi), n = w.normalOut;
  const rot = ((Math.round((Math.atan2(-n.x, -n.z) * 180) / Math.PI) % 360) + 360) % 360;
  let t = (p.x - w.a.x) * w.dir.x + (p.z - w.a.z) * w.dir.z;
  if (item.w <= w.length) t = Math.min(Math.max(t, item.w / 2), w.length - item.w / 2);
  const half = item.d / 2;
  return { x: w.a.x + w.dir.x * t - n.x * half, z: w.a.z + w.dir.z * t - n.z * half, rot };
}

// Rounds a point to half squares (grid on) or 5 cm steps, measured from the room's corner
export function snapPoint(p: Pt, place: Place, room: Room): Pt {
  if (!place.snapOn) return p;
  const step = place.gridOn ? squareOf(place, room) / 2 : 5;
  const b = roomBox(room), o = { x: b.x0, z: b.z0 };
  return { x: o.x + Math.round((p.x - o.x) / step) * step, z: o.z + Math.round((p.z - o.z) / step) * step };
}

const DIRS: Pt[] = [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }];

// Gap from each side of a piece to the wall straight out from that side (from/to are the ends of the measuring line)
export function distancesToWalls(place: Place, item: Item): { wall: number; cm: number; from: Pt; to: Pt }[] {
  const room = place.rooms.find(r => r.id === item.roomId);
  if (!room) return [];
  const { hx, hz } = halfExtents(item), out: { wall: number; cm: number; from: Pt; to: Pt }[] = [];
  DIRS.forEach((d, k) => {
    const from = { x: item.x + d.x * hx, z: item.z + d.z * hz };
    let best: { cm: number; to: Pt } | null = null;
    for (let i = 0; i < room.outline.length; i++) {
      const w = wallOf(room, i);
      if (Math.abs(w.normalOut.x - d.x) > 1e-6 || Math.abs(w.normalOut.z - d.z) > 1e-6) continue;
      const along = d.x ? item.z : item.x, lo = d.x ? Math.min(w.a.z, w.b.z) : Math.min(w.a.x, w.b.x), hi = d.x ? Math.max(w.a.z, w.b.z) : Math.max(w.a.x, w.b.x);
      if (along < lo - 1e-6 || along > hi + 1e-6) continue;
      const cm = clean(d.x ? (w.a.x - from.x) * d.x : (w.a.z - from.z) * d.z);
      if (cm < -1e-6) continue;
      if (!best || cm < best.cm) best = { cm, to: d.x ? { x: w.a.x, z: item.z } : { x: item.x, z: w.a.z } };
    }
    if (best) out.push({ wall: k, cm: best.cm, from, to: best.to });
  });
  return out;
}
