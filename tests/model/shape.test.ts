import { describe, it, expect } from 'vitest';
import { emptyPlace, type Place } from '../../src/model/types';
import { addRoom, addRoomPart, addItem, cloneRoom, moveRoom, moveRoomWall, moveItem, saveOpening, snapRoomMove } from '../../src/model/edit';
import { addRect, areaOf, boxInShape, clampInShape, moveWall, partsOf, rectsOf, validShape, wallName, wallStart } from '../../src/model/shape';
import { roomBox } from '../../src/model/rooms';
import { distancesToWalls } from '../../src/model/placement';

const rect = [{ x: 0, z: 0 }, { x: 300, z: 0 }, { x: 300, z: 400 }, { x: 0, z: 400 }];

describe('room shapes', () => {
  it('adds a rectangle to make an L and keeps exact sizes', () => {
    const L = addRect(rect, { x0: 0, z0: 400, x1: 150, z1: 500 })!;
    expect(L).toHaveLength(6);
    expect(validShape(L)).toBe(true);
    expect(areaOf(L)).toBe(300 * 400 + 150 * 100);
    expect(rectsOf(L)).toHaveLength(2);
    expect(partsOf(L).reduce((s, b) => s + (b.x1 - b.x0) * (b.z1 - b.z0), 0)).toBe(areaOf(L));
    expect(boxInShape({ x0: 10, z0: 380, x1: 140, z1: 498 }, L)).toBe(true);
    expect(boxInShape({ x0: 10, z0: 380, x1: 152, z1: 498 }, L)).toBe(false); // 2 cm over the notch
    expect(clampInShape(L, 100, 40, { x: 280, z: 480 })).toEqual({ x: 200, z: 360 });
    // corner-only touch and far-away boxes don't join
    expect(addRect(rect, { x0: 300, z0: 400, x1: 400, z1: 500 })).toBeNull();
    expect(addRect(rect, { x0: 500, z0: 0, x1: 600, z1: 100 })).toBeNull();
  });
  it('names walls as seen on screen, telling repeats apart', () => {
    const L = addRect(rect, { x0: 0, z0: 400, x1: 150, z1: 500 })!;
    const names = L.map((_, i) => wallName(L, i));
    expect(names.filter(n => n.startsWith('Top wall'))).toEqual(expect.arrayContaining(['Top wall (left part)', 'Top wall (right part)']));
    expect(wallStart(rect, 2)).toBe('left end');
  });
  it('slides walls and rejects shapes that fold over', () => {
    expect(areaOf(moveWall(rect, 1, 50)!)).toBe(350 * 400);
    expect(moveWall(rect, 1, -300)).toBeNull();
    const L = addRect(rect, { x0: 0, z0: 400, x1: 150, z1: 500 })!;
    const i = L.findIndex((p, k) => p.z === 500 && L[(k + 1) % L.length].z === 500);
    expect(moveWall(L, i, -100)).toHaveLength(4); // pushing the bump back in leaves a rectangle
  });
});

function bedroomPlace(): Place {
  let p = addRoom(emptyPlace(), { name: 'Bedroom', w: 300, d: 400, ceiling: 240, squareCm: null }).place;
  p = saveOpening(p, p.rooms[0].id, { kind: 'door', wall: 1, offset: 50, width: 80, sill: 0, top: 205 }).place;
  return p;
}

describe('room edits', () => {
  it('adds a part, keeping doors on their walls', () => {
    const p0 = bedroomPlace(), id = p0.rooms[0].id;
    const r = addRoomPart(p0, id, { wall: 2, offset: 150, along: 150, out: 100 });
    expect(r.error).toBeUndefined();
    const room = r.place.rooms[0];
    expect(room.outline).toHaveLength(6);
    const d = room.openings[0];
    expect(wallName(room.outline, d.wall)).toBe('Left wall (lower part)');
    expect(d.offset).toBe(50);
    // a part over the door is refused
    expect(addRoomPart(p0, id, { wall: 1, offset: 0, along: 200, out: 50 }).error).toBe('A door or window is in the way');
  });
  it('moves walls with their doors and keeps furniture inside', () => {
    let p = bedroomPlace(); const id = p.rooms[0].id;
    p = moveRoomWall(p, id, 1, 40).place;
    expect(roomBox(p.rooms[0])).toEqual({ x0: 0, z0: 0, x1: 340, z1: 400 });
    expect(p.rooms[0].openings[0]).toMatchObject({ wall: 1, offset: 50 });
    const a = addItem(p, id, 'bed', 'Bed', 160, 200, 50);
    expect(moveRoomWall(a.place, id, 1, -200).error).toBe('Bed would no longer fit');
  });
  it('furniture fits the L exactly and measures to the right walls', () => {
    let p = bedroomPlace(); const id = p.rooms[0].id;
    p = addRoomPart(p, id, { wall: 2, offset: 0, along: 150, out: 100 }).place;
    const a = addItem(p, id, 'box', 'Box', 140, 50, 50);
    const m = moveItem(a.place, a.id!, { x: 300, z: 480 });
    const it = m.place.items[0];
    expect([it.x, it.z]).toEqual([230, 475]); // tucked into the bump
    const gaps = distancesToWalls(m.place, it);
    expect(gaps.find(g => g.wall === 2)!.cm).toBe(0);
    expect(gaps.find(g => g.wall === 3)!.cm).toBe(10);
    expect(gaps.find(g => g.wall === 0)!.cm).toBe(450);
  });
  it('moves, snaps and clones rooms', () => {
    let p = bedroomPlace(); const id = p.rooms[0].id;
    p = addRoom(p, { name: 'Hall', w: 100, d: 100, ceiling: 240, squareCm: null }).place;
    const hall = p.rooms[1].id;
    expect(snapRoomMove(p, hall, -95, 0, 12)).toEqual({ dx: -90, dz: 0 }); // stops one wall away
    expect(moveRoom(p, hall, -150, 0).error).toBe('Too close to Bedroom');
    const c = cloneRoom(p, id);
    expect(c.place.rooms).toHaveLength(3);
    expect(c.place.rooms[2].openings[0].id).not.toBe(p.rooms[0].openings[0].id);
    expect(roomBox(c.place.rooms[2]).x0).toBe(roomBox(p.rooms[1]).x1 + 100);
  });
});
