// Turning centimetres into labels and typed text into centimetres, never rounding stored values

const trim = (s: string) => s.replace(/\.?0+$/, '');

// 405 -> "405 cm", 16.5 -> "16.5 cm"
export function formatCm(cm: number): string {
  const r = Math.round(cm * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + ' cm';
}

// 405 -> "4.05 m", 622.5 -> "6.225 m"
export function formatM(cm: number): string {
  const m = cm / 100;
  const two = m.toFixed(2);
  if (Math.abs(Number(two) - m) < 1e-9) return two + ' m';
  return trim(m.toFixed(4)) + ' m';
}

// How many squares a length covers
export const toSquares = (cm: number, squareCm: number): number => cm / squareCm;

// 405 at 30 -> "13½ sq"; non half-steps get "≈"
export function formatSquares(cm: number, squareCm: number): string {
  const s = toSquares(cm, squareCm);
  const halves = Math.round(s * 2);
  if (Math.abs(s * 2 - halves) < 1e-6) {
    const whole = Math.floor(halves / 2);
    const half = halves % 2 === 1;
    return (half ? (whole === 0 ? '½' : whole + '½') : String(whole)) + ' sq';
  }
  return '≈' + trim(s.toFixed(2)) + ' sq';
}

// "13½ sq · 4.05 m"
export const formatBoth = (cm: number, squareCm: number): string => formatSquares(cm, squareCm) + ' · ' + formatM(cm);

export type ParseResult = { ok: true; cm: number } | { ok: false; error: string };

// Reads what was typed in a length box, in cm or squares
export function parseLength(input: string, unit: 'cm' | 'sq', squareCm: number): ParseResult {
  const s = input.trim().replace(',', '.');
  if (!s) return { ok: false, error: 'Enter a number' };
  let n: number;
  if (unit === 'cm') {
    if (!/^-?\d+(\.\d+)?$/.test(s) && !/^-?\d+(\.\d+)?e\d+$/i.test(s)) return { ok: false, error: 'Enter a number' };
    n = Number(s);
  } else {
    const m = s.match(/^(-?\d+(?:\.\d+)?)?\s*(½|1\/2)?$/);
    if (!m || (!m[1] && !m[2])) return { ok: false, error: 'Enter a number' };
    n = (m[1] ? Number(m[1]) : 0) + (m[2] ? 0.5 : 0);
  }
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number' };
  if (n <= 0) return { ok: false, error: 'Must be more than 0' };
  if (unit === 'sq' && Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) return { ok: false, error: 'Use whole or half squares' };
  const cm = unit === 'cm' ? n : n * squareCm;
  if (cm > 5000) return { ok: false, error: 'Too large (max 50 m)' };
  return { ok: true, cm };
}

// Same as parseLength but zero is allowed (for offsets and heights off the floor)
export function parseOffset(input: string, unit: 'cm' | 'sq', squareCm: number): ParseResult {
  if (/^\s*0+(\.0+)?\s*$/.test(input)) return { ok: true, cm: 0 };
  return parseLength(input, unit, squareCm);
}
