import { describe, it, expect } from 'vitest';
import { createRoom, attachRoom, buildWalls } from '../../src/model/rooms';
import { emptyPlace, type Place } from '../../src/model/types';
import { fitOpening, flipHinge, flipSide, findOpening, nearestWall, newOpening, placeOpening, resizeOpening, setStyle, updateOpening, defaultSwing } from '../../src/model/doors';

function twoRooms(): Place {
  const a = createRoom('Bedroom', 300, 400, { x: 0, z: 0 });
  const place = { ...emptyPlace(), rooms: [a] };
  const b = attachRoom(place, { roomId: a.id, wall: 2 }, 'Hall', 300, 200, 0);
  if (!b.ok) throw new Error(b.error);
  return { ...place, rooms: [a, b.room] };
}

describe('doors', () => {
  it('finds the wall under the pointer, preferring the room you are in', () => {
    const p = twoRooms(), [a, b] = p.rooms;
    expect(nearestWall(p, { x: 150, z: 5 }, 20)).toMatchObject({ roomId: a.id, wall: 0, t: 150 });
    expect(nearestWall(p, { x: 150, z: 200 }, 20)).toBeNull();
    // just inside the bedroom next to the shared wall (bedroom wall 2 runs at z=400, hall wall 0 at z=410)
    expect(nearestWall(p, { x: 100, z: 395 }, 20)).toMatchObject({ roomId: a.id, wall: 2 });
    expect(nearestWall(p, { x: 100, z: 415 }, 20)).toMatchObject({ roomId: b.id, wall: 0 });
  });

  it('fits a door along a wall: rounds, snaps to the ends and middle, and slides clear of others', () => {
    const p = twoRooms(), a = p.rooms[0];
    expect(fitOpening(p, a.id, 0, 151, 80)).toEqual({ offset: 110 });
    expect(fitOpening(p, a.id, 0, 10, 80)).toEqual({ offset: 0 });
    expect(fitOpening(p, a.id, 0, 290, 80)).toEqual({ offset: 220 });
    expect(fitOpening(p, a.id, 0, 47, 80, { snap: 10 })).toEqual({ offset: 0 });
    expect(fitOpening(p, a.id, 0, 145, 80, { snap: 10 })).toEqual({ offset: 110 });
    expect(fitOpening(p, a.id, 0, 150, 400)).toEqual({ error: 'This wall is only 300 cm long' });
    const r = placeOpening(p, a.id, newOpening('door', a, 0, 110, 80, { into: 'room', hinge: 'start' }));
    expect(r.error).toBeUndefined();
    expect(fitOpening(r.place, a.id, 0, 140, 80)).toEqual({ offset: 30 });
  });

  it('sees doors put in from the other side of a shared wall', () => {
    const p = twoRooms(), [a, b] = p.rooms;
    const r = placeOpening(p, a.id, newOpening('door', a, 2, 100, 80, defaultSwing(p, a.id, 2, 100, 80)));
    expect(r.error).toBeUndefined();
    // bedroom wall 2 runs right to left; hall wall 0 runs left to right, so bedroom offset 100..180 is hall 120..200
    expect(fitOpening(r.place, b.id, 0, 160, 80)).toEqual({ offset: 200 });
    expect(placeOpening(r.place, b.id, newOpening('door', b, 0, 150, 80, { into: 'room', hinge: 'start' })).error).toBe('Overlaps another door or window');
    expect(buildWalls(r.place).flatMap(s => s.holes)).toHaveLength(1);
  });

  it('moves, flips, resizes and restyles a door, keeping its id', () => {
    const p = twoRooms(), [a, b] = p.rooms;
    let r = placeOpening(p, a.id, newOpening('door', a, 0, 20, 80, defaultSwing(p, a.id, 0, 20, 80)));
    const id = r.id!;
    expect(findOpening(r.place, id)!.o.swing).toEqual({ into: 'room', hinge: 'start' });
    let q = flipSide(r.place, id); q = flipHinge(q.place, id);
    expect(findOpening(q.place, id)!.o.swing).toEqual({ into: 'out', hinge: 'end' });
    q = resizeOpening(q.place, id, 90);
    expect(findOpening(q.place, id)!.o).toMatchObject({ width: 90, offset: 15 });
    q = updateOpening(q.place, id, { roomId: b.id, wall: 1, offset: 50 });
    expect(q.error).toBeUndefined();
    expect(findOpening(q.place, id)).toMatchObject({ room: { id: b.id }, o: { wall: 1, offset: 50 } });
    expect(q.place.rooms[0].openings).toHaveLength(0);
    q = setStyle(q.place, id, 'doorway');
    expect(findOpening(q.place, id)!.o.swing).toBe('open');
    q = setStyle(q.place, id, 'window');
    expect(findOpening(q.place, id)!.o).toMatchObject({ kind: 'window', sill: 90, top: 210 });
    expect(flipSide(q.place, id).error).toBe('Only doors swing');
  });
});
