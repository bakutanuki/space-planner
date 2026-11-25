import type { Opening, Place, Pt, Room, Swing } from './types';
import { newId } from './types';
import { checkOpening, roomAt, wallOf } from './rooms';
import type { EditResult } from './edit';

// What gets put in a wall: a door with a leaf, an open doorway (no leaf) or a window
export type OpeningStyle = 'door' | 'doorway' | 'window';

export const STYLE_WIDTHS: Record<OpeningStyle, number[]> = { door: [70, 80, 90, 100], doorway: [80, 90, 120, 160], window: [60, 100, 120, 150] };
export const STYLE_DEFAULT: Record<OpeningStyle, number> = { door: 80, doorway: 90, window: 100 };

export const styleOf = (o: Opening): OpeningStyle => (o.kind === 'window' ? 'window' : o.swing === 'open' ? 'doorway' : 'door');

export interface WallHit { roomId: string; wall: number; t: number; dist: number }

// The wall nearest a floor point (within tol cm of the wall itself). Next to a shared wall, the room the point is in wins
export function nearestWall(place: Place, p: Pt, tol: number): WallHit | null {
  const T = place.wallThickness, inside = roomAt(place, p);
  let best: WallHit | null = null, bestScore = Infinity;
  for (const r of place.rooms) {
    for (let i = 0; i < r.outline.length; i++) {
      const w = wallOf(r, i);
      const along = (p.x - w.a.x) * w.dir.x + (p.z - w.a.z) * w.dir.z;
      const s = (p.x - w.a.x) * w.normalOut.x + (p.z - w.a.z) * w.normalOut.z; // 0 at the room's face, T at the far face
      const ds = s < 0 ? -s : s > T ? s - T : 0;
      const da = along < 0 ? -along : along > w.length ? along - w.length : 0;
      const dist = Math.hypot(ds, da);
      if (dist > tol) continue;
      const score = dist + (inside && inside.id !== r.id ? 1 : 0) + 0.01 * Math.min(Math.max(s, 0), T) / T;
      if (score < bestScore) { bestScore = score; best = { roomId: r.id, wall: i, t: Math.max(0, Math.min(w.length, along)), dist }; }
    }
  }
  return best;
}

// Stretches of a wall already taken by doors and windows, including ones put in from the room on the other side
export function takenSpans(place: Place, room: Room, wi: number, ignoreId?: string): { from: number; to: number }[] {
  const own = room.openings.filter(o => o.wall === wi && o.id !== ignoreId).map(o => ({ from: o.offset, to: o.offset + o.width }));
  return [...own, ...otherSideSpans(place, room, wi, ignoreId)].sort((x, y) => x.from - y.from);
}

// Openings put in from the room on the other side of a shared wall, measured along this wall
function otherSideSpans(place: Place, room: Room, wi: number, ignoreId?: string): { from: number; to: number }[] {
  const w = wallOf(room, wi), T = place.wallThickness, out: { from: number; to: number }[] = [];
  for (const other of place.rooms) {
    if (other.id === room.id) continue;
    for (const o of other.openings) {
      if (o.id === ignoreId || o.wall >= other.outline.length) continue;
      const v = wallOf(other, o.wall);
      if (Math.abs(w.normalOut.x + v.normalOut.x) > 1e-6 || Math.abs(w.normalOut.z + v.normalOut.z) > 1e-6) continue;
      if (Math.abs((v.a.x - w.a.x) * w.normalOut.x + (v.a.z - w.a.z) * w.normalOut.z - T) > 0.5) continue;
      const at = (t: number) => (v.a.x + v.dir.x * t - w.a.x) * w.dir.x + (v.a.z + v.dir.z * t - w.a.z) * w.dir.z;
      const a = at(o.offset), b = at(o.offset + o.width), from = Math.min(a, b), to = Math.max(a, b);
      if (to > 0 && from < w.length) out.push({ from, to });
    }
  }
  return out;
}

// Where along a wall an opening of this width goes when aimed at `centre`: rounded to `step`, pulled to the wall ends or the middle when close, and slid clear of other openings
export function fitOpening(place: Place, roomId: string, wi: number, centre: number, width: number, opts: { ignoreId?: string; step?: number; snap?: number } = {}): { offset: number } | { error: string } {
  const room = place.rooms.find(r => r.id === roomId);
  if (!room || wi >= room.outline.length) return { error: 'Pick a wall' };
  const L = wallOf(room, wi).length, max = L - width, step = opts.step ?? 5, snap = opts.snap ?? 0;
  if (max < -1e-6) return { error: `This wall is only ${Math.round(L)} cm long` };
  let off = Math.round((centre - width / 2) / step) * step, bestErr = snap;
  for (const c of [0, max, max / 2]) { const e = Math.abs(centre - width / 2 - c); if (e < bestErr) { bestErr = e; off = c; } }
  off = Math.max(0, Math.min(max, off));
  const taken = takenSpans(place, room, wi, opts.ignoreId);
  const free = (x: number) => x >= -1e-6 && x <= max + 1e-6 && taken.every(s => !(x < s.to - 1e-6 && s.from < x + width - 1e-6));
  if (free(off)) return { offset: round(off) };
  // slide to the nearest gap that fits
  const tries = taken.flatMap(s => [s.to, s.from - width]).filter(free).sort((a, b) => Math.abs(a - off) - Math.abs(b - off));
  return tries.length ? { offset: round(tries[0]) } : { error: 'No space left on this wall' };
}
const round = (n: number) => Math.round(n * 100) / 100;

