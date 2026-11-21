import type { Place } from '../model/types';
import type { PlaceRow, Repo } from './repo';
import { writeCached } from './cache';

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'retrying' | 'conflict' | 'unreachable' | 'signedout';
export interface SaveQueue {
  push(doc: Place, thumb?: string | null): void;
  readonly status: SaveStatus;
  readonly version: number;
  onStatus(cb: (s: SaveStatus, conflict?: PlaceRow) => void): () => void;
  resolve(choice: 'mine' | 'theirs'): Promise<Place>;
  flush(): Promise<void>;
  retryNow(): void;
  dispose(): void;
}

const BACKOFF = [2000, 5000, 15000, 30000];

// Saves a place shortly after each change, keeps a device copy, retries, and stops on conflicts
export function createSaveQueue(repo: Repo, id: string, initialVersion: number, opts: { debounceMs?: number; startDirty?: Place } = {}): SaveQueue {
  const debounce = opts.debounceMs ?? 800;
  let version = initialVersion, status: SaveStatus = 'saved';
  let pending: { doc: Place; thumb: string | null } | null = opts.startDirty ? { doc: opts.startDirty, thumb: null } : null;
  let timer: ReturnType<typeof setTimeout> | null = null, attempt = 0, inFlight: Promise<void> | null = null;
  let conflictRow: PlaceRow | undefined, disposed = false;
  const subs = new Set<(s: SaveStatus, c?: PlaceRow) => void>();
  const set = (s: SaveStatus) => { status = s; subs.forEach(cb => cb(s, conflictRow)); };
  const schedule = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void run(); }, ms); };

  async function run(): Promise<void> {
    if (disposed || !pending || status === 'conflict') return;
    if (inFlight) { await inFlight; return run(); }
    const job = pending;
    set('saving');
    inFlight = (async () => {
      const r = await repo.savePlace(id, job.doc, job.thumb, version);
      if (r.ok) {
        version = r.row.version; attempt = 0;
        if (pending === job) { pending = null; writeCached(id, { doc: job.doc, version, dirty: false, thumb: r.row.thumb }); set('saved'); }
        else { writeCached(id, { doc: pending!.doc, version, dirty: true }); schedule(0); }
      } else if ('conflict' in r) {
        conflictRow = r.conflict; set('conflict');
      } else {
        set('offline' in r ? 'offline' : 'unreachable' in r ? 'unreachable' : 'auth' in r ? 'signedout' : 'retrying');
        schedule(BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
      }
    })();
    try { await inFlight; } finally { inFlight = null; }
  }

  const onOnline = () => { if (pending) { attempt = 0; schedule(0); } };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  if (pending) schedule(0);

  return {
    push(doc, thumb = null) {
      pending = { doc, thumb: thumb ?? pending?.thumb ?? null };
      writeCached(id, { doc, version, dirty: true });
      if (status !== 'conflict') { if (status === 'saved') set('saving'); schedule(debounce); }
    },
    get status() { return status; },
    get version() { return version; },
    onStatus(cb) { subs.add(cb); return () => subs.delete(cb); },
    async resolve(choice) {
      const row = conflictRow!;
      conflictRow = undefined;
      version = row.version;
      if (choice === 'theirs') {
        pending = null; writeCached(id, { doc: row.doc, version, dirty: false, thumb: row.thumb }); set('saved');
        return row.doc;
      }
      set('saving'); await run();
      return pending?.doc ?? row.doc;
    },
    async flush() { if (timer) { clearTimeout(timer); timer = null; } if (pending && status !== 'conflict') await run(); else if (inFlight) await inFlight; },
    retryNow() { attempt = 0; if (pending && status !== 'conflict') schedule(0); },
    dispose() { disposed = true; if (timer) clearTimeout(timer); if (typeof window !== 'undefined') window.removeEventListener('online', onOnline); subs.clear(); },
  };
}
