import type { BuiltIn, Item, ItemType, Opening, Place, Pt, Room } from './types';
import { LEVELS } from './levels';
import { placeItem } from './placement';
import { canSitOn, childrenOf, effectiveElevation } from './stacking';
import { findOverlaps } from './overlap';
import { attachRoom, checkBuiltIn, checkOpening, createRoom, roomBox, roomOverlap } from './rooms';
import { rotateVec } from './geometry';
import { newItem } from './seed';
import { newId } from './types';

export type EditResult = { place: Place; error?: string };
const copy = (p: Place): Place => structuredClone(p);
const fail = (place: Place, error: string): EditResult => ({ place, error });
const find = (p: Place, id: string) => p.items.find(i => i.id === id);

// Drag a piece; pieces on top come along. On drop it may land on top of another piece
export function moveItem(place: Place, id: string, target: Pt, opts: { drop?: boolean } = {}): EditResult {
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  const r = placeItem(p, it, target);
  if (!r.ok) return fail(place, r.error);
  const dx = r.x - it.x, dz = r.z - it.z;
  const kids = childrenOf(p, id);
  Object.assign(it, { x: r.x, z: r.z, roomId: r.roomId, rot: r.rot });
  for (const k of kids) { k.x += dx; k.z += dz; k.roomId = r.roomId; }
  if (opts.drop) settle(p, it);
  return { place: p };
}

// Decides what a dropped piece sits on (the highest piece under its centre)
function settle(p: Place, it: Item) {
  if (it.type === 'rug' || (it.elevation > 0 && !it.sitsOn)) return;
  const under = p.items.filter(o => o.roomId === it.roomId && canSitOn(p, it, o))
    .sort((a, b) => effectiveElevation(p, b) + b.h - (effectiveElevation(p, a) + a.h));
  it.sitsOn = under.length ? under[0].id : null;
}

// Turn a piece (and whatever sits on it) by deg degrees
export function rotateItem(place: Place, id: string, deg: number): EditResult {
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  const rot = (((it.rot + deg) % 360) + 360) % 360;
  const r = placeItem(p, { ...it, rot }, { x: it.x, z: it.z });
  if (!r.ok) return fail(place, r.error);
  const ox = it.x, oz = it.z;
  Object.assign(it, { x: r.x, z: r.z, rot: r.rot, roomId: r.roomId });
  for (const k of childrenOf(p, id)) {
    const v = rotateVec({ x: k.x - ox, z: k.z - oz }, deg);
    k.x = r.x + v.x; k.z = r.z + v.z; k.rot = (((k.rot + deg) % 360) + 360) % 360;
  }
  return { place: p };
}

// Put a piece at one of the 5 height levels
export function setItemLevel(place: Place, id: string, n: 1 | 2 | 3 | 4 | 5): EditResult {
  return setItemHeight(place, id, LEVELS[n - 1].cm);
}

// Put a piece's bottom at an exact height off the floor (stops it sitting on anything)
export function setItemHeight(place: Place, id: string, cm: number): EditResult {
  if (!(cm >= 0) || cm > 5000) return fail(place, 'Enter a height of 0 or more');
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  it.elevation = cm; it.sitsOn = null;
  const r = placeItem(p, it, it);
  if (r.ok) Object.assign(it, { x: r.x, z: r.z, rot: r.rot });
  return { place: p };
}

// Change a piece's width, depth and height
export function resizeItem(place: Place, id: string, s: { w: number; d: number; h: number }): EditResult {
  if (![s.w, s.d, s.h].every(v => v > 0 && v <= 5000)) return fail(place, 'Sizes must be more than 0');
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  const r = placeItem(p, { ...it, ...s }, it);
  if (!r.ok) return fail(place, r.error);
  Object.assign(it, s, { x: r.x, z: r.z, rot: r.rot });
  return { place: p };
}

// Rename a piece
export function renameItem(place: Place, id: string, name: string): EditResult {
  if (!name.trim()) return fail(place, 'Enter a name');
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  it.name = name.trim();
  return { place: p };
}

