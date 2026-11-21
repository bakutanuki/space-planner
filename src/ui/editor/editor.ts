import type { Item, Place, Pt } from '../../model/types';
import { squareOf } from '../../model/types';
import { roomBox, wallOf } from '../../model/rooms';
import { findOverlaps } from '../../model/overlap';
import { distancesToWalls, halfExtents, snapPoint } from '../../model/placement';
import { effectiveElevation } from '../../model/stacking';
import { LEVELS, levelForHeight } from '../../model/levels';
import { formatCm } from '../../model/units';
import { allowOverlap, moveItem, removeItem, restoreItem, rotateItem, setItemLevel } from '../../model/edit';
import type { Box } from '../../model/geometry';
import { h, sheet, toast } from '../dom';
import { SceneView } from './scene';
import { openBuiltInForm, openFurnitureForm, openItemEditor, openOpeningForm, openRoomForm, openRoomsSheet, openSettings } from './forms';

export interface EditorApi { destroy(): void; setStatus(text: string, cls: string, onClick?: () => void): void; replacePlace(p: Place): void; current(): Place }

// The editor screen: plan/3D view, dragging, selection panel, forms
export function mountEditor(root: HTMLElement, initial: Place, onChange: (p: Place) => void, onBack: () => void): EditorApi {
  let place = initial, selected: string | null = null, scope: string = initial.rooms[0]?.id ?? 'all', tint = false;
  let wallMark: { roomId: string; wall: number } | null = null;

  const status = h('button', { type: 'button', class: 'ghost status', 'aria-live': 'polite' });
  const viewBtn = h('button', { type: 'button', 'aria-label': 'Show 3D view', onclick: () => setMode(scene.mode === '2d' ? '3d' : '2d') }, '3D');
  const title = h('h1', null, place.name);
  const bar = h('header', { class: 'bar' },
    h('button', { type: 'button', class: 'ghost', 'aria-label': 'Back to my places', onclick: onBack }, '‹'), title, status, viewBtn,
    h('button', { type: 'button', 'aria-label': 'More', onclick: () => moreMenu() }, '⋯'));
  const scopes = h('nav', { class: 'scopes', 'aria-label': 'Choose what to show' });
  const overlay = h('canvas', { class: 'overlay2d' });
  const legend = h('div', { class: 'legend', style: { display: 'none' } }, ...LEVELS.map(l => h('span', null, h('i', { style: { background: l.color } }), `${l.n} ${l.name} · ${formatCm(l.cm)}`)));
  const stage = h('div', { class: 'stage' }, overlay, legend);
  const info = h('div', { class: 'info' }), actions = h('div', { class: 'row' }), levels = h('div', { class: 'levels' }), removed = h('div', { class: 'row' });
  const panel = h('div', { class: 'panel' }, info, levels, actions, removed);
  root.replaceChildren(bar, scopes, stage, panel);
  const scene = new SceneView(stage);
  scene.onRender = () => drawOverlay();

  const commit = (p: Place, save = true) => { place = p; title.textContent = p.name; if (save) onChange(p); refresh(); };
  const hooks = { highlightWall: (roomId: string | null, wall: number) => { wallMark = roomId ? { roomId, wall } : null; scene.requestRender(); } };
  const sel = () => place.items.find(i => i.id === selected && !i.removed) ?? null;
  const scopeRoomId = () => (scope !== 'all' && place.rooms.some(r => r.id === scope) ? scope : sel()?.roomId ?? place.rooms[0]?.id ?? '');

  function scopeBox(): Box {
    const rs = scope === 'all' ? place.rooms : place.rooms.filter(r => r.id === scope);
    const bs = (rs.length ? rs : place.rooms).map(roomBox), t = place.wallThickness;
    if (!bs.length) return { x0: -150, z0: -150, x1: 150, z1: 150 };
    return { x0: Math.min(...bs.map(b => b.x0)) - t, z0: Math.min(...bs.map(b => b.z0)) - t, x1: Math.max(...bs.map(b => b.x1)) + t, z1: Math.max(...bs.map(b => b.z1)) + t };
  }
  function setMode(m: '2d' | '3d') {
    scene.setMode(m); viewBtn.textContent = m === '2d' ? '3D' : '2D';
    viewBtn.setAttribute('aria-label', m === '2d' ? 'Show 3D view' : 'Show flat plan');
    refresh(); scene.frame(scopeBox());
  }
  function renderScopes() {
    const opts: [string, string][] = [...place.rooms.map(r => [r.id, r.name] as [string, string]), ...(place.rooms.length > 1 ? [['all', 'All'] as [string, string]] : [])];
    if (!opts.some(o => o[0] === scope)) scope = opts[0]?.[0] ?? 'all';
    scopes.replaceChildren(...opts.map(([id, name]) => h('button', { type: 'button', 'aria-pressed': String(id === scope), onclick: () => { scope = id; renderScopes(); scene.frame(scopeBox()); renderPanel(); } }, name)));
  }

  function refresh() {
    const overlaps = findOverlaps(place);
    scene.setPlace(place, { tint, overlaps: new Set(overlaps.keys()), selected });
    legend.style.display = tint ? '' : 'none';
    renderScopes(); renderPanel(overlaps);
  }

  function renderPanel(overlaps = findOverlaps(place)) {
    const it = sel();
    actions.replaceChildren(); levels.replaceChildren(); info.replaceChildren();
    if (it) {
      const elev = effectiveElevation(place, it), lvl = levelForHeight(elev);
      const parent = it.sitsOn ? place.items.find(i => i.id === it.sitsOn) : null;
      const bumps = (overlaps.get(it.id) ?? []).map(id => place.items.find(i => i.id === id)?.name).filter(Boolean);
      info.append(h('b', null, it.name), ' ', h('span', { class: 'num' }, `${formatCm(it.w)} × ${formatCm(it.d)} × ${formatCm(it.h)}`), h('br'),
        parent ? `Sits on ${parent.name} (bottom at ${formatCm(elev)}).` : elev > 0 ? `Bottom at ${formatCm(elev)} off the floor.` : 'On the floor.',
        ' Drag to move.',
        ...(bumps.length ? [h('div', { class: 'warnbox' }, 'Overlaps ' + bumps.join(', '))] : []));
      levels.append(...LEVELS.map(l => h('button', { type: 'button', title: `${l.name}, ${formatCm(l.cm)}`, 'aria-pressed': String(!parent && l.n === lvl.n && Math.abs(it.elevation - l.cm) < 0.01),
        style: { borderColor: l.color }, onclick: () => commit(setItemLevel(place, it.id, l.n).place) }, `${l.n} ${l.name}`)));
      actions.append(
        h('button', { type: 'button', onclick: () => apply(rotateItem(place, it.id, 90)) }, 'Turn 90°'),
        h('button', { type: 'button', onclick: () => apply(rotateItem(place, it.id, 15)) }, 'Turn 15°'),
        h('button', { type: 'button', onclick: () => openItemEditor(place, it.id, p => { commit(p); if (!p.items.some(i => i.id === it.id)) select(null); }) }, 'Edit'),
        ...(bumps.length ? [h('button', { type: 'button', onclick: () => commit(allowOverlap(place, it.id).place) }, 'Allow overlap')] : []),
        h('button', { type: 'button', class: 'warn', onclick: () => { const id = it.id; select(null); commit(removeItem(place, id).place); } }, 'Remove'),
        h('button', { type: 'button', class: 'primary', onclick: () => select(null) }, 'Done'));
    } else if (!place.rooms.length) {
      info.append('This place has no rooms yet. Add the first one by its width and depth.');
      actions.append(h('button', { type: 'button', class: 'primary', onclick: () => openRoomForm(place, p => { commit(p); scope = p.rooms[0].id; scene.frame(scopeBox()); }, hooks) }, '+ Room'));
    } else {
      info.append(`Tap a piece to pick it, then drag it. Pieces move between rooms only through doors. ${scene.mode === '2d' ? 'Drag empty space to move around' : 'Drag empty space to look around'}, pinch to zoom.`);
      actions.append(
        h('button', { type: 'button', class: 'primary', onclick: () => openFurnitureForm(place, scopeRoomId(), (p, id) => { commit(p); select(id); }) }, '+ Furniture'),
        h('button', { type: 'button', onclick: () => addMenu() }, '+ Room, door…'),
        h('button', { type: 'button', 'aria-pressed': String(tint), onclick: () => { tint = !tint; refresh(); } }, 'Height levels'));
    }
    const gone = place.items.filter(i => i.removed);
    removed.replaceChildren(...(gone.length ? [h('span', { class: 'muted' }, 'Removed:'), ...gone.map(g => h('button', { type: 'button', class: 'chip', onclick: () => { commit(restoreItem(place, g.id).place); select(g.id); } }, '+ ' + g.name))] : []));
  }

  function apply(r: { place: Place; error?: string }) { if (r.error) toast(r.error, stage); else commit(r.place); }
  function select(id: string | null) { selected = id; refresh(); }

  function addMenu() {
    const rid = scopeRoomId();
    const close = sheet('Add', [h('div', { class: 'list' },
      h('button', { type: 'button', onclick: () => { close(); openRoomForm(place, p => commit(p), hooks); } }, '+ Room'),
      h('button', { type: 'button', onclick: () => { close(); openOpeningForm(place, rid, p => commit(p), undefined, hooks); } }, '+ Door or window'),
      h('button', { type: 'button', onclick: () => { close(); openBuiltInForm(place, rid, p => commit(p), undefined, hooks); } }, '+ Built-in (closet, counter…)'),
      h('button', { type: 'button', onclick: () => { close(); openFurnitureForm(place, rid, (p, id) => { commit(p); select(id); }); } }, '+ Furniture'))]);
  }
  function moreMenu() {
    const close = sheet('More', [h('div', { class: 'list' },
      h('button', { type: 'button', onclick: () => { close(); openRoomsSheet(place, p => commit(p), hooks); } }, 'Rooms, doors, windows, built-ins'),
      h('button', { type: 'button', onclick: () => { close(); tint = !tint; refresh(); } }, tint ? 'Hide height levels' : 'Show height levels'),
      h('button', { type: 'button', onclick: () => { close(); openSettings(place, p => commit(p)); } }, 'Settings (squares, snapping, name)'),
      h('button', { type: 'button', onclick: () => { close(); savePicture(); } }, 'Save picture'))]);
  }

  async function savePicture() {
    const was = selected; selected = null; refresh();
    const blob = await scene.snapshot();
    selected = was; refresh();
    if (!blob) { toast('Could not make the picture', stage); return; }
    const url = URL.createObjectURL(blob);
    const name = place.name.replace(/[^\w-]+/g, '-').toLowerCase() + '-layout.png';
    const box = h('div', { class: 'picture', role: 'dialog', 'aria-label': 'Your layout picture' },
      h('img', { src: url, alt: 'Picture of the current layout' }),
      h('p', null, 'Press and hold the picture to save it, or use Download.'),
      h('div', { class: 'row' }, h('a', { href: url, download: name }, h('button', { type: 'button', class: 'primary' }, 'Download')),
        h('button', { type: 'button', onclick: () => { box.remove(); URL.revokeObjectURL(url); } }, 'Close')));
    document.body.append(box);
  }

  // Distances to walls (2D) and the wall being picked in a form
  function drawOverlay() {
    const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (overlay.width !== Math.round(r.width * dpr) || overlay.height !== Math.round(r.height * dpr)) { overlay.width = Math.round(r.width * dpr); overlay.height = Math.round(r.height * dpr); }
    const g = overlay.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    if (wallMark) {
      const room = place.rooms.find(x => x.id === wallMark!.roomId);
      if (room) {
        const w = wallOf(room, wallMark.wall), a = scene.project(w.a), b = scene.project(w.b);
        g.strokeStyle = '#2f6fde'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.fillStyle = '#2f6fde'; g.beginPath(); g.arc(a.x, a.y, 7, 0, Math.PI * 2); g.fill();
      }
    }
    const it = sel();
    if (!it || scene.mode !== '2d') return;
    const room = place.rooms.find(x => x.id === it.roomId); if (!room) return;
    const rb = roomBox(room), { hx, hz } = halfExtents(it), d = distancesToWalls(place, it);
    const lines: [Pt, Pt, number][] = [
      [{ x: it.x, z: rb.z0 }, { x: it.x, z: it.z - hz }, d[0].cm], [{ x: it.x + hx, z: it.z }, { x: rb.x1, z: it.z }, d[1].cm],
      [{ x: it.x, z: it.z + hz }, { x: it.x, z: rb.z1 }, d[2].cm], [{ x: rb.x0, z: it.z }, { x: it.x - hx, z: it.z }, d[3].cm],
    ];
    g.font = '600 12px Archivo, Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [p, q, cm] of lines) {
      const a = scene.project(p), b = scene.project(q);
      g.strokeStyle = '#2f6fde'; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      const label = formatCm(cm), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, tw = g.measureText(label).width + 8;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(mx - tw / 2, my - 9, tw, 18);
      g.fillStyle = '#1e1d1b'; g.fillText(label, mx, my);
    }
  }

  // Pointer handling: drag pieces on the floor, otherwise pan/orbit
  const active = new Set<number>();
  let drag: { id: string; ox: number; oz: number; pid: number; moved: boolean; last: Pt | null; err: string } | null = null;
  let down: { x: number; y: number; pid: number; moved: boolean; hit: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    active.add(e.pointerId);
    if (active.size > 1) { if (drag) endDrag(); scene.controls.enabled = true; down = null; return; }
    const hit = scene.pick(e.clientX, e.clientY);
    down = { x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, hit: !!hit };
    if (hit) {
      if (selected !== hit) select(hit);
      const p = scene.floorPoint(e.clientX, e.clientY), it = sel();
      if (p && it) { drag = { id: hit, ox: it.x - p.x, oz: it.z - p.z, pid: e.pointerId, moved: false, last: null, err: '' }; scene.controls.enabled = false; }
    }
  };
  const onMove = (e: PointerEvent) => {
    if (down && e.pointerId === down.pid && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    if (!drag || e.pointerId !== drag.pid || !down?.moved) return;
    const p = scene.floorPoint(e.clientX, e.clientY), it = sel();
    if (!p || !it) return;
    const room = place.rooms.find(r => r.id === it.roomId)!;
    const target = snapPoint({ x: p.x + drag.ox, z: p.z + drag.oz }, place, room);
    drag.moved = true; drag.last = target;
    const r = moveItem(place, drag.id, target);
    if (r.error) { if (r.error !== drag.err) toast(r.error, stage); drag.err = r.error; return; }
    drag.err = ''; place = r.place; refresh();
  };
  const endDrag = () => {
    if (drag?.moved && drag.last) { const r = moveItem(place, drag.id, { x: sel()!.x, z: sel()!.z }, { drop: true }); if (!r.error) place = r.place; commit(place); }
    drag = null;
  };
  const onUp = (e: PointerEvent) => {
    active.delete(e.pointerId);
    if (drag && e.pointerId === drag.pid) endDrag();
    if (down && e.pointerId === down.pid) { if (!down.moved && !down.hit && selected) select(null); down = null; }
    if (!active.size) scene.controls.enabled = true;
  };
  stage.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  refresh();
  scene.frame(scopeBox());
  if (!place.rooms.length) setTimeout(() => openRoomForm(place, p => { commit(p); scope = p.rooms[0].id; scene.frame(scopeBox()); }, hooks), 100);

  return {
    destroy() { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); scene.dispose(); },
    setStatus(text, cls, onClick) { status.textContent = text; status.className = 'ghost status ' + cls; status.onclick = onClick ?? null; },
    replacePlace(p) { place = p; title.textContent = p.name; if (selected && !p.items.some(i => i.id === selected)) selected = null; refresh(); },
    current: () => place,
  };
}
export type { Item };