// The usual swing for a new door: opens into the room, hinged at the end nearer a corner
export function defaultSwing(place: Place, roomId: string, wi: number, offset: number, width: number): Swing {
  const room = place.rooms.find(r => r.id === roomId)!;
  const L = wallOf(room, wi).length;
  return { into: 'room', hinge: offset <= L - offset - width ? 'start' : 'end' };
}

// A new opening of a style, ready to save
export function newOpening(style: OpeningStyle, room: Room, wall: number, offset: number, width: number, swing: Swing): Omit<Opening, 'id'> {
  if (style === 'window') return { kind: 'window', wall, offset, width, sill: 90, top: Math.min(210, room.ceiling - 10), swing: null };
  return { kind: 'door', wall, offset, width, sill: 0, top: Math.min(205, room.ceiling), swing: style === 'doorway' ? 'open' : swing };
}

// Find an opening anywhere in the place
export function findOpening(place: Place, id: string): { room: Room; o: Opening } | null {
  for (const room of place.rooms) { const o = room.openings.find(x => x.id === id); if (o) return { room, o }; }
  return null;
}

// Put a new opening on a wall; gives back its id
export function placeOpening(place: Place, roomId: string, o: Omit<Opening, 'id'>): EditResult & { id?: string } {
  const p = structuredClone(place), room = p.rooms.find(r => r.id === roomId);
  if (!room) return { place, error: 'Room not found' };
  const err = checkOpening(room, o) ?? (overlapsOtherSide(p, room, o) ? 'Overlaps another door or window' : null);
  if (err) return { place, error: err };
  const id = newId();
  room.openings.push({ ...o, id });
  return { place: p, id };
}

// Change an opening and/or move it to another wall (possibly of another room); it keeps its id
export function updateOpening(place: Place, id: string, ch: Partial<Omit<Opening, 'id'>> & { roomId?: string }): EditResult {
  const found = findOpening(place, id);
  if (!found) return { place, error: 'Door or window not found' };
  const p = structuredClone(place);
  const from = p.rooms.find(r => r.id === found.room.id)!, to = p.rooms.find(r => r.id === (ch.roomId ?? found.room.id));
  if (!to) return { place, error: 'Room not found' };
  const { roomId: _r, ...rest } = ch;
  const next: Opening = { ...found.o, ...rest, id };
  from.openings = from.openings.filter(o => o.id !== id);
  const err = checkOpening(to, next, id) ?? (overlapsOtherSide(p, to, next) ? 'Overlaps another door or window' : null);
  if (err) return { place, error: err };
  to.openings.push(next);
  return { place: p };
}

// Remove an opening wherever it is
export function removeOpening(place: Place, id: string): EditResult {
  const p = structuredClone(place);
  for (const r of p.rooms) r.openings = r.openings.filter(o => o.id !== id);
  return { place: p };
}

// Turns a door to open the other way (into the room / out of it)
export function flipSide(place: Place, id: string): EditResult {
  const f = findOpening(place, id);
  if (!f || f.o.kind !== 'door' || f.o.swing === 'open') return { place, error: 'Only doors swing' };
  const sw = f.o.swing ?? { into: 'room', hinge: 'start' };
  return updateOpening(place, id, { swing: { ...sw, into: sw.into === 'room' ? 'out' : 'room' } });
}

// Moves a door's hinge to its other side
export function flipHinge(place: Place, id: string): EditResult {
  const f = findOpening(place, id);
  if (!f || f.o.kind !== 'door' || f.o.swing === 'open') return { place, error: 'Only doors swing' };
  const sw = f.o.swing ?? { into: 'room', hinge: 'start' };
  return updateOpening(place, id, { swing: { ...sw, hinge: sw.hinge === 'start' ? 'end' : 'start' } });
}

// Switches between door, open doorway and window, keeping where it is
export function setStyle(place: Place, id: string, style: OpeningStyle): EditResult {
  const f = findOpening(place, id);
  if (!f) return { place, error: 'Door or window not found' };
  const sw = f.o.swing && f.o.swing !== 'open' ? f.o.swing : defaultSwing(place, f.room.id, f.o.wall, f.o.offset, f.o.width);
  const n = newOpening(style, f.room, f.o.wall, f.o.offset, f.o.width, sw);
  return updateOpening(place, id, { kind: n.kind, sill: n.sill, top: n.top, swing: n.swing });
}

// New width, keeping the middle where it was (slides along if it would hit something)
export function resizeOpening(place: Place, id: string, width: number): EditResult {
  const f = findOpening(place, id);
  if (!f) return { place, error: 'Door or window not found' };
  const fit = fitOpening(place, f.room.id, f.o.wall, f.o.offset + f.o.width / 2, width, { ignoreId: id, step: 0.01 });
  if ('error' in fit) return { place, error: fit.error };
  return updateOpening(place, id, { width, offset: fit.offset });
}

function overlapsOtherSide(place: Place, room: Room, o: Omit<Opening, 'id'> & { id?: string }): boolean {
  return otherSideSpans(place, room, o.wall, o.id).some(s => s.from < o.offset + o.width - 1e-6 && o.offset < s.to - 1e-6);
}
