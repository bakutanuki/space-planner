import type { Item, ItemType, Place } from './types';
import { emptyPlace, newId } from './types';
import { addBuiltIn, addOpening, attachRoom, createRoom } from './rooms';

// A fresh piece of furniture, not yet placed
export function newItem(type: ItemType, w: number, d: number, h: number, name = '', roomId = ''): Item {
  return { id: newId(), type, name: name || type, w, d, h, x: 0, z: 0, rot: 0, roomId, elevation: 0, sitsOn: null, allowOverlapWith: [], removed: false };
}

// The current apartment, converted from "Apartment Layout Planner.html"
export function seedApartment(): Place {
  const place: Place = { ...emptyPlace('Apartment'), squareCm: 30, wallThickness: 10, gridOn: true, snapOn: false };
  const room = createRoom('Room', 300, 405, { x: 0, z: 0 });
  must(addOpening(room, { kind: 'window', wall: 0, offset: 80, width: 150, sill: 100, top: 210 }));
  must(addOpening(room, { kind: 'door', wall: 2, offset: 225, width: 75, sill: 0, top: 205 }));
  must(addBuiltIn(room, { name: 'Closet', x: 187.5, z: 367.5, w: 225, d: 75, h: 240, rot: 0 }));
  place.rooms.push(room);
  const a = attachRoom(place, { roomId: room.id, wall: 2 }, 'Living room', 307.5, 622.5, 180);
  if (!a.ok) throw new Error(a.error);
  const lr = a.room;
  for (const [wall, offset, width] of [[0, 97.5, 70], [1, 10, 108], [1, 535, 81], [3, 29.5, 102]] as const)
    must(addOpening(lr, { kind: 'door', wall, offset, width, sill: 0, top: 205 }));
  must(addOpening(lr, { kind: 'window', wall: 2, offset: 82, width: 128, sill: 100, top: 210 }));
  place.rooms.push(lr);
  const it = (type: ItemType, name: string, w: number, d: number, h: number, x: number, z: number, rot: number): Item =>
    ({ ...newItem(type, w, d, h, name, room.id), x, z, rot });
  const stand = it('box', 'TV stand', 140, 40, 60, 280, 175, 270);
  const tv = { ...it('tv', 'TV', 168, 5, 97, 280, 175, 270), sitsOn: stand.id };
  place.items = [
    stand, tv,
    it('sofa', 'Sofa, 3-seat', 205, 90, 85, 45, 192.5, 90),
    it('sofa', 'Loveseat', 155, 90, 85, 155, 45, 0),
    it('table', 'Coffee table', 100, 60, 44, 165, 195, 90),
    it('nightstand', 'Side table', 55, 45, 62, 22.5, 325, 90),
    it('treadmill', 'Treadmill, folded', 75, 35, 142, 37.5, 17.5, 0),
    it('lamp', 'Floor lamp', 30, 30, 55, 25, 62, 0),
    it('beanbag', 'Bean bag', 76, 76, 47, 205, 285, 0),
  ];
  return place;
}

function must(r: { ok: boolean; error?: string }) { if (!r.ok) throw new Error(r.error); }
