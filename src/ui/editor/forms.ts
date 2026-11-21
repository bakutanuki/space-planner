import type { BuiltIn, ItemType, Opening, Place } from '../../model/types';
import { squareOf, TYPE_DEFAULTS, TYPE_LABELS } from '../../model/types';
import { roomBox, wallOf, WALL_NAMES, WALL_START } from '../../model/rooms';
import { addItem, addRoom, deleteBuiltIn, deleteOpening, deleteRoom, deleteItem, renameItem, resizeItem, saveBuiltIn, saveOpening, setItemHeight, updatePlace, updateRoom, type EditResult } from '../../model/edit';
import { formatCm, formatBoth } from '../../model/units';
import { confirmDialog, h, lengthField, sheet, unitSwitch, type LengthField, type Unit } from '../dom';

type Done = (p: Place) => void;
export interface FormHooks { highlightWall?: (roomId: string | null, wall: number) => void }

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
const wallOptions = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [String(i), WALL_NAMES[i] ?? 'Wall ' + (i + 1)]);
const roomOptions = (p: Place): [string, string][] => p.rooms.map(r => [r.id, r.name]);
const defaultUnit = (p: Place): Unit => (p.gridOn ? 'sq' : 'cm');

// + Room: size, ceiling, square size; later rooms attach to a wall of another room
export function openRoomForm(place: Place, done: Done, hooks: FormHooks = {}) {
  let unit = defaultUnit(place);
  const first = place.rooms.length === 0;
  const name = textField('Name', first ? 'Room' : 'Room ' + (place.rooms.length + 1), () => validate());
  const sqF = lengthField('Floor square size (blank = place default ' + formatCm(place.squareCm) + ')', null, 'cm', place.squareCm, () => { sync(); validate(); }, { placeholder: String(place.squareCm), optional: true });
  const roomSq = () => sqF.value() ?? place.squareCm;
  const w = lengthField('Width (left to right)', null, unit, place.squareCm, () => validate());
  const d = lengthField('Depth (front to back)', null, unit, place.squareCm, () => validate());
  const ceil = lengthField('Ceiling height', 240, 'cm', place.squareCm, () => validate());
  const target = selectField('Attach to room', roomOptions(place), place.rooms[0]?.id ?? '', () => { sync(); validate(); });
  const wall = selectField('Which wall', wallOptions(4), '2', () => { sync(); validate(); });
  const offHint = h('div', { class: 'hint' });
  const off = lengthField('Distance along that wall', 0, unit, place.squareCm, () => validate(), { allowZero: true });
  const tgtRoom = () => place.rooms.find(r => r.id === target.sel.value);
  function sync() {
    w.setUnit(unit, roomSq()); d.setUnit(unit, roomSq());
    off.setUnit(unit, squareOf(place, tgtRoom()));
    const wi = Number(wall.sel.value), tr = tgtRoom();
    offHint.textContent = tr ? `Measured from the wall's ${WALL_START[wi]} (wall is ${formatBoth(wallOf(tr, wi).length, squareOf(place, tr))}). The new room's width runs along this wall.` : '';
    hooks.highlightWall?.(tr?.id ?? null, wi);
  }
  const f = footer(first ? 'Add room' : 'Add room', () => { const r = validate(); if (r) { close(); done(r.place); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), C = ceil.value(), O = off.value();
    const sqv = sqF.value();
    return check(W != null && D != null && C != null && sqF.ok() && (first || O != null), () => addRoom(place, {
      name: name.input.value, w: W!, d: D!, ceiling: C!, squareCm: sqv != null ? sqv : null,
      attach: first ? undefined : { roomId: target.sel.value, wall: Number(wall.sel.value), offset: O! },
    }), f);
  }
  const close = sheet('+ Room', [
    unitSwitch(unit, u => { unit = u; sync(); }),
    name.el, h('div', { class: 'grid2' }, w.el, d.el), h('div', { class: 'grid2' }, ceil.el, sqF.el),
    ...(first ? [] : [h('div', { class: 'grid2' }, target.el, wall.el), off.el, offHint]),
    f.el,
  ], { onClose: () => hooks.highlightWall?.(null, 0) });
  sync(); validate();
}

// + Door / Window, or edit an existing one
export function openOpeningForm(place: Place, roomId: string, done: Done, existing?: Opening, hooks: FormHooks = {}) {
  let unit = defaultUnit(place);
  const room0 = place.rooms.find(r => r.id === roomId) ?? place.rooms[0];
  if (!room0) return;
  const kind = selectField('Type', [['door', 'Door (or open doorway)'], ['window', 'Window']], existing?.kind ?? 'door', () => { show(); validate(); });
  const roomSel = selectField('Room', roomOptions(place), room0.id, () => { sync(); validate(); });
  const wall = selectField('Wall', wallOptions(4), String(existing?.wall ?? 0), () => { sync(); validate(); });
  const room = () => place.rooms.find(r => r.id === roomSel.sel.value)!;
  const sq = () => squareOf(place, room());
  const width = lengthField('Width', existing?.width ?? null, unit, sq(), () => validate());
  const off = lengthField('Distance from the wall\'s end', existing?.offset ?? null, unit, sq(), () => validate(), { allowZero: true });
  const offHint = h('div', { class: 'hint' });
  const sill = lengthField('Sill height (floor to bottom of window)', existing?.kind === 'window' ? existing.sill : 100, 'cm', sq(), () => validate(), { allowZero: true });
  const top = lengthField('Top height (floor to top of opening)', existing?.top ?? 205, 'cm', sq(), () => validate());
  const sillWrap = h('div', null, sill.el);
  function show() { sillWrap.style.display = kind.sel.value === 'window' ? '' : 'none'; if (!existing) top.set(kind.sel.value === 'window' ? 210 : 205); }
  function sync() {
    width.setUnit(unit, sq()); off.setUnit(unit, sq());
    const wi = Number(wall.sel.value);
    offHint.textContent = `Measured from the wall's ${WALL_START[wi]}. This wall is ${formatBoth(wallOf(room(), wi).length, sq())}.`;
    hooks.highlightWall?.(room().id, wi);
  }
  const f = footer(existing ? 'Save' : 'Add', () => { const r = validate(); if (r) { close(); done(r.place); } }, () => close());
  function validate() {
    const W = width.value(), O = off.value(), S = kind.sel.value === 'window' ? sill.value() : 0, T = top.value();
    return check(W != null && O != null && S != null && T != null, () => saveOpening(place, roomSel.sel.value, {
      id: existing && roomSel.sel.value === roomId ? existing.id : undefined, kind: kind.sel.value as Opening['kind'], wall: Number(wall.sel.value), offset: O!, width: W!, sill: S!, top: T!,
    }), f);
  }
  const body: Node[] = [unitSwitch(unit, u => { unit = u; sync(); }), h('div', { class: 'grid2' }, kind.el, roomSel.el), wall.el, h('div', { class: 'grid2' }, width.el, off.el), offHint, h('div', { class: 'grid2' }, sillWrap, top.el), f.el];
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
    const rb = roomBox(room0), t = Math.round(((existing.rot % 360) + 360) % 360);
    const along = t % 180 === 0;
    const hw = (along ? existing.w : existing.d) / 2, hd = (along ? existing.d : existing.w) / 2;
    const gaps = [existing.z - hd - rb.z0, rb.x1 - existing.x - hw, rb.z1 - existing.z - hd, existing.x - hw - rb.x0];
    wi0 = gaps.indexOf(Math.min(...gaps));
    const wv = wallOf(room0, wi0);
    off0 = Math.round(((existing.x - wv.a.x) * wv.dir.x + (existing.z - wv.a.z) * wv.dir.z - existing.w / 2) * 100) / 100;
  }
  const wall = selectField('Against which wall', wallOptions(4), String(wi0), () => { sync(); validate(); });
  const w = lengthField('Width (along the wall)', existing?.w ?? null, unit, sq(), () => validate());
  const d = lengthField('Depth (out from the wall)', existing?.d ?? null, unit, sq(), () => validate());
  const hh = lengthField('Height', existing?.h ?? 240, 'cm', sq(), () => validate());
  const off = lengthField("Distance from the wall's end", off0 ?? 0, unit, sq(), () => validate(), { allowZero: true });
  const offHint = h('div', { class: 'hint' });
  function sync() {
    w.setUnit(unit, sq()); d.setUnit(unit, sq()); off.setUnit(unit, sq());
    const i = Number(wall.sel.value);
    offHint.textContent = `Measured from the wall's ${WALL_START[i]}. This wall is ${formatBoth(wallOf(room(), i).length, sq())}.`;
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
    const prevLabel = TYPE_LABELS[type];
    type = t;
    for (const [k, b] of typeBtns) b.setAttribute('aria-pressed', String(k === t));
    if (!name.input.value.trim() || name.input.value === prevLabel) name.input.value = TYPE_LABELS[t];
    const [a, b, c] = TYPE_DEFAULTS[t]; w.set(a); d.set(b); hh.set(c); el.set(MOUNT[t] ?? 0);
    validate();
  }
  function sync() { w.setUnit(unit, sq()); d.setUnit(unit, sq()); }
  const f = footer('Add', () => { const r = validate() as (EditResult & { id?: string }) | null; if (r) { close(); done(r.place, r.id!); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), H = hh.value(), E = el.value();
    return check(W != null && D != null && H != null && E != null, () => addItem(place, roomSel.sel.value, type, name.input.value, W!, D!, H!, E!), f);
  }
  const close = sheet('+ Furniture', [types, h('div', { class: 'grid2' }, name.el, roomSel.el), unitSwitch(unit, u => { unit = u; sync(); }),
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

// Rooms list with editing of sizes, doors, windows and built-ins
export function openRoomsSheet(place: Place, done: Done, hooks: FormHooks = {}) {
  const list = h('div', { class: 'list' });
  for (const r of place.rooms) {
    const b = roomBox(r), sq = squareOf(place, r);
    list.append(h('div', { class: 'item' },
      h('div', null, h('b', null, r.name), h('div', { class: 'muted num' }, `${formatBoth(b.x1 - b.x0, sq)} × ${formatBoth(b.z1 - b.z0, sq)}`)),
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
  const b = roomBox(r);
  const name = textField('Name', r.name, () => validate());
  const sqF = lengthField('Floor square size (blank = place default ' + formatCm(place.squareCm) + ')', r.squareCm, 'cm', place.squareCm, () => { sync(); validate(); }, { placeholder: String(place.squareCm), optional: true });
  const sq = () => sqF.value() ?? place.squareCm;
  const w = lengthField('Width', b.x1 - b.x0, unit, sq(), () => validate());
  const d = lengthField('Depth', b.z1 - b.z0, unit, sq(), () => validate());
  const ceil = lengthField('Ceiling height', r.ceiling, 'cm', sq(), () => validate());
  const sync = () => { w.setUnit(unit, sq()); d.setUnit(unit, sq()); };
  const f = footer('Save', () => { const res = validate(); if (res) { close(); done(res.place); } }, () => close());
  function validate() {
    const W = w.value(), D = d.value(), C = ceil.value(), S = sqF.value();
    return check(W != null && D != null && C != null && sqF.ok(), () => updateRoom(place, roomId, { name: name.input.value, w: W!, d: D!, ceiling: C!, squareCm: S }), f);
  }
  const ops = h('div', { class: 'list' }, ...r.openings.map(o => h('div', { class: 'item' },
    h('div', null, h('b', null, o.kind === 'door' ? 'Door' : 'Window'), h('div', { class: 'muted num' }, `${WALL_NAMES[o.wall]}, ${formatCm(o.width)} wide, ${formatCm(o.offset)} from the ${WALL_START[o.wall]}`)),
    h('button', { type: 'button', onclick: () => { close(); openOpeningForm(place, roomId, done, o, hooks); } }, 'Edit'))));
  const bis = h('div', { class: 'list' }, ...r.builtIns.map(bi => h('div', { class: 'item' },
    h('div', null, h('b', null, bi.name), h('div', { class: 'muted num' }, `${formatCm(bi.w)} × ${formatCm(bi.d)} × ${formatCm(bi.h)}`)),
    h('button', { type: 'button', onclick: () => { close(); openBuiltInForm(place, roomId, done, bi, hooks); } }, 'Edit'))));
  const close = sheet('Edit ' + r.name, [unitSwitch(unit, u => { unit = u; sync(); }), name.el, h('div', { class: 'grid2' }, w.el, d.el), h('div', { class: 'grid2' }, ceil.el, sqF.el),
    h('div', { class: 'hint' }, 'Changing the size keeps the corner nearest the window side fixed.'), f.el,
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
