import type { Item, Place, Pt } from '../../model/types';
import { squareOf } from '../../model/types';
import { roomAt, roomBox, wallOf } from '../../model/rooms';
import { pointInPoly } from '../../model/geometry';
import { findOverlaps } from '../../model/overlap';
import { distancesToWalls, halfExtents, snapPoint } from '../../model/placement';
import { effectiveElevation } from '../../model/stacking';
import { LEVELS, levelForHeight } from '../../model/levels';
import { formatCm } from '../../model/units';
import { allowOverlap, cloneItem, cloneRoom, groupItems, groupOf, moveGroup, rotateGroup, setItemColor, ungroup, moveItem, moveRoom, moveRoomWall, removeItem, restoreItem, rotateItem, setItemLevel, snapRoomMove, snapWallMove } from '../../model/edit';
import type { Box } from '../../model/geometry';
import { h, sheet, toast } from '../dom';
import { SceneView } from './scene';
import { openBuiltInForm, openFurnitureForm, openItemEditor, openOpeningForm, openRoomEditor, openRoomForm, openRoomPartForm, openRoomsSheet, openSettings, sizeText } from './forms';

const SWATCHES: [string, string][] = [
  ['#f2efe9', 'White'], ['#e8dcc4', 'Cream'], ['#d8caae', 'Sand'], ['#b08d64', 'Oak'], ['#5b3a26', 'Walnut'], ['#2a2724', 'Black'],
  ['#8a8d91', 'Grey'], ['#9caf88', 'Sage'], ['#6b7a4f', 'Olive'], ['#2f4a6d', 'Navy'], ['#8fb3d9', 'Sky blue'], ['#c0663f', 'Terracotta'],
  ['#d9a53b', 'Mustard'], ['#e3b5a4', 'Blush'], ['#7a4a6b', 'Plum'], ['#a8584a', 'Brick red'],
];

export interface EditorApi { destroy(): void; setStatus(text: string, cls: string, onClick?: () => void): void; replacePlace(p: Place): void; current(): Place }

