import type { Item, Place } from './types';
import { circleIntersectsPoly, footprint, polysIntersect } from './geometry';
import { childrenOf, effectiveElevation } from './stacking';

const round = (i: Item) => i.type === 'roundTable' || i.type === 'beanbag';

// Do two pieces' floor shapes overlap?
function footprintsMeet(a: Item, b: Item): boolean {
  const fa = footprint(a, a.w, a.d, a.rot), fb = footprint(b, b.w, b.d, b.rot);
  if (round(a) && round(b)) return Math.hypot(a.x - b.x, a.z - b.z) < a.w / 2 + b.w / 2 - 1e-6;
  if (round(a)) return circleIntersectsPoly(a, a.w / 2, fb);
  if (round(b)) return circleIntersectsPoly(b, b.w / 2, fa);
  return polysIntersect(fa, fb);
}

// Every piece that bumps into another one (same floor space and same height range)
export function findOverlaps(place: Place): Map<string, string[]> {
  const items = place.items.filter(i => !i.removed && i.type !== 'rug');
  const out = new Map<string, string[]>();
  const add = (a: string, b: string) => out.set(a, [...(out.get(a) ?? []), b]);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.roomId !== b.roomId) continue;
    if (a.allowOverlapWith.includes(b.id) || b.allowOverlapWith.includes(a.id)) continue;
    if (childrenOf(place, a.id).includes(b) || childrenOf(place, b.id).includes(a)) continue;
    const ea = effectiveElevation(place, a), eb = effectiveElevation(place, b);
    if (!(ea < eb + b.h - 1e-6 && eb < ea + a.h - 1e-6)) continue;
    if (!footprintsMeet(a, b)) continue;
    add(a.id, b.id); add(b.id, a.id);
  }
  return out;
}
