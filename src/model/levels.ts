// The 5 height levels; the level is where an item's bottom sits
export interface Level { n: 1 | 2 | 3 | 4 | 5; name: string; cm: number; color: string }
export const LEVELS: readonly Level[] = [
  { n: 1, name: 'Floor', cm: 0, color: '#8a6f4e' },
  { n: 2, name: 'Seat', cm: 45, color: '#2e9e6a' },
  { n: 3, name: 'Table', cm: 75, color: '#2f6fde' },
  { n: 4, name: 'Counter', cm: 90, color: '#9b4fd1' },
  { n: 5, name: 'Eye level', cm: 150, color: '#e0702b' },
];

// Nearest level by height; anything at or above eye level is level 5
export function levelForHeight(cm: number): Level {
  if (cm >= 150) return LEVELS[4];
  let best = LEVELS[0];
  for (const l of LEVELS) if (Math.abs(l.cm - cm) < Math.abs(best.cm - cm)) best = l;
  return best;
}
