import { describe, it, expect } from 'vitest';
import { formatBoth, formatM, parseLength, formatCm } from '../../src/model/units';
import { LEVELS, levelForHeight } from '../../src/model/levels';

describe('units', () => {
  it('formats', () => {
    expect(formatBoth(405, 30)).toBe('13½ sq · 4.05 m');
    expect(formatBoth(300, 30)).toBe('10 sq · 3.00 m');
    expect(formatM(622.5)).toBe('6.225 m');
    expect(formatCm(16.5)).toBe('16.5 cm');
    expect(formatCm(402)).toBe('402 cm');
  });
  it('parses', () => {
    expect(parseLength('13½', 'sq', 30)).toEqual({ ok: true, cm: 405 });
    expect(parseLength('13 1/2', 'sq', 30)).toEqual({ ok: true, cm: 405 });
    expect(parseLength('13.5', 'sq', 30)).toEqual({ ok: true, cm: 405 });
    expect(parseLength('13.3', 'sq', 30)).toEqual({ ok: false, error: 'Use whole or half squares' });
    for (const bad of ['', 'abc', '0', '-5']) expect(parseLength(bad, 'cm', 30).ok).toBe(false);
    expect(parseLength('1e9', 'cm', 30)).toEqual({ ok: false, error: 'Too large (max 50 m)' });
    expect(parseLength('402', 'cm', 30)).toEqual({ ok: true, cm: 402 });
  });
  it('levels', () => {
    expect(levelForHeight(0).n).toBe(1); expect(levelForHeight(60).n).toBe(2);
    expect(levelForHeight(85).n).toBe(4); expect(levelForHeight(220).n).toBe(5);
    expect(LEVELS.map(l => l.cm)).toEqual([0, 45, 75, 90, 150]);
  });
});
describe('squares precision', () => {
  it('shows quarter squares instead of hiding them', async () => {
    const { formatSquares } = await import('../../src/model/units');
    expect(formatSquares(307.5, 30)).toBe('≈10.25 sq');
    expect(formatSquares(622.5, 30)).toBe('≈20.75 sq');
  });
});
