import type { SupabaseClient } from '@supabase/supabase-js';
import type { Place } from '../model/types';
import { newId } from '../model/types';

export interface PlaceRow { id: string; name: string; doc: Place; thumb: string | null; version: number; updated_at: string }
export type PlaceSummary = Omit<PlaceRow, 'doc'> & { rooms: number; pieces: number };
export type SaveResult =
  | { ok: true; row: PlaceRow }
  | { ok: false; conflict: PlaceRow }
  | { ok: false; offline: true }
  | { ok: false; unreachable: true }
  | { ok: false; auth: true }
  | { ok: false; error: string };

export interface Repo {
  listPlaces(): Promise<PlaceSummary[]>;
  getPlace(id: string): Promise<PlaceRow | null>;
  createPlace(doc: Place, thumb: string | null): Promise<PlaceRow>;
  savePlace(id: string, doc: Place, thumb: string | null, expectedVersion: number): Promise<SaveResult>;
  deletePlace(id: string): Promise<void>;
}

// Sorts a failed request into offline / database asleep / signed out / other
export function classify(err: unknown, status?: number): SaveResult {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, offline: true };
  if (err instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) return { ok: false, offline: true };
  if (status === 401 || status === 403 || /jwt|auth|permission|row-level/i.test(msg)) return { ok: false, auth: true };
  if ((status ?? 0) >= 500 || status === 0 || /paused|unavailable|timeout/i.test(msg)) return { ok: false, unreachable: true };
  return { ok: false, error: msg || 'Save failed' };
}

const SUMMARY = 'id,name,thumb,version,updated_at,doc->rooms,doc->items';

// Reads and writes places in the Supabase "places" table
export function makeRepo(client: SupabaseClient): Repo {
  const t = () => client.from('places');
  return {
    async listPlaces() {
      const { data, error } = await t().select(SUMMARY).order('updated_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as (Omit<PlaceRow, 'doc'> & { rooms: unknown[]; items: { removed: boolean }[] })[]).map(r => ({
        id: r.id, name: r.name, thumb: r.thumb, version: r.version, updated_at: r.updated_at,
        rooms: r.rooms?.length ?? 0, pieces: (r.items ?? []).filter(i => !i.removed).length,
      }));
    },
    async getPlace(id) {
      const { data, error } = await t().select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return (data as PlaceRow) ?? null;
    },
    async createPlace(doc, thumb) {
      const { data, error } = await t().insert({ id: doc.id, name: doc.name, doc, thumb }).select('*').single();
      if (error) throw error;
      return data as PlaceRow;
    },
    async savePlace(id, doc, thumb, expectedVersion) {
      try {
        const patch: Record<string, unknown> = { name: doc.name, doc, version: expectedVersion + 1, updated_at: new Date().toISOString() };
        if (thumb) patch.thumb = thumb;
        const { data, error, status } = await t().update(patch).eq('id', id).eq('version', expectedVersion).select('*');
        if (error) return classify(error, status);
        if (data && data.length) return { ok: true, row: data[0] as PlaceRow };
        const { data: cur, error: e2, status: s2 } = await t().select('*').eq('id', id).maybeSingle();
        if (e2) return classify(e2, s2);
        if (!cur) {
          // the row is gone (deleted on another device): save it again rather than lose the work
          const { data: ins, error: e3, status: s3 } = await t().insert({ id, name: doc.name, doc, thumb, version: expectedVersion + 1 }).select('*').single();
          if (e3) return classify(e3, s3);
          return { ok: true, row: ins as PlaceRow };
        }
        return { ok: false, conflict: cur as PlaceRow };
      } catch (e) {
        return classify(e);
      }
    },
    async deletePlace(id) {
      const { error } = await t().delete().eq('id', id);
      if (error) throw error;
    },
  };
}

// A copy of a place with all-new ids (stacking and overlap links follow)
export function duplicateDoc(doc: Place, newName: string): Place {
  const map = new Map<string, string>();
  const nid = (old: string) => { if (!map.has(old)) map.set(old, newId()); return map.get(old)!; };
  const d = structuredClone(doc);
  d.id = newId(); d.name = newName;
  for (const r of d.rooms) {
    r.id = nid(r.id);
    for (const o of r.openings) o.id = newId();
    for (const b of r.builtIns) b.id = newId();
  }
  for (const i of d.items) i.id = nid(i.id);
  for (const i of d.items) {
    i.roomId = nid(i.roomId);
    i.sitsOn = i.sitsOn ? nid(i.sitsOn) : null;
    i.allowOverlapWith = i.allowOverlapWith.map(nid);
  }
  return d;
}

// Stand-in database kept in this browser, used when the app has no Supabase settings
export function makeLocalRepo(storage: Storage = localStorage): Repo {
  const KEY = 'sp:local-db';
  const load = (): Record<string, PlaceRow> => { try { return JSON.parse(storage.getItem(KEY) || '{}'); } catch { return {}; } };
  const save = (db: Record<string, PlaceRow>) => storage.setItem(KEY, JSON.stringify(db));
  return {
    async listPlaces() {
      return Object.values(load()).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(({ doc, ...r }) => ({ ...r, rooms: doc.rooms.length, pieces: doc.items.filter(i => !i.removed).length }));
    },
    async getPlace(id) { return load()[id] ?? null; },
    async createPlace(doc, thumb) {
      const db = load(); const row = { id: doc.id, name: doc.name, doc, thumb, version: 1, updated_at: new Date().toISOString() };
      db[doc.id] = row; save(db); return row;
    },
    async savePlace(id, doc, thumb, expected) {
      const db = load(), cur = db[id];
      if (cur && cur.version !== expected) return { ok: false, conflict: cur };
      const row = { id, name: doc.name, doc, thumb: thumb ?? cur?.thumb ?? null, version: expected + 1, updated_at: new Date().toISOString() };
      db[id] = row; save(db); return { ok: true, row };
    },
    async deletePlace(id) { const db = load(); delete db[id]; save(db); },
  };
}
