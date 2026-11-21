import type { Item, Place } from './types';
import { footprint, pointInPoly } from './geometry';

const byId = (place: Place, id: string | null) => (id ? place.items.find(i => i.id === id) : undefined);

// Height of an item's bottom: on top of what it sits on, or its own height off the floor
export function effectiveElevation(place: Place, item: Item, seen = new Set<string>()): number {
  if (seen.has(item.id)) return item.elevation;
  seen.add(item.id);
  const parent = byId(place, item.sitsOn);
  if (!parent || parent.removed) return item.elevation;
  return effectiveElevation(place, parent, seen) + parent.h;
}

// Everything sitting on an item, directly or on top of something that is
export function childrenOf(place: Place, id: string): Item[] {
  const out: Item[] = [];
  const walk = (pid: string) => {
    for (const c of place.items) if (c.sitsOn === pid && !out.includes(c) && c.id !== id) { out.push(c); walk(c.id); }
  };
  walk(id);
  return out;
}

// Pieces with a flat top that things can be put on
const SURFACES = ['table', 'roundTable', 'nightstand', 'box', 'shelf', 'bed'];

// Can child be put on top of parent? (only smaller pieces, only onto flat tops)
export function canSitOn(place: Place, child: Item, parent: Item): boolean {
  if (parent.removed || parent.id === child.id) return false;
  if (!SURFACES.includes(parent.type)) return false;
  if (child.w * child.d > parent.w * parent.d) return false;
  if (childrenOf(place, child.id).some(c => c.id === parent.id)) return false;
  return pointInPoly({ x: child.x, z: child.z }, footprint({ x: parent.x, z: parent.z }, parent.w, parent.d, parent.rot));
}