// New piece in the middle of a room
export function addItem(place: Place, roomId: string, type: ItemType, name: string, w: number, d: number, h: number, elevation = 0): EditResult & { id?: string } {
  const room = place.rooms.find(r => r.id === roomId);
  if (!room) return fail(place, 'Add a room first');
  if (![w, d, h].every(v => v > 0 && v <= 5000)) return fail(place, 'Sizes must be more than 0');
  const b = roomBox(room);
  const it = { ...newItem(type, w, d, h, name.trim() || type, roomId), elevation };
  const c = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  Object.assign(it, c);
  const p = copy(place);
  const r = placeItem(p, it, c);
  if (!r.ok) return fail(place, r.error);
  Object.assign(it, { x: r.x, z: r.z, rot: r.rot, roomId: r.roomId });
  p.items.push(it);
  return { place: p, id: it.id };
}

// Take a piece out (it can be added back); what sat on it stays at its own height
export function removeItem(place: Place, id: string): EditResult {
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  it.removed = true; it.sitsOn = null;
  for (const k of p.items) if (k.sitsOn === id) k.sitsOn = null;
  return { place: p };
}

// Bring a removed piece back where it was
export function restoreItem(place: Place, id: string): EditResult {
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  it.removed = false;
  const r = placeItem(p, it, it);
  if (r.ok) Object.assign(it, { x: r.x, z: r.z, rot: r.rot, roomId: r.roomId });
  return { place: p };
}

// Delete a piece for good
export function deleteItem(place: Place, id: string): EditResult {
  const p = copy(place);
  p.items = p.items.filter(i => i.id !== id);
  for (const k of p.items) { if (k.sitsOn === id) k.sitsOn = null; k.allowOverlapWith = k.allowOverlapWith.filter(x => x !== id); }
  return { place: p };
}

// Accept the current overlaps of a piece (e.g. chairs under a table)
export function allowOverlap(place: Place, id: string): EditResult {
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  it.allowOverlapWith = [...new Set([...it.allowOverlapWith, ...(findOverlaps(place).get(id) ?? [])])];
  return { place: p };
}

// First room goes at the origin; later rooms attach to a wall of an existing room
export function addRoom(place: Place, spec: { name: string; w: number; d: number; ceiling: number; squareCm: number | null; attach?: { roomId: string; wall: number; offset: number } }): EditResult & { id?: string } {
  if (!spec.name.trim()) return fail(place, 'Enter a name');
  if (!(spec.w > 0 && spec.d > 0 && spec.ceiling > 0)) return fail(place, 'Sizes must be more than 0');
  let room: Room;
  if (!place.rooms.length || !spec.attach) {
    const origin = place.rooms.length ? { x: Math.max(...place.rooms.map(r => roomBox(r).x1)) + 100, z: 0 } : { x: 0, z: 0 };
    room = createRoom(spec.name.trim(), spec.w, spec.d, origin, spec.ceiling);
  } else {
    const a = attachRoom(place, { roomId: spec.attach.roomId, wall: spec.attach.wall }, spec.name.trim(), spec.w, spec.d, spec.attach.offset);
    if (!a.ok) return fail(place, a.error);
    room = { ...a.room, ceiling: spec.ceiling };
  }
  room.squareCm = spec.squareCm;
  const p = copy(place);
  p.rooms.push(room);
  return { place: p, id: room.id };
}

