import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSaveQueue } from '../../src/data/saveQueue';
import { makeLocalRepo, duplicateDoc, type Repo } from '../../src/data/repo';
import { readCached } from '../../src/data/cache';
import { seedApartment } from '../../src/model/seed';

class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); } getItem(k: string) { return this.m.get(k) ?? null; } key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); } setItem(k: string, v: string) { this.m.set(k, v); }
}
beforeEach(() => { (globalThis as any).localStorage = new Mem(); vi.useFakeTimers(); });
const flush = async () => { for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(100); } };

describe('save queue', () => {
  it('debounces to one save with the last doc', async () => {
    const repo = makeLocalRepo(new Mem()); const p = seedApartment(); await repo.createPlace(p, null);
    const spy = vi.spyOn(repo, 'savePlace');
    const q = createSaveQueue(repo, p.id, 1);
    for (let i = 0; i < 5; i++) q.push({ ...p, name: 'v' + i });
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await repo.getPlace(p.id))!.doc.name).toBe('v4');
    expect(q.status).toBe('saved');
    expect(readCached(p.id)!.dirty).toBe(false);
  });

  it('offline keeps the change on the device, then saves', async () => {
    const base = makeLocalRepo(new Mem()); const p = seedApartment(); await base.createPlace(p, null);
    let online = false;
    const repo: Repo = { ...base, savePlace: (...a) => (online ? base.savePlace(...a) : Promise.resolve({ ok: false, offline: true })) };
    const q = createSaveQueue(repo, p.id, 1);
    q.push({ ...p, name: 'offline edit' });
    await flush();
    expect(q.status).toBe('offline'); expect(readCached(p.id)!.dirty).toBe(true);
    online = true; await vi.advanceTimersByTimeAsync(3000); await flush();
    expect(q.status).toBe('saved'); expect(readCached(p.id)!.dirty).toBe(false);
  });

  it('conflict: never overwrites silently', async () => {
    const repo = makeLocalRepo(new Mem()); const p = seedApartment(); await repo.createPlace(p, null);
    const a = createSaveQueue(repo, p.id, 1), b = createSaveQueue(repo, p.id, 1);
    a.push({ ...p, name: 'A' }); await flush();
    b.push({ ...p, name: 'B' }); await flush();
    expect(b.status).toBe('conflict');
    expect((await repo.getPlace(p.id))!.doc.name).toBe('A');
    await b.resolve('mine'); await flush();
    const row = (await repo.getPlace(p.id))!;
    expect(row.doc.name).toBe('B'); expect(row.version).toBe(3);
  });

  it('conflict: use the other version', async () => {
    const repo = makeLocalRepo(new Mem()); const p = seedApartment(); await repo.createPlace(p, null);
    const a = createSaveQueue(repo, p.id, 1), b = createSaveQueue(repo, p.id, 1);
    a.push({ ...p, name: 'A' }); await flush();
    b.push({ ...p, name: 'B' }); await flush();
    const doc = await b.resolve('theirs');
    expect(doc.name).toBe('A'); expect(readCached(p.id)!.dirty).toBe(false);
  });

  it('signed out: keeps edits and saves after sign-in', async () => {
    const base = makeLocalRepo(new Mem()); const p = seedApartment(); await base.createPlace(p, null);
    let signedIn = false;
    const repo: Repo = { ...base, savePlace: (...a) => (signedIn ? base.savePlace(...a) : Promise.resolve({ ok: false, auth: true })) };
    const q = createSaveQueue(repo, p.id, 1);
    q.push({ ...p, name: 'while signed out' }); await flush();
    expect(q.status).toBe('signedout'); expect(readCached(p.id)!.dirty).toBe(true);
    signedIn = true; q.retryNow(); await flush();
    expect(q.status).toBe('saved');
    expect((await base.getPlace(p.id))!.doc.name).toBe('while signed out');
  });
});

describe('duplicate', () => {
  it('remaps ids', () => {
    const p = seedApartment(); const d = duplicateDoc(p, 'Copy');
    const tv = d.items.find(i => i.name === 'TV')!, stand = d.items.find(i => i.name === 'TV stand')!;
    expect(tv.sitsOn).toBe(stand.id);
    const oldIds = new Set([p.id, ...p.rooms.map(r => r.id), ...p.items.map(i => i.id)]);
    for (const id of [d.id, ...d.rooms.map(r => r.id), ...d.items.map(i => i.id)]) expect(oldIds.has(id)).toBe(false);
    expect(d.items.every(i => d.rooms.some(r => r.id === i.roomId))).toBe(true);
  });
});
