// All lengths are centimetres; x runs right, z runs down the plan (towards the viewer in 3D)
export type Pt = { x: number; z: number };
export type OpeningKind = 'door' | 'window';
// Which way a door swings: into its room or out of it, hinged at the wall's start or end
export interface Swing { into: 'room' | 'out'; hinge: 'start' | 'end' }
export interface Opening { id: string; kind: OpeningKind; wall: number; offset: number; width: number; sill: number; top: number; swing?: Swing | null }
export interface BuiltIn { id: string; name: string; x: number; z: number; w: number; d: number; h: number; rot: number }
export interface Room { id: string; name: string; outline: Pt[]; ceiling: number; squareCm: number | null; openings: Opening[]; builtIns: BuiltIn[] }
export type ItemType = 'chair' | 'sofa' | 'bed' | 'table' | 'roundTable' | 'nightstand' | 'lamp' | 'tv' | 'poster' | 'shelf' | 'rug' | 'box' | 'beanbag' | 'treadmill';
export interface Item {
  id: string; type: ItemType; name: string; w: number; d: number; h: number; x: number; z: number; rot: number;
  roomId: string; elevation: number; sitsOn: string | null; allowOverlapWith: string[]; removed: boolean;
  color?: string | null; group?: string | null; // own colour (#rrggbb) and the group it moves with
}
export interface Place { id: string; name: string; squareCm: number; wallThickness: number; rooms: Room[]; items: Item[]; gridOn: boolean; snapOn: boolean }

// Random unique id for rooms, items and places
export const newId = (): string =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? globalThis.crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

// A place with no rooms yet
export function emptyPlace(name = 'New place'): Place {
  return { id: newId(), name, squareCm: 30, wallThickness: 10, rooms: [], items: [], gridOn: true, snapOn: false };
}

// The square size that applies inside a room
export const squareOf = (place: Place, room: Room | undefined): number => room?.squareCm ?? place.squareCm;

export const TYPE_LABELS: Record<ItemType, string> = {
  chair: 'Chair', sofa: 'Sofa', bed: 'Bed', table: 'Table', roundTable: 'Round table', nightstand: 'Nightstand',
  lamp: 'Lamp', tv: 'TV', poster: 'Poster', shelf: 'Shelf', rug: 'Rug', box: 'Plain box', beanbag: 'Bean bag', treadmill: 'Treadmill',
};
export const TYPE_DEFAULTS: Record<ItemType, [number, number, number]> = {
  chair: [45, 50, 90], sofa: [200, 90, 85], bed: [160, 200, 50], table: [120, 80, 75], roundTable: [100, 100, 75],
  nightstand: [45, 40, 55], lamp: [30, 30, 150], tv: [123, 5, 71], poster: [50, 2, 70], shelf: [80, 25, 30],
  rug: [200, 140, 1], box: [50, 50, 50], beanbag: [76, 76, 47], treadmill: [75, 35, 142],
};
