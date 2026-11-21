import type { Item, Place, Pt, Room } from './types';
import { squareOf } from './types';
import { aabb, boxesOverlap, footprint, segToSegDist, type Box } from './geometry';
import { connectingDoors, roomAt, roomBox, wallOf } from './rooms';

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
  const rb = roomBox(room);
  if (hx * 2 > rb.x1 - rb.x0 + 1e-6 || hz * 2 > rb.z1 - rb.z0 + 1e-6) return { ok: false, error: 'Too big for ' + room.name };
  const clamp = () => {
    x = Math.min(Math.max(x, rb.x0 + hx), rb.x1 - hx);
    z = Math.min(Math.max(z, rb.z0 + hz), rb.z1 - hz);
  };
  clamp();
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
      ].filter(p => p.x - hx >= rb.x0 - 1e-6 && p.x + hx <= rb.x1 + 1e-6 && p.z - hz >= rb.z0 - 1e-6 && p.z + hz <= rb.z1 + 1e-6);
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
  const rb = roomBox(room);
  const gaps = [p.z - rb.z0, rb.x1 - p.x, rb.z1 - p.z, p.x - rb.x0];
  const wi = gaps.indexOf(Math.min(...gaps));
  const n = wallOf(room, wi).normalOut;
  const rot = ((Math.round((Math.atan2(-n.x, -n.z) * 180) / Math.PI) % 360) + 360) % 360;
  const half = item.d / 2;
  if (wi === 0) return { x: p.x, z: rb.z0 + half, rot };
  if (wi === 1) return { x: rb.x1 - half, z: p.z, rot };
  if (wi === 2) return { x: p.x, z: rb.z1 - half, rot };
  return { x: rb.x0 + half, z: p.z, rot };
}

// Rounds a point to half squares (grid on) or 5 cm steps, measured from the room's corner
export function snapPoint(p: Pt, place: Place, room: Room): Pt {
  if (!place.snapOn) return p;
  const step = place.gridOn ? squareOf(place, room) / 2 : 5;
  const o = room.outline[0];
  return { x: o.x + Math.round((p.x - o.x) / step) * step, z: o.z + Math.round((p.z - o.z) / step) * step };
}

// Gap from each side of a piece to the wall on that side
export function distancesToWalls(place: Place, item: Item): { wall: number; cm: number }[] {
  const room = place.rooms.find(r => r.id === item.roomId);
  if (!room) return [];
  const rb = roomBox(room);
  const { hx, hz } = halfExtents(item);
  return [
    { wall: 0, cm: clean(item.z - hz - rb.z0) },
    { wall: 1, cm: clean(rb.x1 - (item.x + hx)) },
    { wall: 2, cm: clean(rb.z1 - (item.z + hz)) },
    { wall: 3, cm: clean(item.x - hx - rb.x0) },
  ];
}
