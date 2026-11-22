import type { BuiltIn, ItemType, Opening, Place, Pt, Room, Swing } from '../../model/types';
import { squareOf, TYPE_DEFAULTS, TYPE_LABELS } from '../../model/types';
import { roomBox, wallOf } from '../../model/rooms';
import { areaOf, wallIsLevel, wallName, wallStart } from '../../model/shape';
import { addItem, addPieces, addRoom, addRoomPart, setItemColor, deleteBuiltIn, deleteOpening, deleteRoom, deleteItem, renameItem, resizeItem, saveBuiltIn, saveOpening, setItemHeight, updatePlace, updateRoom, type EditResult } from '../../model/edit';
import { formatCm, formatBoth } from '../../model/units';
import { MY_FURNITURE, type CatalogPiece } from '../../model/catalog';
import { confirmDialog, h, lengthField, sheet, unitSwitch, type LengthField, type Unit } from '../dom';

type Done = (p: Place) => void;
export interface FormHooks { highlightWall?: (roomId: string | null, wall: number) => void; preview?: (outline: Pt[] | null) => void }

function selectField(label: string, options: [string, string][], value: string, onChange: () => void): { el: HTMLElement; sel: HTMLSelectElement } {
  const sel = h('select', { onchange: onChange }, ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  return { el: h('div', { class: 'field' }, h('label', null, label), sel), sel };
}
function textField(label: string, value: string, onInput: () => void) {
  const input = h('input', { value, maxlength: 60, oninput: onInput });
  return { el: h('div', { class: 'field' }, h('label', null, label), input), input };
}
// Form footer: error line + main button + cancel
function footer(okLabel: string, onOk: () => void, close: () => void) {
  const err = h('div', { class: 'err', role: 'alert' });
  const ok = h('button', { type: 'button', class: 'primary', onclick: onOk }, okLabel);
  return { el: h('div', { class: 'field' }, err, h('div', { class: 'row' }, ok, h('button', { type: 'button', onclick: () => close() }, 'Cancel'))), err, ok };
}
// Runs a trial edit; shows its error and enables the button only if it would work
function check(fieldsOk: boolean, res: (() => EditResult) | null, f: { err: HTMLElement; ok: HTMLButtonElement }, firstMissing = 'Fill in every size'): EditResult | null {
  if (!fieldsOk || !res) { f.err.textContent = fieldsOk ? '' : firstMissing; f.ok.disabled = true; return null; }
  const r = res();
  f.err.textContent = r.error ?? ''; f.ok.disabled = !!r.error;
  return r.error ? null : r;
}
const wallOptions = (r: Room): [string, string][] => r.outline.map((_, i) => [String(i), wallName(r.outline, i)]);
// Refills a wall picker for another room, keeping the choice if it still exists
function setWallOptions(sel: HTMLSelectElement, r: Room) {
  const keep = sel.value;
  sel.replaceChildren(...wallOptions(r).map(([v, t]) => h('option', { value: v }, t)));
  sel.value = Number(keep) < r.outline.length ? keep : '0';
}
const SIDE_WORDS: Record<string, string> = { 'Top wall': 'Above it', 'Bottom wall': 'Below it', 'Left wall': 'To its left', 'Right wall': 'To its right' };
// "Above it", or "Above it (left part)" for a room with several top walls
const sideOptions = (r: Room): [string, string][] => r.outline.map((_, i) => {
  const n = wallName(r.outline, i), base = n.replace(/ \(.*\)$/, ''), extra = n.slice(base.length);
  return [String(i), (SIDE_WORDS[base] ?? n) + extra];
});
// Sizes on screen (width left–right, length top–bottom, gap from the left or top end) turned into along/out/offset for wall wi
function screenToWall(r: Room, wi: number, W: number, L: number, gap: number): { along: number; out: number; offset: number } {
  const w = wallOf(r, wi), level = wallIsLevel(r.outline, wi);
  const along = level ? W : L, out = level ? L : W;
  // screen left is +x and screen top is +z (the plan is seen from the window side)
  const startsAtGapEnd = level ? w.a.x > w.b.x : w.a.z > w.b.z;
  return { along, out, offset: startsAtGapEnd ? gap : w.length - gap - along };
}
const gapEnd = (r: Room, wi: number) => (wallIsLevel(r.outline, wi) ? 'left' : 'top');
const roomOptions = (p: Place): [string, string][] => p.rooms.map(r => [r.id, r.name]);
const defaultUnit = (p: Place): Unit => (p.gridOn ? 'sq' : 'cm');

// + Room: size as seen on the plan; later rooms go next to a side of another room
export function openRoomForm(place: Place, done: (p: Place, newId?: string) => void, hooks: FormHooks = {}) {
  let unit = defaultUnit(place);
  const first = place.rooms.length === 0;
  const name = textField('Name', first ? 'Room' : 'Room ' + (place.rooms.length + 1), () => validate());
  const sqF = lengthField('Floor square size, optional', null, 'cm', place.squareCm, () => { sync(); validate(); }, { placeholder: String(place.squareCm), optional: true });
  const roomSq = () => sqF.value() ?? place.squareCm;
  const w = lengthField('Width (left ↔ right)', null, unit, place.squareCm, () => validate());
  const d = lengthField('Length (top ↕ bottom)', null, unit, place.squareCm, () => validate());
  const ceil = lengthField('Ceiling height', 240, 'cm', place.squareCm, () => validate());
  const target = selectField('Next to which room?', roomOptions(place), place.rooms[0]?.id ?? '', () => { if (tgtRoom()) side.sel.replaceChildren(...sideOptions(tgtRoom()!).map(([v, t]) => h('option', { value: v }, t))); sync(); validate(); });
  const side = selectField('On which side of it?', place.rooms[0] ? sideOptions(place.rooms[0]) : [], '2', () => { sync(); validate(); });
  const off = lengthField('Gap from the left end', 0, unit, place.squareCm, () => validate(), { allowZero: true });
  const offHint = h('div', { class: 'hint' });
  const tgtRoom = () => place.rooms.find(r => r.id === target.sel.value);
  function sync() {
    w.setUnit(unit, roomSq()); d.setUnit(unit, roomSq());
    const tr = tgtRoom(), wi = Number(side.sel.value);
    off.setUnit(unit, squareOf(place, tr));
    if (tr) {
      const end = gapEnd(tr, wi);
      off.el.querySelector('label')!.textContent = `Slide it: gap from the ${end} end`;
      offHint.textContent = `0 lines the new room up with the ${end} end of ${tr.name}'s ${wallName(tr.outline, wi).toLowerCase()} (that wall is ${formatBoth(wallOf(tr, wi).length, squareOf(place, tr))}). The wall between them is shared. The blue outline on the plan shows where it will go.`;
    }
    hooks.highlightWall?.(tr?.id ?? null, wi);
  }
  const f = footer('Add room', () => { const r = validate(); if (r) { close(); done(r.place, r.place.rooms[r.place.rooms.length - 1]?.id); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), C = ceil.value(), O = off.value(), tr = tgtRoom();
    const sqv = sqF.value();
    const r = check(W != null && D != null && C != null && sqF.ok() && (first || O != null), () => {
      if (first || !tr) return addRoom(place, { name: name.input.value, w: W!, d: D!, ceiling: C!, squareCm: sqv ?? null });
      const wi = Number(side.sel.value), m = screenToWall(tr, wi, W!, D!, O!);
      if (m.offset < -1e-6) return { place, error: 'Too wide for that side with this gap' };
      return addRoom(place, { name: name.input.value, w: m.along, d: m.out, ceiling: C!, squareCm: sqv ?? null, attach: { roomId: tr.id, wall: wi, offset: m.offset } });
    }, f);
    hooks.preview?.(r ? r.place.rooms[r.place.rooms.length - 1].outline : null);
    return r;
  }
  const close = sheet(first ? 'Add your first room' : '+ Room', [
    unitSwitch(unit, u => { unit = u; sync(); }),
    name.el,
    h('div', { class: 'hint' }, 'Sizes are the inside of the room (wall to wall), as you see it on the plan.'),
    h('div', { class: 'grid2' }, w.el, d.el), h('div', { class: 'grid2' }, ceil.el, sqF.el),
    ...(first ? [] : [h('div', { class: 'grid2' }, target.el, side.el), off.el, offHint]),
    f.el,
  ], { onClose: () => { hooks.highlightWall?.(null, 0); hooks.preview?.(null); } });
  sync(); validate();
}

// Add a part to a room (makes an L or T shape): a rectangle sticking out from one of its walls, with no wall in between
export function openRoomPartForm(place: Place, roomId: string, done: Done, hooks: FormHooks = {}) {
  const room = place.rooms.find(r => r.id === roomId);
  if (!room) return;
  let unit = defaultUnit(place);
  const sq = squareOf(place, room);
  const side = selectField('Which wall does it stick out from?', wallOptions(room), String(room.outline.findIndex((_, i) => wallName(room.outline, i).startsWith('Top'))), () => { sync(); validate(); });
  const w = lengthField('Width (left ↔ right)', null, unit, sq, () => validate());
  const d = lengthField('Length (top ↕ bottom)', null, unit, sq, () => validate());
  const off = lengthField('Gap from the left end', 0, unit, sq, () => validate(), { allowZero: true });
  const hint = h('div', { class: 'hint' });
  function sync() {
    w.setUnit(unit, sq); d.setUnit(unit, sq); off.setUnit(unit, sq);
    const wi = Number(side.sel.value), end = gapEnd(room!, wi);
    off.el.querySelector('label')!.textContent = `Gap from the ${end} end`;
    hint.textContent = `Measured from the ${end} end of the ${wallName(room!.outline, wi).toLowerCase()} (${formatBoth(wallOf(room!, wi).length, sq)} long). The new part opens straight into ${room!.name}, with no wall between. The blue outline shows the result.`;
    hooks.highlightWall?.(roomId, wi);
  }
  const f = footer('Add part', () => { const r = validate(); if (r) { close(); done(r.place); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), O = off.value();
    const r = check(W != null && D != null && O != null, () => {
      const m = screenToWall(room!, Number(side.sel.value), W!, D!, O!);
      if (m.offset < -1e-6) return { place, error: 'Too wide for that wall with this gap' };
      return addRoomPart(place, roomId, { wall: Number(side.sel.value), ...m });
    }, f);
    hooks.preview?.(r ? r.place.rooms.find(x => x.id === roomId)!.outline : null);
    return r;
  }
  const close = sheet('Add a part to ' + room.name, [
    h('div', { class: 'hint' }, 'For rooms made of two rectangles (an L shape): add the smaller rectangle here. You can also drag any wall on the plan.'),
    unitSwitch(unit, u => { unit = u; sync(); }), side.el, h('div', { class: 'grid2' }, w.el, d.el), off.el, hint, f.el,
  ], { onClose: () => { hooks.highlightWall?.(null, 0); hooks.preview?.(null); } });
  sync(); validate();
}

// + Door / Window, or edit an existing one
export function openOpeningForm(place: Place, roomId: string, done: Done, existing?: Opening, hooks: FormHooks = {}) {
  let unit = defaultUnit(place);
  const room0 = place.rooms.find(r => r.id === roomId) ?? place.rooms[0];
  if (!room0) return;
  const kind = selectField('Type', [['door', 'Door or doorway'], ['window', 'Window']], existing?.kind ?? 'door', () => { show(); validate(); });
  const roomSel = selectField('Room', roomOptions(place), room0.id, () => { sync(); validate(); });
  const room = () => place.rooms.find(r => r.id === roomSel.sel.value)!;
  const wall = selectField('Wall', wallOptions(room0), String(existing?.wall ?? 0), () => { sync(); validate(); });
  const sq = () => squareOf(place, room());
  const width = lengthField('Width', existing?.width ?? null, unit, sq(), () => validate());
  const off = lengthField('Distance from the wall\'s end', existing?.offset ?? null, unit, sq(), () => validate(), { allowZero: true });
  const offHint = h('div', { class: 'hint' });
  const sill = lengthField('Sill height (floor to bottom of window)', existing?.kind === 'window' ? existing.sill : 100, 'cm', sq(), () => validate(), { allowZero: true });
  const top = lengthField('Top height (floor to top of opening)', existing?.top ?? 205, 'cm', sq(), () => validate());
  const sillWrap = h('div', null, sill.el);
  const sw0 = existing?.swing === 'open' ? 'open' : existing?.swing ? `${existing.swing.into}-${existing.swing.hinge}` : 'room-start';
  const swing = selectField('Door', [], sw0, () => { hooks.highlightWall?.(room().id, Number(wall.sel.value)); validate(); });
  const swingWrap = h('div', null, swing.el);
  // labels in screen terms: which end of the wall the hinge is at
  function swingOptions() {
    const keep = swing.sel.value || sw0, wi = Number(wall.sel.value), st = wallStart(room().outline, wi).replace(' end', '');
    const other = ({ left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as Record<string, string>)[st] ?? 'other';
    swing.sel.replaceChildren(...([['open', 'No door (open doorway)'], ['room-start', `Opens into ${room().name}, hinge on the ${st}`], ['room-end', `Opens into ${room().name}, hinge on the ${other}`],
      ['out-start', `Opens outward, hinge on the ${st}`], ['out-end', `Opens outward, hinge on the ${other}`]] as [string, string][]).map(([v, t]) => h('option', { value: v }, t)));
    swing.sel.value = keep;
  }
  const swingValue = (): Swing | 'open' | null => { const v = swing.sel.value; if (kind.sel.value !== 'door' || !v) return null; if (v === 'open') return 'open'; const [into, hinge] = v.split('-'); return { into: into as Swing['into'], hinge: hinge as Swing['hinge'] }; };
  function show() { sillWrap.style.display = kind.sel.value === 'window' ? '' : 'none'; swingWrap.style.display = kind.sel.value === 'door' ? '' : 'none'; if (!existing) top.set(kind.sel.value === 'window' ? 210 : 205); }
  function sync() {
    width.setUnit(unit, sq()); off.setUnit(unit, sq());
    if (wall.sel.options.length !== room().outline.length || wall.sel.dataset.room !== room().id) { setWallOptions(wall.sel, room()); wall.sel.dataset.room = room().id; }
    const wi = Number(wall.sel.value);
    offHint.textContent = `Measured from the wall's ${wallStart(room().outline, wi)}. This wall is ${formatBoth(wallOf(room(), wi).length, sq())}.`;
    swingOptions();
    hooks.highlightWall?.(room().id, wi);
  }
  const f = footer(existing ? 'Save' : 'Add', () => { const r = validate(); if (r) { close(); done(r.place); } }, () => close());
  function validate() {
    const W = width.value(), O = off.value(), S = kind.sel.value === 'window' ? sill.value() : 0, T = top.value();
    return check(W != null && O != null && S != null && T != null, () => saveOpening(place, roomSel.sel.value, {
      id: existing && roomSel.sel.value === roomId ? existing.id : undefined, kind: kind.sel.value as Opening['kind'], wall: Number(wall.sel.value), offset: O!, width: W!, sill: S!, top: T!, swing: swingValue(),
    }), f);
  }
  const body: Node[] = [unitSwitch(unit, u => { unit = u; sync(); }), h('div', { class: 'grid2' }, kind.el, roomSel.el), wall.el, h('div', { class: 'grid2' }, width.el, off.el), offHint, h('div', { class: 'grid2' }, sillWrap, top.el), swingWrap, f.el];
  if (existing) body.push(h('button', { type: 'button', class: 'warn', onclick: async () => { if (await confirmDialog('Delete this ' + existing.kind + '?', 'Delete')) { close(); done(deleteOpening(place, roomId, existing.id).place); } } }, 'Delete ' + existing.kind));
  const close = sheet(existing ? 'Edit ' + existing.kind : '+ Door or window', body, { onClose: () => hooks.highlightWall?.(null, 0) });
  show(); sync(); validate();
}

// + Built-in (closet etc.): a fixed box standing against a wall
export function openBuiltInForm(place: Place, roomId: string, done: Done, existing?: BuiltIn, hooks: FormHooks = {}) {
  let unit = defaultUnit(place);
  const room0 = place.rooms.find(r => r.id === roomId) ?? place.rooms[0];
  if (!room0) return;
  const name = textField('Name', existing?.name ?? 'Closet', () => validate());
  const roomSel = selectField('Room', roomOptions(place), room0.id, () => { sync(); validate(); });
  const room = () => place.rooms.find(r => r.id === roomSel.sel.value)!;
  const sq = () => squareOf(place, room());
  // work out which wall and offset an existing built-in has
  let wi0 = 2, off0: number | null = null;
  if (existing) {
    // the wall its back is closest to
    let bestGap = Infinity;
    room0.outline.forEach((_, i) => {
      const wv = wallOf(room0, i);
      const t = (existing.x - wv.a.x) * wv.dir.x + (existing.z - wv.a.z) * wv.dir.z;
      if (t < 0 || t > wv.length) return;
      const gap = -((existing.x - wv.a.x) * wv.normalOut.x + (existing.z - wv.a.z) * wv.normalOut.z) - existing.d / 2;
      if (gap > -1 && gap < bestGap) { bestGap = gap; wi0 = i; }
    });
    const wv = wallOf(room0, wi0);
    off0 = Math.round(((existing.x - wv.a.x) * wv.dir.x + (existing.z - wv.a.z) * wv.dir.z - existing.w / 2) * 100) / 100;
  }
  const wall = selectField('Against which wall', wallOptions(room0), String(wi0), () => { sync(); validate(); });
  const w = lengthField('Width (along the wall)', existing?.w ?? null, unit, sq(), () => validate());
  const d = lengthField('Depth (out from the wall)', existing?.d ?? null, unit, sq(), () => validate());
  const hh = lengthField('Height', existing?.h ?? 240, 'cm', sq(), () => validate());
  const off = lengthField("Distance from the wall's end", off0 ?? 0, unit, sq(), () => validate(), { allowZero: true });
  const offHint = h('div', { class: 'hint' });
  function sync() {
    w.setUnit(unit, sq()); d.setUnit(unit, sq()); off.setUnit(unit, sq());
    if (wall.sel.dataset.room !== room().id) { if (wall.sel.dataset.room) setWallOptions(wall.sel, room()); wall.sel.dataset.room = room().id; }
    const i = Number(wall.sel.value);
    offHint.textContent = `Measured from the wall's ${wallStart(room().outline, i)}. This wall is ${formatBoth(wallOf(room(), i).length, sq())}.`;
    hooks.highlightWall?.(room().id, i);
  }
  const f = footer(existing ? 'Save' : 'Add', () => { const r = validate(); if (r) { close(); done(r.place); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), H = hh.value(), O = off.value();
    if (!name.input.value.trim()) { f.err.textContent = 'Enter a name'; f.ok.disabled = true; return null; }
    return check(W != null && D != null && H != null && O != null, () => {
      const wv = wallOf(room(), Number(wall.sel.value));
      const c = { x: wv.a.x + wv.dir.x * (O! + W! / 2) - wv.normalOut.x * (D! / 2), z: wv.a.z + wv.dir.z * (O! + W! / 2) - wv.normalOut.z * (D! / 2) };
      const rot = ((Math.round((Math.atan2(wv.normalOut.x, wv.normalOut.z) * 180) / Math.PI) % 360) + 360) % 360;
      return saveBuiltIn(place, roomSel.sel.value, { id: existing && roomSel.sel.value === roomId ? existing.id : undefined, name: name.input.value.trim(), x: c.x, z: c.z, w: W!, d: D!, h: H!, rot });
    }, f);
  }
  const body: Node[] = [unitSwitch(unit, u => { unit = u; sync(); }), h('div', { class: 'grid2' }, name.el, roomSel.el), wall.el, h('div', { class: 'grid3' }, w.el, d.el, hh.el), off.el, offHint, f.el];
  if (existing) body.push(h('button', { type: 'button', class: 'warn', onclick: async () => { if (await confirmDialog('Delete ' + existing.name + '?', 'Delete')) { close(); done(deleteBuiltIn(place, roomId, existing.id).place); } } }, 'Delete built-in'));
  const close = sheet(existing ? 'Edit ' + existing.name : '+ Built-in', body, { onClose: () => hooks.highlightWall?.(null, 0) });
  sync(); validate();
}

const MOUNT: Partial<Record<ItemType, number>> = { poster: 140, shelf: 120 };

// + Furniture: type, name, exact size
export function openFurnitureForm(place: Place, roomId: string, done: (p: Place, newId: string) => void) {
  let unit: Unit = 'cm', type: ItemType = 'sofa';
  const room = () => place.rooms.find(r => r.id === roomSel.sel.value)!;
  const roomSel = selectField('Room', roomOptions(place), roomId, () => { sync(); validate(); });
  const sq = () => squareOf(place, room());
  const name = textField('Name', TYPE_LABELS[type], () => validate());
  const [dw, dd, dh] = TYPE_DEFAULTS[type];
  const w = lengthField('Width', dw, unit, sq(), () => validate());
  const d = lengthField('Depth', dd, unit, sq(), () => validate());
  const hh = lengthField('Height', dh, 'cm', sq(), () => validate());
  const el = lengthField('Bottom height off the floor', 0, 'cm', sq(), () => validate(), { allowZero: true });
  const types = h('div', { class: 'types' });
  const typeBtns = (Object.keys(TYPE_LABELS) as ItemType[]).map(t => {
    const b = h('button', { type: 'button', 'aria-pressed': String(t === type), onclick: () => pick(t) }, TYPE_LABELS[t]);
    types.append(b); return [t, b] as const;
  });
  function pick(t: ItemType) {
    color = null; note.textContent = '';
    const prevLabel = TYPE_LABELS[type];
    type = t;
    for (const [k, b] of typeBtns) b.setAttribute('aria-pressed', String(k === t));
    if (!name.input.value.trim() || name.input.value === prevLabel) name.input.value = TYPE_LABELS[t];
    const [a, b, c] = TYPE_DEFAULTS[t]; w.set(a); d.set(b); hh.set(c); el.set(MOUNT[t] ?? 0);
    validate();
  }
  function sync() { w.setUnit(unit, sq()); d.setUnit(unit, sq()); }
  let color: string | null = null;
  // one of your own pieces: fills in its type, name, exact size and colour
  function pickMine(c: CatalogPiece) { pick(c.type); name.input.value = c.name; w.set(c.w); d.set(c.d); hh.set(c.h); el.set(0); color = c.color; note.textContent = c.note; validate(); }
  const note = h('div', { class: 'hint' });
  const mine = h('div', { class: 'field' }, h('label', null, 'Your furniture'),
    h('div', { class: 'types' }, ...MY_FURNITURE.map(c => h('button', { type: 'button', onclick: () => pickMine(c) }, c.name))),
    h('button', { type: 'button', onclick: () => {
      const r = addPieces(place, roomSel.sel.value, MY_FURNITURE);
      if (r.error || !r.ids) { f.err.textContent = r.error ?? 'Could not add'; return; }
      close(); done(r.place, r.ids[0]);
    } }, `Add all ${MY_FURNITURE.length} to this room`), note);
  const f = footer('Add', () => { const r = validate() as (EditResult & { id?: string }) | null; if (r) { close(); done(r.place, r.id!); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), H = hh.value(), E = el.value();
    return check(W != null && D != null && H != null && E != null, () => {
      const r = addItem(place, roomSel.sel.value, type, name.input.value, W!, D!, H!, E!);
      return r.error || !r.id || !color ? r : { ...setItemColor(r.place, r.id, color), id: r.id };
    }, f);
  }
  const close = sheet('+ Furniture', [mine, types, h('div', { class: 'grid2' }, name.el, roomSel.el), unitSwitch(unit, u => { unit = u; sync(); }),
    h('div', { class: 'grid3' }, w.el, d.el, hh.el), el.el,
    h('div', { class: 'hint' }, 'Width runs left to right as the piece faces you; depth is front to back. Sizes are exact; the shape only changes how it looks in 3D.'), f.el]);
  validate();
}

// Edit a piece: name, exact size, height off the floor
export function openItemEditor(place: Place, itemId: string, done: Done) {
  const it = place.items.find(i => i.id === itemId);
  if (!it) return;
  const room = place.rooms.find(r => r.id === it.roomId);
  const sq = squareOf(place, room);
  const parent = it.sitsOn ? place.items.find(i => i.id === it.sitsOn) : null;
  const name = textField('Name', it.name, () => validate());
  const w = lengthField('Width', it.w, 'cm', sq, () => validate());
  const d = lengthField('Depth', it.d, 'cm', sq, () => validate());
  const hh = lengthField('Height', it.h, 'cm', sq, () => validate());
  const el = lengthField('Bottom height off the floor', it.elevation, 'cm', sq, () => validate(), { allowZero: true });
  const f = footer('Save', () => { const r = validate(); if (r) { close(); done(r.place); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), H = hh.value(), E = parent ? it!.elevation : el.value();
    return check(W != null && D != null && H != null && E != null, () => {
      let r = renameItem(place, itemId, name.input.value); if (r.error) return r;
      r = resizeItem(r.place, itemId, { w: W!, d: D!, h: H! }); if (r.error) return r;
      if (!parent && E !== it!.elevation) r = setItemHeight(r.place, itemId, E!);
      return r;
    }, f);
  }
  const close = sheet('Edit ' + it.name, [name.el, h('div', { class: 'grid3' }, w.el, d.el, hh.el),
    parent ? h('div', { class: 'info' }, 'Sits on ', h('b', null, parent.name), '. Pick a height level to take it off.') : el.el, f.el,
    h('button', { type: 'button', class: 'warn', onclick: async () => { if (await confirmDialog('Delete ' + it.name + ' for good?', 'Delete')) { close(); done(deleteItem(place, itemId).place); } } }, 'Delete for good')]);
  validate();
}

// "300 cm × 405 cm" for a rectangle, the floor area for other shapes
export function sizeText(place: Place, r: Room): string {
  const b = roomBox(r), sq = squareOf(place, r);
  return r.outline.length === 4 ? `${formatBoth(b.x1 - b.x0, sq)} × ${formatBoth(b.z1 - b.z0, sq)}` : `${r.outline.length} walls, ${(areaOf(r.outline) / 10000).toFixed(2)} m² of floor`;
}

// Rooms list with editing of sizes, doors, windows and built-ins
export function openRoomsSheet(place: Place, done: Done, hooks: FormHooks = {}) {
  const list = h('div', { class: 'list' });
  for (const r of place.rooms) {
    list.append(h('div', { class: 'item' },
      h('div', null, h('b', null, r.name), h('div', { class: 'muted num' }, sizeText(place, r))),
      h('button', { type: 'button', onclick: () => { close(); openRoomEditor(place, r.id, done, hooks); } }, 'Edit')));
  }
  const close = sheet('Rooms', [list.childElementCount ? list : h('p', { class: 'muted' }, 'No rooms yet.'),
    h('button', { type: 'button', class: 'primary', onclick: () => { close(); openRoomForm(place, done, hooks); } }, '+ Room')]);
}

// One room: name, size, ceiling, square size, its doors/windows and built-ins
export function openRoomEditor(place: Place, roomId: string, done: Done, hooks: FormHooks = {}) {
  const r = place.rooms.find(x => x.id === roomId);
  if (!r) return;
  let unit = defaultUnit(place);
  const b = roomBox(r), rect = r.outline.length === 4;
  const name = textField('Name', r.name, () => validate());
  const sqF = lengthField('Floor square size (blank = place default ' + formatCm(place.squareCm) + ')', r.squareCm, 'cm', place.squareCm, () => { sync(); validate(); }, { placeholder: String(place.squareCm), optional: true });
  const sq = () => sqF.value() ?? place.squareCm;
  const w = lengthField('Width (left ↔ right)', b.x1 - b.x0, unit, sq(), () => validate());
  const d = lengthField('Length (top ↕ bottom)', b.z1 - b.z0, unit, sq(), () => validate());
  const ceil = lengthField('Ceiling height', r.ceiling, 'cm', sq(), () => validate());
  const sync = () => { w.setUnit(unit, sq()); d.setUnit(unit, sq()); };
  const f = footer('Save', () => { const res = validate(); if (res) { close(); done(res.place); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), C = ceil.value(), S = sqF.value();
    return check((!rect || (W != null && D != null)) && C != null && sqF.ok(), () => updateRoom(place, roomId, { name: name.input.value, ...(rect ? { w: W!, d: D! } : {}), ceiling: C!, squareCm: S }), f);
  }
  const ops = h('div', { class: 'list' }, ...r.openings.map(o => h('div', { class: 'item' },
    h('div', null, h('b', null, o.kind === 'door' ? 'Door' : 'Window'), h('div', { class: 'muted num' }, `${wallName(r.outline, o.wall)}, ${formatCm(o.width)} wide, ${formatCm(o.offset)} from the ${wallStart(r.outline, o.wall)}`)),
    h('button', { type: 'button', onclick: () => { close(); openOpeningForm(place, roomId, done, o, hooks); } }, 'Edit'))));
  const bis = h('div', { class: 'list' }, ...r.builtIns.map(bi => h('div', { class: 'item' },
    h('div', null, h('b', null, bi.name), h('div', { class: 'muted num' }, `${formatCm(bi.w)} × ${formatCm(bi.d)} × ${formatCm(bi.h)}`)),
    h('button', { type: 'button', onclick: () => { close(); openBuiltInForm(place, roomId, done, bi, hooks); } }, 'Edit'))));
  const close = sheet('Edit ' + r.name, [unitSwitch(unit, u => { unit = u; sync(); }), name.el,
    ...(rect ? [h('div', { class: 'grid2' }, w.el, d.el), h('div', { class: 'hint' }, 'Changing the size keeps the bottom-right corner in place. To move one wall, tap the room on the plan and drag the round handle on that wall.')]
      : [h('div', { class: 'info' }, sizeText(place, r) + '. To resize, tap the room on the plan and drag the round handle on a wall.')]),
    h('div', { class: 'grid2' }, ceil.el, sqF.el), f.el,
    h('button', { type: 'button', onclick: () => { close(); openRoomPartForm(place, roomId, done, hooks); } }, '+ Add a part (L shape)'),
    h('h2', null, 'Doors and windows'), ops,
    h('button', { type: 'button', onclick: () => { close(); openOpeningForm(place, roomId, done, undefined, hooks); } }, '+ Door or window'),
    h('h2', null, 'Built-ins'), bis,
    h('button', { type: 'button', onclick: () => { close(); openBuiltInForm(place, roomId, done, undefined, hooks); } }, '+ Built-in'),
    h('button', { type: 'button', class: 'warn', onclick: async () => {
      const n = place.items.filter(i => i.roomId === roomId).length;
      if (await confirmDialog(`Delete ${r.name}${n ? ` and the ${n} piece${n === 1 ? '' : 's'} in it` : ''}? This can't be undone.`, 'Delete room')) { close(); done(deleteRoom(place, roomId).place); }
    } }, 'Delete room')]);
  validate();
}

// Place settings: name, default square size, grid and snapping
export function openSettings(place: Place, done: Done) {
  const name = textField('Place name', place.name, () => validate());
  const sqF = lengthField('Default floor square size', place.squareCm, 'cm', place.squareCm, () => validate());
  const grid = h('input', { type: 'checkbox', checked: place.gridOn, style: { width: '22px', minHeight: '22px' } });
  const snap = h('input', { type: 'checkbox', checked: place.snapOn, style: { width: '22px', minHeight: '22px' } });
  const f = footer('Save', () => { const r = validate(); if (r) { close(); done(r.place); } }, () => close());
  function validate() {
    const S = sqF.value();
    return check(S != null, () => updatePlace(place, { name: name.input.value, squareCm: S!, gridOn: grid.checked, snapOn: snap.checked }), f);
  }
  grid.onchange = snap.onchange = () => validate();
  const close = sheet('Settings', [name.el, sqF.el,
    h('label', { class: 'row' }, grid, 'Show floor squares (and measure in squares)'),
    h('label', { class: 'row' }, snap, 'Snap when dragging (half squares with squares on, otherwise 5 cm)'), f.el]);
  validate();
}
