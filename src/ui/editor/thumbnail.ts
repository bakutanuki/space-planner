import type { Place } from '../../model/types';
import { roomBox } from '../../model/rooms';
import { footprint } from '../../model/geometry';
import { effectiveElevation } from '../../model/stacking';
import { levelForHeight } from '../../model/levels';

// Small picture of the plan for the home page (same orientation as the 2D view)
export function makeThumbnail(place: Place, W = 320, H = 200): string {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e6e0'; g.fillRect(0, 0, W, H);
  if (!place.rooms.length) return c.toDataURL('image/png');
  const boxes = place.rooms.map(roomBox), t = place.wallThickness;
  const x0 = Math.min(...boxes.map(b => b.x0)) - t, x1 = Math.max(...boxes.map(b => b.x1)) + t;
  const z0 = Math.min(...boxes.map(b => b.z0)) - t, z1 = Math.max(...boxes.map(b => b.z1)) + t;
  const s = Math.min((W - 16) / (x1 - x0), (H - 16) / (z1 - z0));
  const ox = (W - (x1 - x0) * s) / 2, oy = (H - (z1 - z0) * s) / 2;
  // turned half a turn, like the editor's plan view
  const P = (x: number, z: number): [number, number] => [ox + (x1 - x) * s, oy + (z1 - z) * s];
  for (const b of boxes) {
    g.fillStyle = '#4a4640';
    const [ax, ay] = P(b.x1 + t, b.z1 + t); g.fillRect(ax, ay, (b.x1 - b.x0 + 2 * t) * s, (b.z1 - b.z0 + 2 * t) * s);
  }
  for (const b of boxes) { g.fillStyle = '#dccfb8'; const [ax, ay] = P(b.x1, b.z1); g.fillRect(ax, ay, (b.x1 - b.x0) * s, (b.z1 - b.z0) * s); }
  for (const r of place.rooms) for (const bi of r.builtIns) poly(g, footprint(bi, bi.w, bi.d, bi.rot).map(p => P(p.x, p.z)), '#1c1916');
  const items = place.items.filter(i => !i.removed).sort((a, b) => effectiveElevation(place, a) - effectiveElevation(place, b));
  for (const it of items) poly(g, footprint(it, it.w, it.d, it.rot).map(p => P(p.x, p.z)), levelForHeight(effectiveElevation(place, it)).color);
  return c.toDataURL('image/png');
}

function poly(g: CanvasRenderingContext2D, pts: [number, number][], fill: string) {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  g.fillStyle = fill; g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
}
