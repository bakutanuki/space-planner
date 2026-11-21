import type { PlaceSummary, Repo } from '../data/repo';
import { classify, duplicateDoc } from '../data/repo';
import { dropCached } from '../data/cache';
import { emptyPlace } from '../model/types';
import { confirmDialog, h, promptDialog, relTime, sheet, toast } from './dom';
import { makeThumbnail } from './editor/thumbnail';

export const PAUSED_HELP = "Can't reach your database. Free Supabase projects pause after about a week without use. Open supabase.com, pick your project and press Restore, then try again. Your changes are kept on this device meanwhile.";

// Sign-in screen
export function showSignIn(root: HTMLElement, onSignIn: () => void, error?: string) {
  root.replaceChildren(h('div', { class: 'center' },
    h('h1', null, 'Space Planner'),
    h('p', null, 'Try furniture layouts on screen at true size, so the real furniture only moves once.'),
    error ? h('p', { class: 'warnbox' }, error) : null,
    h('button', { type: 'button', class: 'primary', onclick: onSignIn }, 'Sign in with GitHub')));
}

// The "My places" list with new / rename / duplicate / delete
export async function showHome(root: HTMLElement, repo: Repo, opts: { open: (id: string) => void; signOut?: () => void; localOnly: boolean; onFirstRun: () => Promise<void> }) {
  const listEl = h('div', { class: 'wrap' });
  const header = h('header', { class: 'bar' }, h('h1', null, 'My places'),
    h('button', { type: 'button', class: 'primary', onclick: () => newPlace() }, '+ New place'),
    opts.signOut ? h('button', { type: 'button', 'aria-label': 'Account', onclick: () => account() }, '⋯') : null);
  root.replaceChildren(header, h('div', { class: 'page' }, listEl));
  listEl.append(h('p', { class: 'muted' }, 'Loading…'));

  function account() {
    const close = sheet('Account', [h('button', { type: 'button', onclick: () => { close(); opts.signOut!(); } }, 'Sign out')]);
  }

  async function load() {
    let places: PlaceSummary[];
    try {
      places = await repo.listPlaces();
      try { localStorage.setItem('sp:list', JSON.stringify(places)); } catch { /* full */ }
    } catch (e) {
      const c = classify(e);
      let cached: PlaceSummary[] = [];
      try { cached = JSON.parse(localStorage.getItem('sp:list') || '[]'); } catch { /* none */ }
      render(cached, 'offline' in c ? "You're offline. Showing the places this device knows; changes save when you're back online." : 'auth' in c ? 'Your sign-in expired. Reload the page to sign in again.' : 'error' in c ? c.error : PAUSED_HELP);
      return;
    }
    if (!places.length && !localStorage.getItem('sp:seeded')) {
      await opts.onFirstRun();
      try { localStorage.setItem('sp:seeded', '1'); } catch { /* ignore */ }
      places = await repo.listPlaces();
    }
    render(places);
  }

  function render(places: PlaceSummary[], banner?: string) {
    listEl.replaceChildren(
      ...(opts.localOnly ? [h('div', { class: 'banner' }, 'This copy of the app has no database settings, so places are saved in this browser only.')] : []),
      ...(banner ? [h('div', { class: 'banner' }, banner, ' ', h('button', { type: 'button', onclick: () => load() }, 'Try again'))] : []),
      ...(places.length ? places.map(card) : [h('p', { class: 'muted' }, 'No places yet. Press + New place to start.')]));
  }

  function card(p: PlaceSummary) {
    return h('div', { class: 'card' },
      h('button', { type: 'button', class: 'open', onclick: () => opts.open(p.id) },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('div', { class: 'noimg' }),
        h('div', { class: 'meta' }, h('b', null, p.name), h('span', null, `${p.mine ? '' : 'Shared with you · '}${p.rooms} room${p.rooms === 1 ? '' : 's'} · ${p.pieces} piece${p.pieces === 1 ? '' : 's'} · ${relTime(p.updated_at)}`))),
      h('button', { type: 'button', 'aria-label': 'Options for ' + p.name, onclick: () => menu(p) }, '⋯'));
  }

  function menu(p: PlaceSummary) {
    const close = sheet(p.name, [h('div', { class: 'list' },
      h('button', { type: 'button', onclick: () => { close(); rename(p); } }, 'Rename'),
      h('button', { type: 'button', onclick: () => { close(); duplicate(p); } }, 'Duplicate'),
      ...(repo.sharing && p.mine ? [h('button', { type: 'button', onclick: () => { close(); share(p); } }, 'Share…')] : []),
      p.mine ? h('button', { type: 'button', class: 'warn', onclick: () => { close(); remove(p); } }, 'Delete')
        : h('button', { type: 'button', class: 'warn', onclick: () => { close(); leave(p); } }, 'Leave this shared place'))]);
  }

  async function newPlace() {
    const name = await promptDialog('New place', 'Name', '', 'Create');
    if (!name) return;
    try { const doc = { ...emptyPlace(name) }; await repo.createPlace(doc, makeThumbnail(doc)); opts.open(doc.id); }
    catch (e) { toast(errText(e)); }
  }
  async function rename(p: PlaceSummary) {
    const name = await promptDialog('Rename', 'Name', p.name, 'Save');
    if (!name || name === p.name) return;
    try {
      const row = await repo.getPlace(p.id); if (!row) return load();
      const r = await repo.savePlace(p.id, { ...row.doc, name }, row.thumb, row.version);
      if (!r.ok) toast('conflict' in r ? 'It changed on another device; try again' : 'Rename failed: ' + errText(r));
      dropCached(p.id); load();
    } catch (e) { toast(errText(e)); }
  }
  async function duplicate(p: PlaceSummary) {
    try {
      const row = await repo.getPlace(p.id); if (!row) return load();
      const doc = duplicateDoc(row.doc, p.name + ' (copy)');
      await repo.createPlace(doc, row.thumb); load(); toast('Duplicated');
    } catch (e) { toast(errText(e)); }
  }
  async function share(p: PlaceSummary) {
    const sh = repo.sharing!;
    try {
      const [code, n] = await Promise.all([sh.share(p.id), sh.memberCount(p.id)]);
      const link = `${location.origin}/#/join/${code}`;
      const input = h('input', { value: link, readonly: true, onfocus: (e: Event) => (e.target as HTMLInputElement).select() });
      const close = sheet('Share ' + p.name, [
        h('p', { class: 'muted' }, 'Anyone who opens this link and signs in with GitHub can see and edit this place. Send it only to people you trust.'),
        input,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'primary', onclick: async () => {
            if ('share' in navigator) { try { await navigator.share({ title: p.name, url: link }); return; } catch { /* cancelled */ } }
            try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { input.select(); toast('Select the link and copy it'); }
          } }, 'share' in navigator ? 'Send link' : 'Copy link'),
          h('button', { type: 'button', onclick: () => close() }, 'Done')),
        h('p', { class: 'muted' }, n ? `Shared with ${n} ${n === 1 ? 'person' : 'people'}.` : 'Nobody has joined yet.'),
        h('button', { type: 'button', class: 'warn', onclick: async () => {
          if (!(await confirmDialog('Stop sharing? The link stops working and everyone else loses access.', 'Stop sharing'))) return;
          try { await sh.unshare(p.id); close(); toast('Sharing stopped'); } catch (e) { toast(errText(e)); }
        } }, 'Stop sharing')]);
    } catch (e) { toast(errText(e)); }
  }
  async function leave(p: PlaceSummary) {
    if (!(await confirmDialog(`Leave ${p.name}? It stays with its owner; you'll need a new link to come back.`, 'Leave'))) return;
    try { await repo.sharing!.leave(p.id); dropCached(p.id); load(); } catch (e) { toast(errText(e)); }
  }
  async function remove(p: PlaceSummary) {
    if (!(await confirmDialog(`Delete ${p.name}? This can't be undone, and anyone it's shared with loses it too.`, 'Delete'))) return;
    try { await repo.deletePlace(p.id); dropCached(p.id); load(); } catch (e) { toast(errText(e)); }
  }
  await load();
}

function errText(e: unknown): string {
  const c = classify(e);
  if ('offline' in c) return "You're offline; try again when connected";
  if ('unreachable' in c) return PAUSED_HELP;
  if ('auth' in c) return 'Sign-in expired; reload to sign in again';
  return 'error' in c ? c.error : 'Something went wrong';
}