// The editor screen: plan/3D view, dragging, selection panel, forms
export function mountEditor(root: HTMLElement, initial: Place, onChange: (p: Place) => void, onBack: () => void): EditorApi {
  let place = initial, selected: string | null = null, scope: string = initial.rooms[0]?.id ?? 'all', tint = false;
  let wallMark: { roomId: string; wall: number } | null = null, preview: Pt[] | null = null, selRoom: string | null = null;

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
  const hooks = {
    highlightWall: (roomId: string | null, wall: number) => { wallMark = roomId ? { roomId, wall } : null; scene.requestRender(); },
    preview: (o: Pt[] | null) => { preview = o; scene.requestRender(); },
  };
  const curRoom = () => place.rooms.find(r => r.id === selRoom) ?? null;
  const sel = () => place.items.find(i => i.id === selected && !i.removed) ?? null;
  const mates = () => (sel() ? groupOf(place, sel()!.id) : []); // the selected piece and its group
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
    scopes.replaceChildren(...opts.map(([id, name]) => h('button', { type: 'button', 'aria-pressed': String(id === scope), onclick: () => { scope = id; selected = null; selRoom = id === 'all' ? null : id; refresh(); scene.frame(scopeBox()); } }, name)));
  }

  function refresh() {
    const overlaps = findOverlaps(place);
    scene.setPlace(place, { tint, overlaps: new Set(overlaps.keys()), selected, group: new Set(mates().map(i => i.id)) });
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
        ...(mates().length > 1 ? [h('br'), `In a group with ${mates().filter(m => m.id !== it.id).map(m => m.name).join(', ')}. Drag or turn to move them together.`] : [' Drag to move.']),
        ...(bumps.length ? [h('div', { class: 'warnbox' }, 'Overlaps ' + bumps.join(', '))] : []));
      levels.append(...LEVELS.map(l => h('button', { type: 'button', title: `${l.name}, ${formatCm(l.cm)}`, 'aria-pressed': String(!parent && l.n === lvl.n && Math.abs(it.elevation - l.cm) < 0.01),
        style: { borderColor: l.color }, onclick: () => commit(setItemLevel(place, it.id, l.n).place) }, `${l.n} ${l.name}`)));
      actions.append(
        h('button', { type: 'button', onclick: () => turn(it.id, 90) }, 'Turn 90°'),
        h('button', { type: 'button', onclick: () => turn(it.id, 15) }, 'Turn 15°'),
        h('button', { type: 'button', onclick: () => openItemEditor(place, it.id, p => { commit(p); if (!p.items.some(i => i.id === it.id)) select(null); }) }, 'Edit'),
        h('button', { type: 'button', onclick: () => colorSheet(it.id) }, 'Color'),
        h('button', { type: 'button', onclick: () => { const c = cloneItem(place, it.id); if (c.error || !c.id) toast(c.error ?? 'Could not copy', stage); else { commit(c.place); select(c.id); } } }, 'Clone'),
        mates().length > 1 ? h('button', { type: 'button', onclick: () => commit(ungroup(place, it.id).place) }, 'Ungroup') : h('button', { type: 'button', onclick: () => groupSheet(it.id) }, 'Group…'),
        ...(bumps.length ? [h('button', { type: 'button', onclick: () => commit(allowOverlap(place, it.id).place) }, 'Allow overlap')] : []),
        h('button', { type: 'button', class: 'warn', onclick: () => { const id = it.id; select(null); commit(removeItem(place, id).place); } }, 'Remove'),
        h('button', { type: 'button', class: 'primary', onclick: () => select(null) }, 'Done'));
    } else if (curRoom()) {
      const r = curRoom()!;
      info.append(h('b', null, r.name), ' ', h('span', { class: 'num' }, sizeText(place, r)), h('br'),
        scene.mode === '2d' ? 'Drag inside the room to move it. Drag a round handle to move that wall.' : 'Switch to 2D to move the room or drag its walls.');
      actions.append(
        h('button', { type: 'button', onclick: () => openRoomEditor(place, r.id, p => { commit(p); if (!p.rooms.some(x => x.id === r.id)) selectRoom(null); }, hooks) }, 'Edit details'),
        h('button', { type: 'button', onclick: () => openRoomPartForm(place, r.id, p => commit(p), hooks) }, '+ Add a part (L shape)'),
        h('button', { type: 'button', onclick: () => {
          const c = cloneRoom(place, r.id);
          if (c.error || !c.id) { toast(c.error ?? 'Could not copy', stage); return; }
          commit(c.place); selectRoom(c.id); scope = 'all'; renderScopes(); scene.frame(scopeBox());
          toast(`Made ${c.place.rooms.find(x => x.id === c.id)!.name} on the left. Drag it where it goes.`, stage);
        } }, 'Clone'),
        h('button', { type: 'button', class: 'primary', onclick: () => selectRoom(null) }, 'Done'));
    } else if (!place.rooms.length) {
      info.append('This place has no rooms yet. Add the first one by its width and depth.');
      actions.append(h('button', { type: 'button', class: 'primary', onclick: () => openRoomForm(place, p => { commit(p); scope = p.rooms[0].id; scene.frame(scopeBox()); }, hooks) }, '+ Room'));
    } else {
      info.append(`Tap a piece to pick it, then drag it. Tap a room's floor to move it, reshape it or copy it. ${scene.mode === '2d' ? 'Drag empty space to move around' : 'Drag empty space to look around'}, pinch to zoom.`);
      actions.append(
        h('button', { type: 'button', class: 'primary', onclick: () => openFurnitureForm(place, scopeRoomId(), (p, id) => { commit(p); select(id); }) }, '+ Furniture'),
        h('button', { type: 'button', onclick: () => addMenu() }, '+ Room, door…'),
        h('button', { type: 'button', 'aria-pressed': String(tint), onclick: () => { tint = !tint; refresh(); } }, 'Height levels'));
    }
    const gone = place.items.filter(i => i.removed);
    removed.replaceChildren(...(gone.length ? [h('span', { class: 'muted' }, 'Removed:'), ...gone.map(g => h('button', { type: 'button', class: 'chip', onclick: () => { commit(restoreItem(place, g.id).place); select(g.id); } }, '+ ' + g.name))] : []));
  }

  function apply(r: { place: Place; error?: string }) { if (r.error) toast(r.error, stage); else commit(r.place); }
  function turn(id: string, deg: number) { const g = groupOf(place, id); apply(g.length > 1 ? rotateGroup(place, g.map(i => i.id), deg) : rotateItem(place, id, deg)); }

  // Pick other pieces in the same room to group with this one
  function groupSheet(id: string) {
    const it = place.items.find(i => i.id === id)!;
    const others = place.items.filter(i => i.roomId === it.roomId && !i.removed && i.id !== id);
    if (!others.length) { toast('No other pieces in this room to group with', stage); return; }
    const boxes = others.map(o => {
      const cb = h('input', { type: 'checkbox', style: { width: '22px', minHeight: '22px' } }) as HTMLInputElement;
      return { o, cb, el: h('label', { class: 'row' }, cb, o.name, o.group ? h('span', { class: 'muted' }, ' (leaves its group)') : null) };
    });
    const err = h('div', { class: 'err', role: 'alert' });
    const close = sheet('Group ' + it.name + ' with…', [
      h('div', { class: 'hint' }, 'Grouped pieces move and turn together, like a desk and its chair. You can still edit, colour or remove each one.'),
      h('div', { class: 'list' }, ...boxes.map(b => b.el)), err,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', onclick: () => {
          const r = groupItems(place, [id, ...boxes.filter(b => b.cb.checked).map(b => b.o.id)]);
          if (r.error) { err.textContent = r.error; return; }
          close(); commit(r.place);
        } }, 'Make group'),
        h('button', { type: 'button', onclick: () => close() }, 'Cancel'))]);
  }

  // Colour swatches for a piece (or its whole group)
  function colorSheet(id: string) {
    const it = place.items.find(i => i.id === id)!, g = groupOf(place, id);
    const all = h('input', { type: 'checkbox', style: { width: '22px', minHeight: '22px' } }) as HTMLInputElement;
    const set = (c: string | null) => {
      let p = place;
      for (const m of all.checked ? g : [it]) { const r = setItemColor(p, m.id, c); if (r.error) { toast(r.error, stage); return; } p = r.place; }
      commit(p); close();
    };
    const custom = h('input', { type: 'color', value: it.color ?? '#b08d64', 'aria-label': 'Any colour', style: { width: '56px', minHeight: '44px', padding: '2px' }, onchange: (e: Event) => set((e.target as HTMLInputElement).value) });
    const close = sheet('Color of ' + it.name, [
      h('div', { class: 'swatches' }, ...SWATCHES.map(([c, n]) => h('button', { type: 'button', class: 'swatch', title: n, 'aria-label': n, 'aria-pressed': String(it.color === c), style: { background: c }, onclick: () => set(c) }))),
      h('div', { class: 'row' }, custom, h('span', { class: 'muted' }, 'Any other colour'), h('button', { type: 'button', onclick: () => set(null) }, 'Original look')),
      ...(g.length > 1 ? [h('label', { class: 'row' }, all, 'Colour the whole group')] : [])]);
  }
  function select(id: string | null) { selected = id; if (id) selRoom = null; refresh(); }
  function selectRoom(id: string | null) { selRoom = id; if (id) selected = null; refresh(); }

  function addMenu() {
    const rid = scopeRoomId();
    const close = sheet('Add', [h('div', { class: 'list' },
      h('button', { type: 'button', onclick: () => { close(); openRoomForm(place, (p, id) => { commit(p); if (id) { selectRoom(id); scope = 'all'; renderScopes(); scene.frame(scopeBox()); } }, hooks); } }, '+ Room'),
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

  // Screen spots of the round wall handles of the selected room (2D only)
  function handles(): { wall: number; x: number; y: number; nx: number; ny: number }[] {
    const r = curRoom();
    if (!r || scene.mode !== '2d') return [];
    return r.outline.map((_, i) => {
      const w = wallOf(r, i), mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
      const a = scene.project(mid), o = scene.project({ x: mid.x + w.normalOut.x * 10, z: mid.z + w.normalOut.z * 10 });
      const l = Math.hypot(o.x - a.x, o.y - a.y) || 1;
      return { wall: i, x: a.x, y: a.y, nx: (o.x - a.x) / l, ny: (o.y - a.y) / l };
    });
  }
  const BLUE = '#2f6fde';
  function label(g: CanvasRenderingContext2D, text: string, x: number, y: number) {
    const tw = g.measureText(text).width + 8;
    g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(x - tw / 2, y - 9, tw, 18);
    g.fillStyle = '#1e1d1b'; g.fillText(text, x, y);
  }
  function path(g: CanvasRenderingContext2D, pts: Pt[]) {
    g.beginPath(); pts.forEach((p, i) => { const s = scene.project(p); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); }); g.closePath();
  }

  // Distances to walls (2D), the selected room with its handles and wall lengths, form previews, the wall being picked in a form
  function drawOverlay() {
    const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (overlay.width !== Math.round(r.width * dpr) || overlay.height !== Math.round(r.height * dpr)) { overlay.width = Math.round(r.width * dpr); overlay.height = Math.round(r.height * dpr); }
    const g = overlay.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    g.font = '600 12px Archivo, Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (preview) {
      path(g, preview); g.fillStyle = 'rgba(47,111,222,.18)'; g.fill();
      g.strokeStyle = BLUE; g.lineWidth = 2; g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]);
    }
    const room = curRoom();
    if (room) {
      path(g, room.outline); g.fillStyle = 'rgba(47,111,222,.10)'; g.fill();
      g.strokeStyle = BLUE; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
      if (scene.mode === '2d') for (const hd of handles()) {
        const w = wallOf(room, hd.wall), a = scene.project(w.a), b = scene.project(w.b);
        if (Math.hypot(b.x - a.x, b.y - a.y) > 70) {
          // wall length just inside the room, clear of the handle
          const text = formatCm(w.length), off = 17 + Math.abs(hd.nx) * (g.measureText(text).width / 2 + 4) + Math.abs(hd.ny) * 9;
          label(g, text, hd.x - hd.nx * off, hd.y - hd.ny * off);
        }
        g.fillStyle = '#fff'; g.strokeStyle = BLUE; g.lineWidth = 2.5;
        g.beginPath(); g.arc(hd.x, hd.y, 11, 0, Math.PI * 2); g.fill(); g.stroke();
        // little double arrow showing which way the wall slides
        g.beginPath(); g.moveTo(hd.x - hd.nx * 6, hd.y - hd.ny * 6); g.lineTo(hd.x + hd.nx * 6, hd.y + hd.ny * 6); g.stroke();
      }
    }
    if (wallMark) {
      const wr = place.rooms.find(x => x.id === wallMark!.roomId);
      if (wr && wallMark.wall < wr.outline.length) {
        const w = wallOf(wr, wallMark.wall), a = scene.project(w.a), b = scene.project(w.b);
        g.strokeStyle = BLUE; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.fillStyle = BLUE; g.beginPath(); g.arc(a.x, a.y, 7, 0, Math.PI * 2); g.fill();
      }
    }
    const it = sel();
    if (!it || scene.mode !== '2d') return;
    for (const d of distancesToWalls(place, it)) {
      const a = scene.project(d.from), b = scene.project(d.to);
      g.strokeStyle = BLUE; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      label(g, formatCm(d.cm), (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  }

  // cm per screen pixel at a pointer spot (for snapping distances)
  function cmPerPx(cx: number, cy: number): number {
    const a = scene.floorPoint(cx, cy), b = scene.floorPoint(cx + 20, cy);
    return a && b ? Math.hypot(b.x - a.x, b.z - a.z) / 20 : 1;
  }
  const step = () => (place.snapOn ? (place.gridOn ? place.squareCm / 2 : 5) : 1);
  const roundTo = (v: number, st: number) => Math.round(v / st) * st;

  // Pointer handling: drag pieces, walls or whole rooms on the floor, otherwise pan/orbit
  const active = new Set<number>();
  let drag: { id: string; ox: number; oz: number; pid: number; moved: boolean; last: Pt | null; err: string; group: string[]; base: Place; gd: Pt } | null = null;
  let shape: { kind: 'wall' | 'room'; roomId: string; wall: number; start: Pt; base: Place; pid: number; moved: boolean; err: string } | null = null;
  let down: { x: number; y: number; pid: number; moved: boolean; hit: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    active.add(e.pointerId);
    if (active.size > 1) { if (drag) endDrag(); if (shape) endShape(); scene.controls.enabled = true; down = null; return; }
    const sr = stage.getBoundingClientRect(), lx = e.clientX - sr.left, ly = e.clientY - sr.top;
    const hd = handles().find(q => Math.hypot(q.x - lx, q.y - ly) < 22);
    const fp = scene.floorPoint(e.clientX, e.clientY);
    if (hd && fp) {
      shape = { kind: 'wall', roomId: selRoom!, wall: hd.wall, start: fp, base: place, pid: e.pointerId, moved: false, err: '' };
      down = { x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, hit: true };
      scene.controls.enabled = false; return;
    }
    const hit = scene.pick(e.clientX, e.clientY);
    down = { x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, hit: !!hit };
    if (hit) {
      if (selected !== hit) select(hit);
      const p = scene.floorPoint(e.clientX, e.clientY), it = sel();
      if (p && it) { drag = { id: hit, ox: it.x - p.x, oz: it.z - p.z, pid: e.pointerId, moved: false, last: null, err: '', group: mates().map(m => m.id), base: place, gd: { x: 0, z: 0 } }; scene.controls.enabled = false; }
      return;
    }
    const r = curRoom();
    if (r && fp && scene.mode === '2d' && pointInPoly(fp, r.outline)) {
      shape = { kind: 'room', roomId: r.id, wall: -1, start: fp, base: place, pid: e.pointerId, moved: false, err: '' };
      down.hit = true; scene.controls.enabled = false;
    }
  };
  const onMove = (e: PointerEvent) => {
    if (down && e.pointerId === down.pid && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    if (shape && e.pointerId === shape.pid && down?.moved) { moveShape(e); return; }
    if (!drag || e.pointerId !== drag.pid || !down?.moved) return;
    const p = scene.floorPoint(e.clientX, e.clientY), it = sel();
    if (!p || !it) return;
    const room = place.rooms.find(r => r.id === it.roomId)!;
    const target = snapPoint({ x: p.x + drag.ox, z: p.z + drag.oz }, place, room);
    drag.moved = true; drag.last = target;
    if (drag.group.length > 1) {
      // whole group: same shift for every piece, sliding along walls when blocked
      const b0 = drag.base.items.find(i => i.id === drag!.id)!, dx = target.x - b0.x, dz = target.z - b0.z;
      const tries = [[dx, dz], [dx, drag.gd.z], [drag.gd.x, dz]];
      let r: { place: Place; error?: string } = { place, error: '' };
      for (const [x, z] of tries) { r = moveGroup(drag.base, drag.group, x, z); if (!r.error) { drag.gd = { x, z }; break; } }
      if (r.error) { if (r.error !== drag.err) toast(r.error, stage); drag.err = r.error; return; }
      drag.err = ''; place = r.place; refresh(); return;
    }
    const r = moveItem(place, drag.id, target);
    if (r.error) { if (r.error !== drag.err) toast(r.error, stage); drag.err = r.error; return; }
    drag.err = ''; place = r.place; refresh();
  };
  function moveShape(e: PointerEvent) {
    const sh = shape!, p = scene.floorPoint(e.clientX, e.clientY);
    if (!p) return;
    const tol = 12 * cmPerPx(e.clientX, e.clientY);
    let r: { place: Place; error?: string };
    if (sh.kind === 'wall') {
      const room = sh.base.rooms.find(x => x.id === sh.roomId)!, n = wallOf(room, sh.wall).normalOut;
      let delta = roundTo((p.x - sh.start.x) * n.x + (p.z - sh.start.z) * n.z, step());
      delta = snapWallMove(sh.base, sh.roomId, sh.wall, delta, tol);
      r = moveRoomWall(sh.base, sh.roomId, sh.wall, delta);
    } else {
      const m = snapRoomMove(sh.base, sh.roomId, roundTo(p.x - sh.start.x, step()), roundTo(p.z - sh.start.z, step()), tol);
      r = moveRoom(sh.base, sh.roomId, m.dx, m.dz);
    }
    sh.moved = true;
    if (r.error) { if (r.error !== sh.err) toast(r.error, stage); sh.err = r.error; return; }
    sh.err = ''; place = r.place; refresh();
  }
  const endShape = () => { if (shape?.moved) commit(place); shape = null; };
  const endDrag = () => {
    if (drag?.moved && drag.last && drag.group.length > 1) commit(place);
    else if (drag?.moved && drag.last) { const r = moveItem(place, drag.id, { x: sel()!.x, z: sel()!.z }, { drop: true }); if (!r.error) place = r.place; commit(place); }
    drag = null;
  };
  const onUp = (e: PointerEvent) => {
    active.delete(e.pointerId);
    if (drag && e.pointerId === drag.pid) endDrag();
    if (shape && e.pointerId === shape.pid) endShape();
    if (down && e.pointerId === down.pid) {
      if (!down.moved && !down.hit) {
        // a tap on empty floor: first clears a picked piece, otherwise picks the room under it
        const fp = scene.floorPoint(e.clientX, e.clientY), room = fp ? roomAt(place, fp) : undefined;
        if (selected) select(null);
        else if (room && room.id !== selRoom) selectRoom(room.id);
        else if (selRoom) selectRoom(null);
      }
      down = null;
    }
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
    replacePlace(p) { place = p; title.textContent = p.name; if (selected && !p.items.some(i => i.id === selected)) selected = null; if (selRoom && !p.rooms.some(r => r.id === selRoom)) selRoom = null; refresh(); },
    current: () => place,
  };
}
export type { Item };
