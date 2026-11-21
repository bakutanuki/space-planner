import { describe, it, expect } from 'vitest';
import { createRoom, wallOf, addOpening, attachRoom, buildWalls, connectingDoors } from '../../src/model/rooms';
import { aabb, footprint, polysIntersect } from '../../src/model/geometry';
import { emptyPlace } from '../../src/model/types';

describe('rooms', () => {
  it('builds, attaches and shares walls', () => {
    const r = createRoom('Room', 300, 405, { x: 0, z: 0 });
    expect(r.outline).toEqual([{ x: 0, z: 0 }, { x: 300, z: 0 }, { x: 300, z: 405 }, { x: 0, z: 405 }]);
    expect(wallOf(r, 2).length).toBe(300);
    expect(addOpening(r, { kind: 'door', wall: 2, offset: 250, width: 75, sill: 0, top: 205 })).toMatchObject({ ok: false, error: "Doesn't fit on this wall" });
    const place = { ...emptyPlace(), rooms: [r] };
    const lr = attachRoom(place, { roomId: r.id, wall: 2 }, 'LR', 307.5, 622.5, 180);
    expect(lr.ok && aabb(lr.room.outline)).toEqual({ x0: -187.5, z0: 415, x1: 120, z1: 1037.5 });
    if (!lr.ok) return;
    expect(attachRoom({ ...place, rooms: [r, lr.room] }, { roomId: r.id, wall: 2 }, 'X', 100, 100, 200)).toMatchObject({ ok: false, error: 'Overlaps LR' });
    addOpening(r, { kind: 'door', wall: 2, offset: 225, width: 75, sill: 0, top: 205 });
    const segs = buildWalls({ ...place, rooms: [r, lr.room] });
    const atSplit = segs.filter(s => s.a.z === 410 && s.b.z === 410);
    expect(atSplit.some(s => s.holes.length === 1)).toBe(true);
    expect(connectingDoors({ ...place, rooms: [r, lr.room] }, r.id, lr.room.id)).toHaveLength(1);
  });
  it('geometry', () => {
    expect(polysIntersect(footprint({ x: 0, z: 0 }, 100, 50, 0), footprint({ x: 100, z: 0 }, 100, 50, 0))).toBe(false);
    expect(polysIntersect(footprint({ x: 0, z: 0 }, 100, 50, 45), footprint({ x: 80, z: 0 }, 100, 50, 0))).toBe(true);
  });
});