// Rename a room, change its ceiling, square size or size (it grows right and down from its corner)
export function updateRoom(place: Place, roomId: string, ch: { name?: string; ceiling?: number; squareCm?: number | null; w?: number; d?: number }): EditResult {
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (!room) return fail(place, 'Room not found');
  if (ch.name !== undefined) { if (!ch.name.trim()) return fail(place, 'Enter a name'); room.name = ch.name.trim(); }
  if (ch.ceiling !== undefined) { if (!(ch.ceiling > 0)) return fail(place, 'Ceiling must be more than 0'); room.ceiling = ch.ceiling; }
  if (ch.squareCm !== undefined) room.squareCm = ch.squareCm;
  if (ch.w !== undefined || ch.d !== undefined) {
    const b = roomBox(room), w = ch.w ?? b.x1 - b.x0, d = ch.d ?? b.z1 - b.z0;
    if (!(w > 0 && d > 0)) return fail(place, 'Sizes must be more than 0');
    const nb = { x0: b.x0, z0: b.z0, x1: b.x0 + w, z1: b.z0 + d };
    const hit = roomOverlap(p, nb, roomId);
    if (hit) return fail(place, 'Overlaps ' + hit);
    room.outline = createRoom(room.name, w, d, { x: b.x0, z: b.z0 }).outline;
    for (const o of room.openings) if (checkOpening(room, o, o.id)) return fail(place, 'A door or window would no longer fit');
    for (const bi of room.builtIns) if (checkBuiltIn(room, bi)) return fail(place, bi.name + ' would no longer fit');
    for (const it of p.items.filter(i => i.roomId === roomId && !i.removed)) {
      const r = placeItem(p, it, it);
      if (!r.ok) return fail(place, it.name + ': ' + r.error);
      Object.assign(it, { x: r.x, z: r.z, rot: r.rot });
    }
  }
  return { place: p };
}

// Delete a room and everything in it
export function deleteRoom(place: Place, roomId: string): EditResult {
  const p = copy(place);
  const gone = new Set(p.items.filter(i => i.roomId === roomId).map(i => i.id));
  p.rooms = p.rooms.filter(r => r.id !== roomId);
  p.items = p.items.filter(i => !gone.has(i.id));
  for (const k of p.items) if (k.sitsOn && gone.has(k.sitsOn)) k.sitsOn = null;
  return { place: p };
}

// Add or replace a door/window on a room's wall
export function saveOpening(place: Place, roomId: string, o: Omit<Opening, 'id'> & { id?: string }): EditResult {
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (!room) return fail(place, 'Room not found');
  const err = checkOpening(room, o, o.id);
  if (err) return fail(place, err);
  if (o.id) room.openings = room.openings.map(x => (x.id === o.id ? { ...o, id: o.id! } : x));
  else room.openings.push({ ...o, id: newId() });
  return { place: p };
}

// Remove a door/window
export function deleteOpening(place: Place, roomId: string, id: string): EditResult {
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (room) room.openings = room.openings.filter(o => o.id !== id);
  return { place: p };
}

// Add or replace a built-in; furniture is pushed out of it
export function saveBuiltIn(place: Place, roomId: string, b: Omit<BuiltIn, 'id'> & { id?: string }): EditResult {
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (!room) return fail(place, 'Room not found');
  const err = checkBuiltIn(room, b);
  if (err) return fail(place, err);
  if (b.id) room.builtIns = room.builtIns.map(x => (x.id === b.id ? { ...b, id: b.id! } : x));
  else room.builtIns.push({ ...b, id: newId() });
  for (const it of p.items.filter(i => i.roomId === roomId && !i.removed && !i.sitsOn)) {
    const r = placeItem(p, it, it);
    if (r.ok) Object.assign(it, { x: r.x, z: r.z });
  }
  return { place: p };
}

// Remove a built-in
export function deleteBuiltIn(place: Place, roomId: string, id: string): EditResult {
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (room) room.builtIns = room.builtIns.filter(b => b.id !== id);
  return { place: p };
}

// Change place-wide settings
export function updatePlace(place: Place, ch: Partial<Pick<Place, 'name' | 'squareCm' | 'gridOn' | 'snapOn'>>): EditResult {
  if (ch.name !== undefined && !ch.name.trim()) return fail(place, 'Enter a name');
  if (ch.squareCm !== undefined && !(ch.squareCm > 0)) return fail(place, 'Square size must be more than 0');
  return { place: { ...copy(place), ...ch } };
}
