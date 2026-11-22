import type { BuiltIn, Item, ItemType, Opening, Place, Pt, Room } from './types';
import { LEVELS } from './levels';
import { placeItem } from './placement';
import { canSitOn, childrenOf, effectiveElevation } from './stacking';
import { findOverlaps } from './overlap';
import { attachRoom, checkBuiltIn, checkOpening, createRoom, remapOpenings, roomBox, roomOverlap, wallOf } from './rooms';
import { addRect, mainPart, moveWall, partsOf, validShape } from './shape';
import { aabb } from './geometry';
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
  const b = mainPart(room.outline);
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
  tidyGroups(p);
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
  tidyGroups(p);
  return { place: p };
}

// Give a piece its own colour (#rrggbb), or null for its normal look
export function setItemColor(place: Place, id: string, color: string | null): EditResult {
  if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) return fail(place, 'Pick a colour');
  const p = copy(place), it = find(p, id);
  if (!it) return fail(place, 'Piece not found');
  it.color = color;
  return { place: p };
}

// The pieces that move together with a piece (just itself when it's not in a group)
export function groupOf(place: Place, id: string): Item[] {
  const it = find(place, id);
  if (!it || it.removed) return [];
  return it.group ? place.items.filter(i => i.group === it.group && !i.removed) : [it];
}

// Put pieces of one room into a group so they move and turn together
export function groupItems(place: Place, ids: string[]): EditResult {
  const p = copy(place), its = ids.map(id => find(p, id)).filter((i): i is Item => !!i && !i.removed);
  if (its.length < 2) return fail(place, 'Pick at least two pieces');
  if (new Set(its.map(i => i.roomId)).size > 1) return fail(place, 'Pieces in a group must be in the same room');
  const g = newId();
  for (const i of its) i.group = g;
  tidyGroups(p);
  return { place: p };
}

// Split a group back into single pieces
export function ungroup(place: Place, id: string): EditResult {
  const p = copy(place), it = find(p, id);
  if (!it?.group) return { place };
  const g = it.group;
  for (const i of p.items) if (i.group === g) i.group = null;
  return { place: p };
}

// Groups left with one piece stop being groups
function tidyGroups(p: Place) {
  const n = new Map<string, number>();
  for (const i of p.items) if (i.group && !i.removed) n.set(i.group, (n.get(i.group) ?? 0) + 1);
  for (const i of p.items) if (i.group && (n.get(i.group) ?? 0) < 2) i.group = null;
}

// Moves or turns a whole group, rejecting the change if any piece would have to shift on its own
function placeGroup(place: Place, ids: string[], to: (it: Item) => { x: number; z: number; rot: number }): EditResult {
  const p = copy(place), set = new Set(ids);
  const members = p.items.filter(i => set.has(i.id));
  const tops = members.filter(i => !i.sitsOn || !set.has(i.sitsOn));
  const extra = p.items.filter(i => !set.has(i.id) && i.sitsOn && set.has(i.sitsOn)); // things sitting on group pieces come along
  for (const it of [...members, ...extra]) Object.assign(it, to(it));
  for (const it of tops) {
    if (it.sitsOn && !set.has(it.sitsOn)) it.sitsOn = null;
    const r = placeItem(p, it, it);
    if (!r.ok) return fail(place, r.error);
    if (Math.abs(r.x - it.x) > 0.01 || Math.abs(r.z - it.z) > 0.01 || r.roomId !== it.roomId) return fail(place, it.name + ' would hit a wall');
  }
  return { place: p };
}

// Move a group by dx, dz
export function moveGroup(place: Place, ids: string[], dx: number, dz: number): EditResult {
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return placeGroup(place, ids, it => ({ x: r6(it.x + dx), z: r6(it.z + dz), rot: it.rot }));
}

// Turn a group by deg degrees around its middle
export function rotateGroup(place: Place, ids: string[], deg: number): EditResult {
  const its = place.items.filter(i => ids.includes(i.id));
  if (!its.length) return fail(place, 'Piece not found');
  const cx = (Math.min(...its.map(i => i.x)) + Math.max(...its.map(i => i.x))) / 2, cz = (Math.min(...its.map(i => i.z)) + Math.max(...its.map(i => i.z))) / 2;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const r = placeGroup(place, ids, it => {
    const v = rotateVec({ x: it.x - cx, z: it.z - cz }, deg);
    return { x: r6(cx + v.x), z: r6(cz + v.z), rot: (((it.rot + deg) % 360) + 360) % 360 };
  });
  return r.error ? fail(place, 'Not enough room to turn the group') : r;
}

