import { describe, it, expect } from 'vitest';
import { seedApartment, newItem } from '../../src/model/seed';
import { formatBoth } from '../../src/model/units';
import { connectingDoors, roomBox } from '../../src/model/rooms';
import { placeItem, snapPoint } from '../../src/model/placement';
import { effectiveElevation } from '../../src/model/stacking';
import { findOverlaps } from '../../src/model/overlap';
import { allowOverlap, moveItem, removeItem, setItemLevel, rotateItem } from '../../src/model/edit';
import type { Place } from '../../src/model/types';

const byName = (p: Place, n: string) => p.items.find(i => i.name === n)!;

describe('seed', () => {
  it('imports the apartment', () => {
    const p = seedApartment();
    expect(p.rooms).toHaveLength(2);
    const b = roomBox(p.rooms[0]);
    expect(formatBoth(b.x1 - b.x0, 30)).toBe('10 sq · 3.00 m');
    expect(formatBoth(b.z1 - b.z0, 30)).toBe('13½ sq · 4.05 m');
    expect(connectingDoors(p, p.rooms[0].id, p.rooms[1].id)).toHaveLength(1);
    expect(p.items).toHaveLength(9);
    expect(byName(p, 'TV').sitsOn).toBe(byName(p, 'TV stand').id);
    // every original position stays exactly where it was
    for (const it of p.items) { const r = placeItem(p, it, it); expect(r.ok && [r.x, r.z]).toEqual([it.x, it.z]); }
  });
});

describe('placement', () => {
  const p = seedApartment(), room = p.rooms[0], lr = p.rooms[1];
  it('clamps, pushes out, uses doors', () => {
    expect(placeItem(p, byName(p, 'Coffee table'), { x: 1000, z: 195 })).toMatchObject({ ok: true, x: 300 - 30 });
    const r1 = placeItem(p, byName(p, 'Floor lamp'), { x: 200, z: 380 }); expect(r1.ok && r1.z <= 315).toBe(true);
    expect(placeItem(p, byName(p, 'Floor lamp'), { x: 40, z: 600 })).toMatchObject({ roomId: lr.id });
    expect(placeItem(p, byName(p, 'Bean bag'), { x: 250, z: 600 })).toMatchObject({ roomId: room.id });
    expect(placeItem(p, { ...byName(p, 'Sofa, 3-seat'), w: 450 }, { x: 150, z: 200 })).toEqual({ ok: false, error: 'Too big for Room' });
    const poster = { ...newItem('poster', 70, 2, 100, 'P', room.id), elevation: 150 };
    expect(placeItem(p, poster, { x: 150, z: 20 })).toMatchObject({ ok: true, z: 1, rot: 0 });
    expect(snapPoint({ x: 47, z: 31 }, { ...p, snapOn: true }, room)).toEqual({ x: 45, z: 30 });
  });
  it('keeps a 2 cm misfit visible', () => {
    const r = placeItem(p, { ...byName(p, 'Sofa, 3-seat'), w: 407, rot: 90 }, { x: 45, z: 200 });
    expect(r).toEqual({ ok: false, error: 'Too big for Room' });
  });
});

describe('stacking and overlap', () => {
  it('works', () => {
    const p = seedApartment();
    const tv = byName(p, 'TV'), stand = byName(p, 'TV stand'), lamp = byName(p, 'Floor lamp');
    expect(effectiveElevation(p, tv)).toBe(60);
    const p2 = moveItem(p, stand.id, { x: 270, z: 150 }).place;
    expect(p2.items.find(i => i.id === tv.id)!.z).toBe(p2.items.find(i => i.id === stand.id)!.z);
    expect(findOverlaps(p).size).toBe(0);
    const sofaA = byName(p, 'Sofa, 3-seat'), love = byName(p, 'Loveseat'), bean = byName(p, 'Bean bag');
    const q0 = moveItem(p, love.id, { x: 100, z: 200 }).place;
    expect(findOverlaps(q0).get(love.id)).toContain(sofaA.id);
    const q = allowOverlap(q0, love.id).place;
    expect(findOverlaps(q).has(love.id)).toBe(false);
    const q2 = moveItem(q, love.id, { x: bean.x, z: bean.z }).place;
    expect(findOverlaps(q2).get(love.id)).toContain(bean.id);
    const p3 = removeItem(p, stand.id).place;
    const tv3 = p3.items.find(i => i.id === tv.id)!;
    expect(tv3.sitsOn).toBeNull(); expect(effectiveElevation(p3, tv3)).toBe(0);
    expect(setItemLevel(p, lamp.id, 3).place.items.find(i => i.id === lamp.id)!.elevation).toBe(75);
    // a lamp dropped on the side table sits on it, and is not an overlap
    const side = byName(p, 'Side table');
    const p4 = moveItem(p, lamp.id, { x: side.x, z: side.z }, { drop: true }).place;
    expect(p4.items.find(i => i.id === lamp.id)!.sitsOn).toBe(side.id);
    expect(findOverlaps(p4).size).toBe(0);
    // turning the stand turns the TV with it
    const p5 = rotateItem(p, stand.id, 90).place;
    expect(p5.items.find(i => i.id === tv.id)!.rot).toBe(0);
  });
});
