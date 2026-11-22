import { describe, it, expect } from 'vitest';
import { emptyPlace } from '../../src/model/types';
import { addItem, addRoom, cloneItem, groupItems, groupOf, moveGroup, removeItem, rotateGroup, setItemColor, ungroup } from '../../src/model/edit';

function room() {
  let p = addRoom(emptyPlace(), { name: 'Bedroom', w: 300, d: 400, ceiling: 240, squareCm: null }).place;
  const a = addItem(p, p.rooms[0].id, 'table', 'Desk', 120, 60, 75); p = a.place;
  const b = addItem(p, p.rooms[0].id, 'chair', 'Chair', 45, 50, 90); p = b.place;
  return { p, desk: a.id!, chair: b.id! };
}

describe('groups and colours', () => {
  it('moves a group together and stops it at the walls', () => {
    let { p, desk, chair } = room();
    p = groupItems(p, [desk, chair]).place;
    expect(groupOf(p, desk).map(i => i.id).sort()).toEqual([desk, chair].sort());
    const before = p.items.map(i => [i.x, i.z]);
    const m = moveGroup(p, [desk, chair], 40, -30);
    expect(m.place.items.map(i => [i.x, i.z])).toEqual(before.map(([x, z]) => [x + 40, z - 30]));
    expect(moveGroup(p, [desk, chair], 500, 0).error).toMatch(/would hit a wall/);
  });
  it('turns a group around its middle', () => {
    let { p, desk, chair } = room();
    p = groupItems(p, [desk, chair]).place;
    const r = rotateGroup(p, [desk, chair], 90);
    expect(r.error).toBeUndefined();
    expect(r.place.items.every(i => i.rot === 90)).toBe(true);
  });
  it('ungroups, and a group of one stops being a group', () => {
    let { p, desk, chair } = room();
    p = groupItems(p, [desk, chair]).place;
    expect(ungroup(p, desk).place.items.every(i => !i.group)).toBe(true);
    expect(removeItem(p, chair).place.items.find(i => i.id === desk)!.group).toBeNull();
  });
  it('sets and clears colours', () => {
    const { p, desk } = room();
    expect(setItemColor(p, desk, '#2f4a6d').place.items[0].color).toBe('#2f4a6d');
    expect(setItemColor(p, desk, 'blue').error).toBe('Pick a colour');
    expect(setItemColor(p, desk, null).place.items[0].color).toBeNull();
  });
});

describe('cloning pieces', () => {
  it('copies a group next to the original with fresh ids', () => {
    let { p, desk, chair } = room();
    p = groupItems(p, [desk, chair]).place;
    const c = cloneItem(p, desk);
    expect(c.error).toBeUndefined();
    expect(c.place.items).toHaveLength(4);
    const copy = c.place.items.find(i => i.id === c.id)!;
    expect(copy.group).not.toBe(p.items[0].group);
    expect(groupOf(c.place, copy.id)).toHaveLength(2);
    expect(copy.color ?? null).toBe(null);
  });
});