// Copy a piece (with its group and whatever sits on it) a little to the side; returns the copy of the piece itself
export function cloneItem(place: Place, id: string): EditResult & { id?: string } {
  const src = groupOf(place, id);
  if (!src.length) return fail(place, 'Piece not found');
  const set = new Set(src.map(i => i.id));
  for (let grew = true; grew;) { grew = false; for (const i of place.items) if (!i.removed && i.sitsOn && set.has(i.sitsOn) && !set.has(i.id)) { set.add(i.id); grew = true; } }
  const ids = new Map([...set].map(k => [k, newId()]));
  const g = src.length > 1 ? newId() : null;
  const copies: Item[] = place.items.filter(i => set.has(i.id)).map(i => ({
    ...structuredClone(i), id: ids.get(i.id)!, name: i.name, group: i.group && g ? g : null,
    sitsOn: i.sitsOn && ids.has(i.sitsOn) ? ids.get(i.sitsOn)! : i.sitsOn, allowOverlapWith: i.allowOverlapWith.map(x => ids.get(x) ?? x),
  }));
  const base = { ...place, items: [...place.items, ...copies] };
  // try nearby spots until the whole copy fits in the room
  // try nearby spots: the first one clear of other pieces, else the first that fits in the room
  let fallback: Place | null = null;
  const cids = copies.map(c => c.id);
  for (const step of [40, 80, 120, 160]) for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r = moveGroup(base, cids, dx * step, dz * step);
    if (r.error) continue;
    const ov = findOverlaps(r.place);
    if (!cids.some(c => ov.has(c))) return { place: r.place, id: ids.get(id) };
    fallback ??= r.place;
  }
  return fallback ? { place: fallback, id: ids.get(id) } : fail(place, 'No free space next to it for a copy');
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
    if (room.outline.length !== 4) return fail(place, 'This room has more than 4 walls: drag its walls in the plan to resize it');
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

// Gives a room a new outline if doors, windows, built-ins and furniture still fit (mutates p)
function reshape(p: Place, room: Room, outline: Pt[], moved?: { wall: number; dx: number; dz: number }): string | null {
  if (!validShape(outline)) return 'Walls would cross';
  const hit = roomOverlap(p, partsOf(outline), room.id);
  if (hit) return 'Too close to ' + hit;
  const openings = remapOpenings(room, outline, moved);
  if (!openings) return 'A door or window is in the way';
  room.outline = outline; room.openings = openings;
  for (const bi of room.builtIns) if (checkBuiltIn(room, bi)) return bi.name + ' would no longer fit';
  for (const it of p.items.filter(i => i.roomId === room.id && !i.removed)) {
    const r = placeItem(p, it, it);
    if (!r.ok) return it.name + ' would no longer fit';
    Object.assign(it, { x: r.x, z: r.z, rot: r.rot });
  }
  return null;
}

// Slide one wall of a room in or out by delta cm (positive = outwards)
export function moveRoomWall(place: Place, roomId: string, wall: number, delta: number): EditResult {
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (!room) return fail(place, 'Room not found');
  const n = wallOf(room, wall).normalOut;
  const o = moveWall(room.outline, wall, delta);
  if (!o) return fail(place, 'The room would get too small');
  const err = reshape(p, room, o, { wall, dx: n.x * delta, dz: n.z * delta });
  return err ? fail(place, err) : { place: p };
}

// Add a rectangle onto the outside of a room's wall, making one bigger room (an L, a T…)
export function addRoomPart(place: Place, roomId: string, s: { wall: number; offset: number; along: number; out: number }): EditResult {
  if (!(s.along > 0 && s.out > 0)) return fail(place, 'Sizes must be more than 0');
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (!room) return fail(place, 'Room not found');
  if (s.wall < 0 || s.wall >= room.outline.length) return fail(place, 'Pick a wall');
  const { a, dir, normalOut: n } = wallOf(room, s.wall);
  const p0 = { x: a.x + dir.x * s.offset, z: a.z + dir.z * s.offset }, p1 = { x: p0.x + dir.x * s.along, z: p0.z + dir.z * s.along };
  const box = aabb([p0, p1, { x: p0.x + n.x * s.out, z: p0.z + n.z * s.out }, { x: p1.x + n.x * s.out, z: p1.z + n.z * s.out }]);
  const o = addRect(room.outline, box);
  if (!o) return fail(place, "That part doesn't join onto the room");
  const err = reshape(p, room, o);
  return err ? fail(place, err) : { place: p };
}

