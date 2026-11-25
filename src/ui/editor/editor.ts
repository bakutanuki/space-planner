import type { Item, Place, Pt } from '../../model/types';
import { squareOf } from '../../model/types';
import { doorLeaf, roomAt, roomBox, wallOf } from '../../model/rooms';
import { pointInPoly } from '../../model/geometry';
import { findOverlaps } from '../../model/overlap';
import { distancesToWalls, halfExtents, snapPoint } from '../../model/placement';
import { effectiveElevation } from '../../model/stacking';
import { LEVELS, levelForHeight } from '../../model/levels';
import { formatCm } from '../../model/units';
import { allowOverlap, cloneItem, cloneRoom, groupItems, groupOf, moveGroup, rotateGroup, setItemColor, ungroup, moveItem, moveRoom, moveRoomWall, removeItem, restoreItem, rotateItem, setItemLevel, snapRoomMove, snapWallMove } from '../../model/edit';
import type { Box } from '../../model/geometry';
import { h, promptDialog, sheet, toast } from '../dom';
import { wallName, wallStart } from '../../model/shape';
import { STYLE_DEFAULT, STYLE_WIDTHS, defaultSwing, findOpening, fitOpening, flipHinge, flipSide, nearestWall, newOpening, placeOpening, removeOpening, resizeOpening, setStyle, styleOf, updateOpening, type OpeningStyle } from '../../model/doors';
import type { Opening } from '../../model/types';
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
  // Doors and windows: placing mode (hover a wall to see where it goes, tap to put it there), its preview, the picked one
  let placing: { style: OpeningStyle; width: number } | null = null, selDoor: string | null = null;
  let ghost: { roomId: string; o: Omit<Opening, 'id'>; error?: string } | null = null;
  const lastWidth: Record<OpeningStyle, number> = { ...STYLE_DEFAULT };

  const status = h('button', { type: 'button', class: 'ghost status', 'aria-live': 'polite' });
  const viewBtn = h('button', { type: 'button', 'aria-label': 'Show 3D view', onclick: () => setMode(scene.mode === '2d' ? '3d' : '2d') }, '3D');
  const title = h('h1', null, place.name);
  const undoBtn = h('button', { type: 'button', class: 'icon', 'aria-label': 'Undo', title: 'Undo', onclick: () => undo() }, '↶');
  const redoBtn = h('button', { type: 'button', class: 'icon', 'aria-label': 'Redo', title: 'Redo', onclick: () => redo() }, '↷');
  const bar = h('header', { class: 'bar' },
    h('button', { type: 'button', class: 'ghost', 'aria-label': 'Back to my places', onclick: onBack }, '‹'), title, status, undoBtn, redoBtn, viewBtn,
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

  // Undo/redo keep whole snapshots of the place; a drag counts as one step
  let committed = initial;
  const undoStack: Place[] = [], redoStack: Place[] = [];
  const commit = (p: Place, save = true) => {
    if (p !== committed) { undoStack.push(committed); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
    committed = p; place = p; title.textContent = p.name; if (save) onChange(p); refresh();
  };
  function history(from: Place[], to: Place[]) {
    const p = from.pop();
    if (!p) return;
    to.push(committed); committed = p; place = p; title.textContent = p.name;
    if (selected && !p.items.some(i => i.id === selected && !i.removed)) selected = null;
    if (selRoom && !p.rooms.some(r => r.id === selRoom)) selRoom = null;
    if (selDoor && !findOpening(p, selDoor)) selDoor = null;
    onChange(p); refresh();
  }
  const undo = () => history(undoStack, redoStack), redo = () => history(redoStack, undoStack);
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
    undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length;
    const overlaps = findOverlaps(place);
    scene.setPlace(place, { tint, overlaps: new Set(overlaps.keys()), selected, group: new Set(mates().map(i => i.id)) });
    legend.style.display = tint ? '' : 'none';
    renderScopes(); renderPanel(overlaps);
  }

  function renderPanel(overlaps = findOverlaps(place)) {
    const it = sel();
    actions.replaceChildren(); levels.replaceChildren(); info.replaceChildren();
    const door = selDoor ? findOpening(place, selDoor) : null;
    if (placing) placingPanel(placing);
    else if (door) doorPanel(door.room, door.o);
    else if (it) {
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
        h('button', { type: 'button', onclick: () => startPlacing('door') }, '+ Door or window'),
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
      info.append(`Tap a piece to pick it, then drag it. Tap a door to flip or move it. Tap a room's floor to move it, reshape it or copy it. ${scene.mode === '2d' ? 'Drag empty space to move around' : 'Drag empty space to look around'}, pinch to zoom.`);
      actions.append(
        h('button', { type: 'button', class: 'primary', onclick: () => openFurnitureForm(place, scopeRoomId(), (p, id) => { commit(p); select(id); }) }, '+ Furniture'),
        h('button', { type: 'button', onclick: () => startPlacing('door') }, '+ Door or window'),
        h('button', { type: 'button', onclick: () => addMenu() }, '+ Room, built-in…'),
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
  function select(id: string | null) { selected = id; if (id) { selRoom = null; selDoor = null; placing = null; ghost = null; } refresh(); }
  function selectRoom(id: string | null) { selRoom = id; if (id) { selected = null; selDoor = null; placing = null; ghost = null; } refresh(); }
  function selectDoor(id: string | null) { selDoor = id; if (id) { selected = null; selRoom = null; placing = null; ghost = null; } refresh(); }

  // Placing mode: pick door / doorway / window and a width, then tap a wall
  function startPlacing(style: OpeningStyle) {
    if (!place.rooms.length) { toast('Add a room first', stage); return; }
    selected = null; selRoom = null; selDoor = null; ghost = null;
    placing = { style, width: lastWidth[style] };
    refresh();
  }
  const STYLE_NAMES: Record<OpeningStyle, string> = { door: 'Door', doorway: 'Open doorway', window: 'Window' };
  async function askWidth(cur: number): Promise<number | null> {
    const v = await promptDialog('Width', 'Width in cm (inside of the frame)', String(cur), 'OK');
    const n = v == null ? NaN : parseFloat(v.replace(',', '.'));
    if (v != null && !(n > 0)) toast('Type a width in cm, like 85', stage);
    return n > 0 ? n : null;
  }
  function widthChips(style: OpeningStyle, cur: number, set: (w: number) => void): HTMLElement {
    const list = STYLE_WIDTHS[style].includes(cur) ? STYLE_WIDTHS[style] : [...STYLE_WIDTHS[style], cur].sort((a, b) => a - b);
    return h('div', { class: 'levels', role: 'group', 'aria-label': 'Width' }, h('span', { class: 'muted' }, 'Width'),
      ...list.map(wd => h('button', { type: 'button', 'aria-pressed': String(Math.abs(wd - cur) < 0.01), onclick: () => set(wd) }, formatCm(wd))),
      h('button', { type: 'button', onclick: async () => { const n = await askWidth(cur); if (n) set(n); } }, 'Other…'));
  }
  function styleChips(cur: OpeningStyle, set: (s: OpeningStyle) => void): HTMLElement {
    return h('div', { class: 'levels', role: 'group', 'aria-label': 'Kind' },
      ...(['door', 'doorway', 'window'] as OpeningStyle[]).map(s => h('button', { type: 'button', 'aria-pressed': String(s === cur), onclick: () => set(s) }, STYLE_NAMES[s])));
  }
  function placingPanel(pl: { style: OpeningStyle; width: number }) {
    const what = STYLE_NAMES[pl.style].toLowerCase();
    info.append(h('b', null, `Add ${pl.style === 'window' ? 'a window' : pl.style === 'door' ? 'a door' : 'an open doorway'}`), h('br'),
      `Tap a wall where the ${what} goes (with a mouse, just point first to see it). You can drag it and flip it afterwards.`);
    levels.append(styleChips(pl.style, s => { placing = { style: s, width: lastWidth[s] }; ghost = null; refresh(); }),
      widthChips(pl.style, pl.width, wd => { lastWidth[pl.style] = wd; placing = { ...pl, width: wd }; ghost = null; refresh(); }));
    actions.append(
      h('button', { type: 'button', onclick: () => { const rid = scopeRoomId(); placing = null; ghost = null; refresh(); openOpeningForm(place, rid, p => commit(p), undefined, hooks); } }, 'Type exact numbers instead'),
      h('button', { type: 'button', class: 'primary', onclick: () => { placing = null; ghost = null; refresh(); } }, 'Cancel'));
  }
  function doorPanel(room: typeof place.rooms[number], o: Opening) {
    const style = styleOf(o), w = wallOf(room, o.wall);
    const st = wallStart(room.outline, o.wall), other = ({ 'left end': 'right end', 'right end': 'left end', 'top end': 'bottom end', 'bottom end': 'top end' } as Record<string, string>)[st] ?? 'other end';
    const sw = style === 'door' ? (o.swing && o.swing !== 'open' ? o.swing : { into: 'room', hinge: 'start' }) : null;
    info.append(h('b', null, STYLE_NAMES[style]), ' ', h('span', { class: 'num' }, `${formatCm(o.width)} wide`), ` on ${room.name}'s ${wallName(room.outline, o.wall).toLowerCase()}.`, h('br'),
      h('span', { class: 'num' }, `${formatCm(o.offset)} from the ${st}, ${formatCm(w.length - o.offset - o.width)} from the ${other}.`), ' ',
      sw ? `Opens ${sw.into === 'room' ? 'into ' + room.name : 'outward'}. ` : '', 'Drag it along the wall, or onto another wall, to move it.');
    const up = (r: { place: Place; error?: string }) => apply(r);
    levels.append(styleChips(style, s => { lastWidth[s] = o.width; up(setStyle(place, o.id, s)); }),
      widthChips(style, o.width, wd => { lastWidth[style] = wd; up(resizeOpening(place, o.id, wd)); }));
    actions.append(
      ...(sw ? [h('button', { type: 'button', onclick: () => up(flipSide(place, o.id)) }, '⇅ Flip in / out'),
        h('button', { type: 'button', onclick: () => up(flipHinge(place, o.id)) }, '⇆ Flip hinge side')] : []),
      h('button', { type: 'button', onclick: () => openOpeningForm(place, room.id, p => { commit(p); if (!findOpening(p, o.id)) selectDoor(null); }, o, hooks) }, 'Exact numbers…'),
      h('button', { type: 'button', class: 'warn', onclick: () => { selDoor = null; commit(removeOpening(place, o.id).place); toast(`${STYLE_NAMES[style]} removed. Undo (↶) brings it back.`, stage); } }, 'Delete'),
      h('button', { type: 'button', class: 'primary', onclick: () => selectDoor(null) }, 'Done'));
  }

  // Where the opening being placed would go for a pointer spot (null when not near a wall)
  function ghostAt(cx: number, cy: number) {
    const pl = placing!, fp = scene.floorPoint(cx, cy), px = cmPerPx(cx, cy);
    const hit = fp ? nearestWall(place, fp, Math.max(25, 28 * px)) : null;
    if (!hit) { ghost = null; scene.requestRender(); return; }
    const room = place.rooms.find(r => r.id === hit.roomId)!;
    const fit = fitOpening(place, hit.roomId, hit.wall, hit.t, pl.width, { snap: 10 * px });
    const offset = 'offset' in fit ? fit.offset : Math.max(0, Math.min(wallOf(room, hit.wall).length - pl.width, hit.t - pl.width / 2));
    ghost = { roomId: hit.roomId, o: newOpening(pl.style, room, hit.wall, offset, Math.min(pl.width, wallOf(room, hit.wall).length), defaultSwing(place, hit.roomId, hit.wall, offset, pl.width)), error: 'error' in fit ? fit.error : undefined };
    scene.requestRender();
  }
  function placeGhost() {
    if (!ghost) { toast('Tap on a wall', stage); return; }
    if (ghost.error) { toast(ghost.error, stage); return; }
    const r = placeOpening(place, ghost.roomId, ghost.o);
    if (r.error || !r.id) { toast(r.error ?? 'Could not add it', stage); return; }
    placing = null; ghost = null; selDoor = r.id; selected = null; selRoom = null;
    commit(r.place);
  }

  // The door or window under a pointer spot: on its wall (close), or inside its swing (loose)
  function doorAt(cx: number, cy: number, loose: boolean): string | null {
    const sr = stage.getBoundingClientRect(), x = cx - sr.left, y = cy - sr.top, T = place.wallThickness;
    let best: string | null = null, bestD = 16;
    for (const r of place.rooms) for (const o of r.openings) {
      if (o.wall >= r.outline.length) continue;
      const w = wallOf(r, o.wall), at = (t: number) => scene.project({ x: w.a.x + w.dir.x * t + w.normalOut.x * T / 2, z: w.a.z + w.dir.z * t + w.normalOut.z * T / 2 });
      const a = at(o.offset), b = at(o.offset + o.width), d = segDistPx(x, y, a, b);
      if (d < bestD) { bestD = d; best = o.id; }
    }
    if (best || !loose || scene.mode !== '2d') return best;
    const fp = scene.floorPoint(cx, cy);
    if (!fp) return null;
    for (const r of place.rooms) for (const o of r.openings) {
      const leaf = doorLeaf(r, o, T);
      if (!leaf) continue;
      const dx = fp.x - leaf.hinge.x, dz = fp.z - leaf.hinge.z;
      const u = dx * leaf.shut.x + dz * leaf.shut.z, v = dx * leaf.open.x + dz * leaf.open.z;
      if (u >= 0 && v >= 0 && Math.hypot(u, v) <= o.width) return o.id;
    }
    return null;
  }

  function addMenu() {
    const rid = scopeRoomId();
    const close = sheet('Add', [h('div', { class: 'list' },
      h('button', { type: 'button', onclick: () => { close(); openRoomForm(place, (p, id) => { commit(p); if (id) { selectRoom(id); scope = 'all'; renderScopes(); scene.frame(scopeBox()); } }, hooks); } }, '+ Room'),
      h('button', { type: 'button', onclick: () => { close(); startPlacing('door'); } }, '+ Door or window'),
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
    if (scene.mode === '2d') drawSwings(g);
    const sd = selDoor ? findOpening(place, selDoor) : null;
    if (sd) drawOpening(g, sd.room, sd.o, BLUE);
    if (ghost) { const gr = place.rooms.find(x => x.id === ghost!.roomId); if (gr) drawOpening(g, gr, ghost.o, ghost.error ? '#d93025' : '#1a8f4c', true); }
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

  // A door or window being placed or picked: the gap in the wall, its swing, and how far it is from each end of the wall
  function drawOpening(g: CanvasRenderingContext2D, room: typeof place.rooms[number], o: Omit<Opening, 'id'>, color: string, faintWall = false) {
    if (o.wall >= room.outline.length) return;
    const T = place.wallThickness, w = wallOf(room, o.wall), n = w.normalOut;
    const on = (t: number, s: number) => ({ x: w.a.x + w.dir.x * t + n.x * s, z: w.a.z + w.dir.z * t + n.z * s });
    if (faintWall) {
      const a = scene.project(on(0, T / 2)), b = scene.project(on(w.length, T / 2));
      g.strokeStyle = color; g.globalAlpha = 0.25; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.globalAlpha = 1;
    }
    path(g, [on(o.offset, -2), on(o.offset + o.width, -2), on(o.offset + o.width, T + 2), on(o.offset, T + 2)]);
    g.fillStyle = color; g.globalAlpha = 0.45; g.fill(); g.globalAlpha = 1; g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
    const leaf = doorLeaf(room, { ...o, id: '' }, T);
    if (leaf) {
      const at = (ang: number) => scene.project({ x: leaf.hinge.x + o.width * (Math.cos(ang) * leaf.shut.x + Math.sin(ang) * leaf.open.x), z: leaf.hinge.z + o.width * (Math.cos(ang) * leaf.shut.z + Math.sin(ang) * leaf.open.z) });
      const hp = scene.project(leaf.hinge), tip = at(Math.PI / 2);
      g.strokeStyle = color; g.lineWidth = 3; g.beginPath(); g.moveTo(hp.x, hp.y); g.lineTo(tip.x, tip.y); g.stroke();
      g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath();
      for (let k = 0; k <= 24; k++) { const q = at((k / 24) * Math.PI / 2); if (k) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }
      g.stroke(); g.setLineDash([]);
      g.fillStyle = color; g.beginPath(); g.arc(hp.x, hp.y, 4, 0, Math.PI * 2); g.fill();
    }
    // gaps to the wall ends, written just inside the room
    const inset = -Math.max(14, 18 * cmPerPxAtScreen());
    const gaps: [number, number][] = [[0, o.offset], [o.offset + o.width, w.length]];
    for (const [t0, t1] of gaps) {
      if (t1 - t0 < 0.5) continue;
      const a = scene.project(on(t0, inset * 0.5)), b = scene.project(on(t1, inset * 0.5));
      if (Math.hypot(b.x - a.x, b.y - a.y) < 24) continue;
      g.strokeStyle = color; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      const m = scene.project(on((t0 + t1) / 2, inset * 1.4));
      label(g, formatCm(t1 - t0), m.x, m.y);
    }
  }
  function cmPerPxAtScreen(): number {
    const a = scene.project({ x: 0, z: 0 }), b = scene.project({ x: 100, z: 0 });
    return 100 / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
  }

  // Door swing arcs: the leaf fully open plus the quarter circle its edge travels
  function drawSwings(g: CanvasRenderingContext2D) {
    const T = place.wallThickness;
    g.strokeStyle = '#8a5a2b'; g.lineWidth = 2;
    for (const r of place.rooms) for (const o of r.openings) {
      const leaf = doorLeaf(r, o, T);
      if (!leaf) continue;
      const { hinge, shut, open } = leaf;
      const at = (ang: number) => scene.project({ x: hinge.x + o.width * (Math.cos(ang) * shut.x + Math.sin(ang) * open.x), z: hinge.z + o.width * (Math.cos(ang) * shut.z + Math.sin(ang) * open.z) });
      const hp = scene.project(hinge), tip = at(Math.PI / 2);
      g.setLineDash([]); g.beginPath(); g.moveTo(hp.x, hp.y); g.lineTo(tip.x, tip.y); g.stroke();
      g.setLineDash([4, 3]); g.beginPath();
      for (let k = 0; k <= 24; k++) { const q = at((k / 24) * Math.PI / 2); if (k) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }
      g.stroke(); g.setLineDash([]);
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
  let down: { x: number; y: number; pid: number; moved: boolean; hit: boolean; place?: boolean } | null = null;
  let doorDrag: { id: string; pid: number; base: Place; grab: number; wall: string; moved: boolean; err: string } | null = null;
  const onDown = (e: PointerEvent) => {
    active.add(e.pointerId);
    if (active.size > 1) { if (drag) endDrag(); if (shape) endShape(); doorDrag = null; scene.controls.enabled = true; down = null; return; }
    const sr = stage.getBoundingClientRect(), lx = e.clientX - sr.left, ly = e.clientY - sr.top;
    if (placing) {
      // near a wall: press shows where it goes, release puts it there; elsewhere the view pans as usual
      ghostAt(e.clientX, e.clientY);
      down = { x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, hit: !!ghost, place: !!ghost };
      if (ghost) scene.controls.enabled = false;
      return;
    }
    const hd = handles().find(q => Math.hypot(q.x - lx, q.y - ly) < 22);
    const fp = scene.floorPoint(e.clientX, e.clientY);
    if (hd && fp) {
      shape = { kind: 'wall', roomId: selRoom!, wall: hd.wall, start: fp, base: place, pid: e.pointerId, moved: false, err: '' };
      down = { x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, hit: true };
      scene.controls.enabled = false; return;
    }
    const dh = doorAt(e.clientX, e.clientY, false);
    if (dh) { startDoorDrag(dh, e); return; }
    const hit = scene.pick(e.clientX, e.clientY);
    const loose = hit ? null : doorAt(e.clientX, e.clientY, true);
    if (loose) { startDoorDrag(loose, e); return; }
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
  function startDoorDrag(id: string, e: PointerEvent) {
    if (selDoor !== id) selectDoor(id);
    const f = findOpening(place, id)!, w = wallOf(f.room, f.o.wall), fp = scene.floorPoint(e.clientX, e.clientY);
    const t = fp ? (fp.x - w.a.x) * w.dir.x + (fp.z - w.a.z) * w.dir.z : f.o.offset + f.o.width / 2;
    doorDrag = { id, pid: e.pointerId, base: place, grab: t - (f.o.offset + f.o.width / 2), wall: f.room.id + ':' + f.o.wall, moved: false, err: '' };
    down = { x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, hit: true };
    scene.controls.enabled = false;
  }
  // Drag a door along its wall, or across to another wall
  function moveDoor(e: PointerEvent) {
    const dd = doorDrag!, fp = scene.floorPoint(e.clientX, e.clientY), px = cmPerPx(e.clientX, e.clientY);
    const f = findOpening(dd.base, dd.id);
    if (!fp || !f) return;
    const hit = nearestWall(dd.base, fp, Math.max(40, 40 * px));
    if (!hit) return;
    const sameWall = hit.roomId + ':' + hit.wall === dd.wall;
    const fit = fitOpening(dd.base, hit.roomId, hit.wall, hit.t - (sameWall ? dd.grab : 0), f.o.width, { ignoreId: dd.id, snap: 10 * px });
    dd.moved = true;
    if ('error' in fit) { if (fit.error !== dd.err) toast(fit.error, stage); dd.err = fit.error; return; }
    const ch: Partial<Opening> & { roomId?: string } = { roomId: hit.roomId, wall: hit.wall, offset: fit.offset };
    // a door moved to another room's wall keeps opening into the room it was dragged to
    const r = updateOpening(dd.base, dd.id, ch);
    if (r.error) { if (r.error !== dd.err) toast(r.error, stage); dd.err = r.error; return; }
    dd.err = ''; place = r.place; refresh();
  }
  const onMove = (e: PointerEvent) => {
    if (down && e.pointerId === down.pid && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    if (placing && (!down || (down.pid === e.pointerId && down.place))) { if (down || (e.pointerType === 'mouse' && stage.contains(e.target as Node))) ghostAt(e.clientX, e.clientY); else if (ghost && !down) { ghost = null; scene.requestRender(); } return; }
    if (doorDrag && e.pointerId === doorDrag.pid) { if (down?.moved) moveDoor(e); return; }
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
    if (placing && down && e.pointerId === down.pid) {
      if (down.place) { ghostAt(e.clientX, e.clientY); placeGhost(); }
      else if (!down.moved) toast('Tap on a wall', stage);
      down = null; if (!active.size) scene.controls.enabled = true; return;
    }
    if (doorDrag && e.pointerId === doorDrag.pid) {
      if (doorDrag.moved && place !== doorDrag.base) commit(place);
      doorDrag = null; down = null; if (!active.size) scene.controls.enabled = true; return;
    }
    if (drag && e.pointerId === drag.pid) endDrag();
    if (shape && e.pointerId === shape.pid) endShape();
    if (down && e.pointerId === down.pid) {
      if (!down.moved && !down.hit) {
        // a tap on empty floor: first clears a picked piece, otherwise picks the room under it
        const fp = scene.floorPoint(e.clientX, e.clientY), room = fp ? roomAt(place, fp) : undefined;
        if (selected) select(null);
        else if (selDoor) selectDoor(null);
        else if (room && room.id !== selRoom) selectRoom(room.id);
        else if (selRoom) selectRoom(null);
      }
      down = null;
    }
    if (!active.size) scene.controls.enabled = true;
  };
  const onKey = (e: KeyboardEvent) => {
    const inField = !!(e.target as HTMLElement)?.closest?.('input,textarea,select');
    if (!inField && !document.querySelector('.backdrop')) {
      if (e.key === 'Escape' && (placing || selDoor)) { placing = null; ghost = null; selDoor = null; refresh(); return; }
      if (e.key === 'Delete' && selDoor) { const id = selDoor; selDoor = null; commit(removeOpening(place, id).place); return; }
    }
    if (!(e.ctrlKey || e.metaKey) || inField) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  };
  window.addEventListener('keydown', onKey);
  stage.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  refresh();
  scene.frame(scopeBox());
  if (!place.rooms.length) setTimeout(() => openRoomForm(place, p => { commit(p); scope = p.rooms[0].id; scene.frame(scopeBox()); }, hooks), 100);

  return {
    destroy() { window.removeEventListener('keydown', onKey); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); scene.dispose(); },
    setStatus(text, cls, onClick) { status.textContent = text; status.className = 'ghost status ' + cls; status.onclick = onClick ?? null; },
    replacePlace(p) { place = p; committed = p; undoStack.length = 0; redoStack.length = 0; title.textContent = p.name; if (selected && !p.items.some(i => i.id === selected)) selected = null; if (selRoom && !p.rooms.some(r => r.id === selRoom)) selRoom = null; if (selDoor && !findOpening(p, selDoor)) selDoor = null; refresh(); },
    current: () => place,
  };
}
export type { Item };

// Distance in screen pixels from a point to a line segment
function segDistPx(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
