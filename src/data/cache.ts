import type { Place } from '../model/types';

export interface CacheEntry { doc: Place; version: number; dirty: boolean; thumb?: string | null }
const k = (id: string) => 'sp:place:' + id;

// The copy of a place kept on this device
export function readCached(id: string): CacheEntry | null {
  try { const s = localStorage.getItem(k(id)); return s ? JSON.parse(s) : null; } catch { return null; }
}

// Keeps a copy of a place on this device; false if the device refused
export function writeCached(id: string, e: CacheEntry): boolean {
  try { localStorage.setItem(k(id), JSON.stringify(e)); return true; } catch { return false; }
}

// Forget this device's copy
export function dropCached(id: string): void { try { localStorage.removeItem(k(id)); } catch { /* ignore */ } }

// Places with changes that haven't reached the database yet
export function listCachedDirty(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sp:place:')) { const e = readCached(key.slice(9)); if (e?.dirty) out.push(key.slice(9)); }
    }
  } catch { /* ignore */ }
  return out;
}