// Move a room (with its built-ins and furniture) by dx, dz
export function moveRoom(place: Place, roomId: string, dx: number, dz: number): EditResult {
  const p = copy(place), room = p.rooms.find(r => r.id === roomId);
  if (!room) return fail(place, 'Room not found');
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  room.outline = room.outline.map(q => ({ x: r6(q.x + dx), z: r6(q.z + dz) }));
  const hit = roomOverlap(p, partsOf(room.outline), roomId);
  if (hit) return fail(place, 'Too close to ' + hit);
  for (const b of room.builtIns) { b.x = r6(b.x + dx); b.z = r6(b.z + dz); }
  for (const it of p.items) if (it.roomId === roomId) { it.x = r6(it.x + dx); it.z = r6(it.z + dz); }
  return { place: p };
}

// Copy of a room with its doors, windows and built-ins (no furniture), placed beside the others
export function cloneRoom(place: Place, roomId: string): EditResult & { id?: string } {
  const src = place.rooms.find(r => r.id === roomId);
  if (!src) return fail(place, 'Room not found');
  const p = copy(place), b = roomBox(src);
  const dx = Math.max(...place.rooms.map(r => roomBox(r).x1)) + 100 - b.x0;
  const room: Room = { ...structuredClone(src), id: newId(), name: src.name + ' copy' };
  room.outline = room.outline.map(q => ({ x: q.x + dx, z: q.z }));
  room.openings = room.openings.map(o => ({ ...o, id: newId() }));
  room.builtIns = room.builtIns.map(bi => ({ ...bi, id: newId(), x: bi.x + dx }));
  p.rooms.push(room);
  return { place: p, id: room.id };
}

// Nudges a room move so its walls line up with nearby rooms (one wall apart or flush); tol in cm
export function snapRoomMove(place: Place, roomId: string, dx: number, dz: number, tol: number): { dx: number; dz: number } {
  const room = place.rooms.find(r => r.id === roomId);
  if (!room) return { dx, dz };
  const t = place.wallThickness, others = place.rooms.filter(r => r.id !== roomId).flatMap(r => r.outline);
  const fixes = (mine: number[], cands: number[], d: number) => {
    const out = [0];
    for (const m of mine) for (const c of cands) { const f = c - (m + d); if (Math.abs(f) < tol) out.push(f); }
    return out.sort((a, b) => Math.abs(a) - Math.abs(b));
  };
  const fx = fixes(room.outline.map(q => q.x), others.flatMap(q => [q.x, q.x - t, q.x + t]), dx);
  const fz = fixes(room.outline.map(q => q.z), others.flatMap(q => [q.z, q.z - t, q.z + t]), dz);
  const pairs = fx.flatMap(a => fz.map(b => [a, b])).sort((p, q) => Math.abs(p[0]) + Math.abs(p[1]) - Math.abs(q[0]) - Math.abs(q[1]));
  // smallest nudge that doesn't overlap
  for (const [ax, az] of pairs) {
    const o = room.outline.map(q => ({ x: q.x + dx + ax, z: q.z + dz + az }));
    if (!roomOverlap(place, partsOf(o), roomId)) return { dx: dx + ax, dz: dz + az };
  }
  return { dx, dz };
}

// Nudges a wall move so the wall lines up with other walls nearby (one wall apart, or flush); tol in cm
export function snapWallMove(place: Place, roomId: string, wall: number, delta: number, tol: number): number {
  const room = place.rooms.find(r => r.id === roomId);
  if (!room) return delta;
  const w = wallOf(room, wall), t = place.wallThickness, horiz = Math.abs(w.normalOut.z) > 0.5;
  const pos = (horiz ? w.a.z : w.a.x) + (horiz ? w.normalOut.z : w.normalOut.x) * delta;
  const own = room.outline.filter((_, i) => i !== wall && i !== (wall + 1) % room.outline.length).map(q => (horiz ? q.z : q.x));
  const others = place.rooms.filter(r => r.id !== roomId).flatMap(r => r.outline).flatMap(q => { const v = horiz ? q.z : q.x; return [v, v - t, v + t]; });
  let fix = 0, bestErr = tol;
  for (const c of [...own, ...others]) { const e = Math.abs(c - pos); if (e < bestErr) { bestErr = e; fix = c - pos; } }
  return delta + fix * (horiz ? w.normalOut.z : w.normalOut.x);
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
