import './styles.css';
import type { User } from '@supabase/supabase-js';
import { supabase } from './data/supabase';
import { getUser, onAuthChange, signInWithEmail, signInWithGitHub, signOut } from './data/auth';
import { makeLocalRepo, makeRepo, type PlaceRow } from './data/repo';
import { listCachedDirty, readCached, writeCached } from './data/cache';
import { createSaveQueue, type SaveQueue, type SaveStatus } from './data/saveQueue';
import { seedApartment } from './model/seed';
import type { Place } from './model/types';
import { h, sheet, toast } from './ui/dom';
import { PAUSED_HELP, showHome, showSignIn } from './ui/home';
import { mountEditor, type EditorApi } from './ui/editor/editor';
import { makeThumbnail } from './ui/editor/thumbnail';

const root = document.getElementById('app')!;
const localOnly = !supabase;
const repo = supabase ? makeRepo(supabase) : makeLocalRepo();
let user: User | null = null;
let editor: EditorApi | null = null, queue: SaveQueue | null = null, editorId: string | null = null;

// Leaves the editor cleanly: saves the last change and a fresh thumbnail
async function closeEditor() {
  if (!editor || !queue) return;
  const doc = editor.current();
  queue.push(doc, makeThumbnail(doc));
  await Promise.race([queue.flush(), new Promise(r => setTimeout(r, 4000))]);
  queue.dispose(); editor.destroy();
  editor = null; queue = null; editorId = null;
}

async function route() {
  // invite links: remember the code through sign-in, then join and open the place
  const j = location.hash.match(/^#\/join\/([\w-]+)/);
  if (j) { try { localStorage.setItem('sp:join', j[1]); } catch { /* ignore */ } history.replaceState(null, '', location.pathname); }
  let pendingJoin: string | null = null;
  try { pendingJoin = localStorage.getItem('sp:join'); } catch { /* ignore */ }
  if (pendingJoin && (localOnly || user) && repo.sharing) {
    try { localStorage.removeItem('sp:join'); } catch { /* ignore */ }
    try {
      const id = await repo.sharing.join(pendingJoin);
      if (id) { location.hash = '#/place/' + id; return; }
      toast('That share link no longer works. Ask for a new one.');
    } catch (e) { toast('Could not join: ' + String((e as Error).message ?? e)); }
  }
  const m = location.hash.match(/^#\/place\/([\w-]+)/);
  if (editorId && (!m || m[1] !== editorId)) await closeEditor();
  if (!localOnly && !user) return showSignIn(root, () => signInWithGitHub().catch(e => toast(String(e.message ?? e))), signInWithEmail);
  if (m) { if (editorId !== m[1]) await openEditor(m[1]); return; }
  void syncDirty();
  await showHome(root, repo, {
    open: id => { location.hash = '#/place/' + id; },
    signOut: localOnly ? undefined : async () => { await signOut(); user = null; route(); },
    localOnly,
    onFirstRun: async () => { if (localStorage.getItem('sp:join')) return; const doc = seedApartment(); await repo.createPlace(doc, makeThumbnail(doc)); },
  });
}

// Saves changes this device still holds for places that aren't open (e.g. made while signed out)
async function syncDirty() {
  for (const id of listCachedDirty()) {
    if (id === editorId) continue;
    const c = readCached(id)!;
    const q = createSaveQueue(repo, id, c.version, { startDirty: c.doc });
    await q.flush(); q.dispose();
  }
}

const STATUS: Record<SaveStatus, [string, string]> = {
  saved: ['Saved', 'okk'], saving: ['Saving…', ''], offline: ['Offline, will save', 'bad'], retrying: ['Not saved, retrying', 'bad'],
  unreachable: ["Can't reach database", 'bad'], signedout: ['Signed out, not saved', 'bad'], conflict: ['Changed elsewhere', 'bad'],
};

async function openEditor(id: string) {
  editorId = id;
  root.replaceChildren(h('div', { class: 'center' }, h('p', null, 'Opening…')));
  const cached = readCached(id);
  let row: PlaceRow | null = null, failed = false;
  try { row = await repo.getPlace(id); } catch { failed = true; }
  if (editorId !== id) return;
  let doc: Place, version: number, dirty = false;
  if (cached?.dirty) { doc = cached.doc; version = cached.version; dirty = true; }
  else if (row) { doc = row.doc; version = row.version; writeCached(id, { doc, version, dirty: false, thumb: row.thumb }); }
  else if (cached) { doc = cached.doc; version = cached.version; }
  else {
    root.replaceChildren(h('div', { class: 'center' }, h('p', null, failed ? PAUSED_HELP : 'This place no longer exists.'), h('button', { type: 'button', onclick: () => { editorId = null; location.hash = '#/'; } }, 'Back to my places')));
    return;
  }
  queue = createSaveQueue(repo, id, version, dirty ? { startDirty: doc } : {});
  editor = mountEditor(root, doc, p => queue?.push(p), () => { location.hash = '#/'; });
  const q = queue, ed = editor;
  const show = (s: SaveStatus) => {
    const [text, cls] = STATUS[s];
    ed.setStatus(text, cls, s === 'unreachable' ? () => toast(PAUSED_HELP) : s === 'signedout' ? () => signInWithGitHub() : s === 'retrying' || s === 'offline' ? () => q.retryNow() : undefined);
  };
  q.onStatus((s, conflict) => { show(s); if (s === 'conflict' && conflict) askConflict(q, ed); });
  show(q.status);
}

// "Changed on another device": you pick which version to keep
function askConflict(q: SaveQueue, ed: EditorApi) {
  let chosen = false;
  const choose = async (c: 'mine' | 'theirs') => { chosen = true; close(); const doc = await q.resolve(c); if (c === 'theirs') ed.replacePlace(doc); };
  const close = sheet('This place was changed somewhere else', [
    h('p', { class: 'muted' }, 'It was changed on another device, or by someone you share it with. Pick which version to keep; the other one will be replaced.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', onclick: () => choose('mine') }, 'Keep mine (this device)'),
      h('button', { type: 'button', onclick: () => choose('theirs') }, 'Use the other version')),
  ], { onClose: () => { if (!chosen) setTimeout(() => askConflict(q, ed), 0); } });
}

window.addEventListener('hashchange', () => void route());
window.addEventListener('beforeunload', e => { if (queue && queue.status !== 'saved') { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  if (!localOnly) {
    try { user = await getUser(); } catch { user = null; }
    onAuthChange(u => {
      const was = user; user = u;
      if (u && queue) queue.retryNow();
      if (!!was !== !!u && !editor) void route();
    });
    if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
  }
  await route();
})();
