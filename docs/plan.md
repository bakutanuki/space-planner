# Space Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-file `Apartment Layout Planner.html` into a hosted personal web app (home page of places + editor) with typed rooms, doors, windows, built-ins and furniture, 2D/3D views, height levels, floor-square measuring, stacking, overlap warnings, and phone/computer sync.

**Architecture:** A static Vite + TypeScript single-page app served by GitHub Pages at `plan.mishpabox.com`. All layout rules (geometry, placement, stacking, overlap, units, levels) live in pure, unit-tested modules under `src/model/`; three.js rendering and DOM UI under `src/ui/` consume them. Places are stored as one JSON document per row in Supabase (GitHub sign-in, row-level security), with a local cache and a save queue for offline use and conflict detection.

**Tech Stack:** Vite 5, TypeScript 5 (strict), three 0.170.0, @supabase/supabase-js 2, Vitest 2 (+ jsdom for DOM-touching tests), GitHub Actions + GitHub Pages.

**Spec:** Notion page "Space Planner — Requirements & Design" — https://app.notion.com/p/41f7cf362a528190b18ce991f74ef3bf . Section numbers below (§7.4 etc.) refer to it. Source file being ported: `W:\Download\Apartment Layout Planner.html`.

## Global Constraints

- All model lengths are **centimetres** (`number`, may be fractional, e.g. half of a 33 cm square). three.js scene units are metres: `m = cm / 100`. Never round stored values; display rounding only.
- Rotation is integer degrees in `[0, 360)`.
- Free tiers only: GitHub (code, Pages, Actions), Supabase.
- Hosted at `plan.mishpabox.com` (domain at Porkbun). Hash routing (`#/`, `#/place/<id>`) so Pages never 404s.
- Works on touch (phone) and mouse (computer), current Chrome, Safari, Edge. 16 px side gutter, no horizontal page scroll at phone width.
- Metric units in UI (cm / m). Squares shown as e.g. `13½ sq · 4.05 m`.
- Sign-in: GitHub via Supabase only. No Google. Claude never handles the owner's passwords or keys; the owner pastes them.
- Default ceiling height 240 cm. Default wall thickness 10 cm. Default square size 30 cm.
- Height levels (exact): 1 Floor 0 cm, 2 Seat 45 cm, 3 Table 75 cm, 4 Counter 90 cm, 5 Eye level 150 cm.
- Visual style starts from the current planner: `--paper #f4f2ee`, `--ink #1e1d1b`, `--muted #6b675f`, `--line #d8d3c9`, `--accent #2f6fde`, font Archivo; plus dark-mode tokens.
- **Learning docs (owner requirement, done last):** speed first. During tasks, only comment each exported function in one plain-English line. After Task 14, write `docs/HOW-IT-WORKS.md` (and a Notion "How it works" page): how the 3D scene becomes the 2D plan, how the site is built and deployed, how saving works, and a "when something breaks" table.
- Commit after every task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Bad numbers in any form** (empty, 0, negative, letters, `1e9`, square input not a multiple of ½) → field shows an error, nothing is applied or saved. Test in Task 2 (`parseLength`) and Task 10.
2. **Both devices edit the same place, one offline** → on reconnect the second save gets a conflict dialog (keep mine / use the other), never a silent overwrite. Test in Task 12.
3. **New room that would overlap an existing room** (bad offset on attach) → refused with a message, place unchanged. Test in Task 3.
4. **Piece bigger than its room** (e.g. 400 cm sofa in a 300 cm room) → placement refuses with a message instead of jittering or escaping through a wall. Test in Task 5.
5. **Removing a piece other pieces sit on, or signing out/session expiry mid-edit** → children drop to their own stored height and stay in place; unsaved edits stay in the local queue and save after sign-in. Tests in Task 6 and Task 12.

---

## File Structure

```
space-planner/
  index.html                     app shell, Archivo font
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts
  .env.example                   VITE_SUPABASE_URL=, VITE_SUPABASE_ANON_KEY=
  public/CNAME                   plan.mishpabox.com
  .github/workflows/deploy.yml   test + build + deploy to Pages
  supabase/schema.sql            places table + RLS
  docs/SETUP.md                  owner's click-by-click setup (mirrored to Notion)
  src/
    main.ts                      boot, router, auth gate
    styles.css                   tokens (light + dark), base components
    model/types.ts               all data types
    model/units.ts               cm / m / squares parsing + formatting
    model/levels.ts              LEVELS, levelForHeight
    model/geometry.ts            vectors, rotated footprints, SAT, polygon helpers
    model/rooms.ts               room/opening/built-in creation, walls, attach, buildWalls
    model/seed.ts                the current apartment as a Place
    model/placement.ts           clamp in room, built-ins, door passage, wall snap
    model/stacking.ts            sits-on, effective elevation, moving children
    model/overlap.ts             overlap detection with allow-list
    model/edit.ts                pure edit operations on a Place (used by UI + undo-free)
    data/supabase.ts             client
    data/auth.ts                 GitHub sign-in/session
    data/repo.ts                 CRUD + versioned save against Supabase
    data/cache.ts                localStorage cache
    data/saveQueue.ts            debounce, retry, conflict, status
    ui/dom.ts                    tiny h() helper, toast, dialog, number field
    ui/signin.ts                 sign-in screen + "database paused" message
    ui/home.ts                   places list
    ui/editor/editor.ts          editor screen composition
    ui/editor/scene.ts           Place → three.js scene (rooms, walls, floors, grid, built-ins)
    ui/editor/furniture3d.ts     per-type 3D builders (ported)
    ui/editor/views.ts           2D orthographic / 3D perspective cameras, scope framing
    ui/editor/overlays.ts        2D labels, dimensions, distance-to-walls, level tint, overlap outlines
    ui/editor/interaction.ts     pick, drag, drop-to-stack
    ui/editor/panels.ts          selection panel, level picker, item editor
    ui/editor/forms.ts           + Room, + Door/Window, + Built-in, + Furniture forms
    ui/editor/thumbnail.ts       2D plan → small PNG data URL
  tests/                         mirrors src/model and src/data
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/styles.css`, `.gitignore` (node_modules, dist, .env.local), `.env.example`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm run dev` (port 5173), `npm test` (vitest run), `npm run build` (tsc --noEmit && vite build → `dist/`). `src/styles.css` CSS tokens listed in Global Constraints.

- [ ] **Step 1:** `git init` in `space-planner/`, create files. Pin `three@0.170.0`, `@types/three@0.170.0`, `@supabase/supabase-js@^2.45.0`, `vite@^5.4.0`, `typescript@^5.6.0`, `vitest@^2.1.0`, `jsdom@^25.0.0`. `tsconfig` strict, `moduleResolution: "bundler"`. `vite.config.ts` `base: '/'`.
- [ ] **Step 2:** `tests/smoke.test.ts`: `expect(1 + 1).toBe(2)`; `src/main.ts` renders `<h1>Space Planner</h1>` into `#app`.
- [ ] **Step 3:** Run `npm install && npm test && npm run build`. Expected: 1 test passes, `dist/index.html` exists.
- [ ] **Step 4:** Commit `chore: scaffold Vite + TypeScript app`.

---

### Task 2: Data types, units, levels

**Files:**
- Create: `src/model/types.ts`, `src/model/units.ts`, `src/model/levels.ts`
- Test: `tests/model/units.test.ts`, `tests/model/levels.test.ts`

**Interfaces:**
- Produces (`types.ts`):
```ts
export type Pt = { x: number; z: number };                       // cm
export type OpeningKind = 'door' | 'window';
export interface Opening { id: string; kind: OpeningKind; wall: number; offset: number; width: number; sill: number; top: number } // door: sill 0, top 205
export interface BuiltIn { id: string; name: string; x: number; z: number; w: number; d: number; h: number; rot: number } // center, cm
export interface Room { id: string; name: string; outline: Pt[]; ceiling: number; squareCm: number | null; openings: Opening[]; builtIns: BuiltIn[] }
export type ItemType = 'chair'|'sofa'|'bed'|'table'|'roundTable'|'nightstand'|'lamp'|'tv'|'poster'|'shelf'|'rug'|'box'|'beanbag'|'treadmill';
export interface Item { id: string; type: ItemType; name: string; w: number; d: number; h: number; x: number; z: number; rot: number;
  roomId: string; elevation: number; sitsOn: string | null; allowOverlapWith: string[]; removed: boolean }
export interface Place { id: string; name: string; squareCm: number; wallThickness: number; rooms: Room[]; items: Item[]; gridOn: boolean; snapOn: boolean }
export const newId: () => string; // crypto.randomUUID()
```
  Walls of a room: wall `i` runs from `outline[i]` to `outline[(i+1) % n]`; `offset` is measured from that wall's start point. Rectangles are created as `[(x0,z0),(x1,z0),(x1,z1),(x0,z1)]`.
  `beanbag` and `treadmill` keep the current file's look for the imported apartment.
- Produces (`units.ts`):
  - `formatCm(cm: number): string` → `"405 cm"`; fractional shows one decimal `"16.5 cm"`.
  - `formatM(cm: number): string` → `"4.05 m"` (2 decimals, 3 if needed: `622.5 → "6.225 m"`).
  - `toSquares(cm: number, squareCm: number): number`; `formatSquares(cm, squareCm): string` → `"13½ sq"`, `"10 sq"`, or `"≈13.3 sq"` when not a half multiple.
  - `formatBoth(cm, squareCm): string` → `"13½ sq · 4.05 m"`.
  - `parseLength(input: string, unit: 'cm'|'sq', squareCm: number): { ok: true; cm: number } | { ok: false; error: string }`. The cm unit accepts plain numbers only (`"405"`, `"16.5"`); the sq unit accepts `"13.5"`, `"13½"`, `"13 1/2"`. Rejects empty, ≤0, non-numeric, > 5000 cm, sq not multiple of 0.5. Error strings: `"Enter a number"`, `"Must be more than 0"`, `"Too large (max 50 m)"`, `"Use whole or half squares"`.
- Produces (`levels.ts`): `LEVELS: readonly {n:1|2|3|4|5; name:string; cm:number; color:string}[]` with the exact heights from Global Constraints (colors: builder's choice, distinct, readable in light and dark); `levelForHeight(cm: number): Level` = nearest by absolute difference, anything ≥150 → level 5.

- [ ] **Step 1: Write failing tests**
```ts
expect(formatBoth(405, 30)).toBe('13½ sq · 4.05 m');
expect(formatBoth(300, 30)).toBe('10 sq · 3.00 m');
expect(formatM(622.5)).toBe('6.225 m');
expect(parseLength('13½', 'sq', 30)).toEqual({ ok: true, cm: 405 });
expect(parseLength('13 1/2', 'sq', 30)).toEqual({ ok: true, cm: 405 });
expect(parseLength('13.3', 'sq', 30)).toEqual({ ok: false, error: 'Use whole or half squares' });
for (const bad of ['', 'abc', '0', '-5']) expect(parseLength(bad, 'cm', 30).ok).toBe(false);
expect(parseLength('1e9', 'cm', 30)).toEqual({ ok: false, error: 'Too large (max 50 m)' });
expect(levelForHeight(0).n).toBe(1); expect(levelForHeight(60).n).toBe(2);
expect(levelForHeight(85).n).toBe(4); expect(levelForHeight(220).n).toBe(5);
expect(LEVELS.map(l => l.cm)).toEqual([0, 45, 75, 90, 150]);
```
- [ ] **Step 2:** `npm test` → FAIL (modules missing).
- [ ] **Step 3:** Implement the three modules.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(model): types, units and height levels`.

---

### Task 3: Rooms, openings, built-ins, walls

**Files:**
- Create: `src/model/geometry.ts`, `src/model/rooms.ts`
- Test: `tests/model/geometry.test.ts`, `tests/model/rooms.test.ts`

**Interfaces:**
- Consumes: `types.ts`.
- Produces (`geometry.ts`):
  - `footprint(c: Pt, w: number, d: number, rotDeg: number): Pt[]` (4 corners); `aabb(pts: Pt[]): {x0,z0,x1,z1}`
  - `polysIntersect(a: Pt[], b: Pt[]): boolean` (SAT, convex; touching edges = false)
  - `circleIntersectsPoly(c: Pt, r: number, p: Pt[]): boolean`
  - `pointInPoly(p: Pt, poly: Pt[]): boolean`; `distToSegment(p, a, b): number`
- Produces (`rooms.ts`):
  - `createRoom(name: string, w: number, d: number, origin: Pt, ceiling = 240): Room`
  - `wallOf(room: Room, i: number): { a: Pt; b: Pt; length: number; normalOut: Pt }`
  - `attachRoom(place: Place, target: { roomId: string; wall: number }, name: string, w: number, d: number, offset: number): { ok: true; room: Room } | { ok: false; error: string }` — new room sits outside the target wall, separated by `place.wallThickness`, its corner `offset` cm along the wall from the wall's start. Width `w` runs along the target wall. Error `"Overlaps <room name>"` if its outline intersects any existing room grown by the wall thickness.
  - `addOpening(room: Room, o: Omit<Opening,'id'>): { ok: true; opening: Opening } | { ok: false; error: string }` — errors: `"Doesn't fit on this wall"` (offset+width > wall length or <0), `"Overlaps another door or window"`, window `top > ceiling`.
  - `addBuiltIn(room: Room, b: Omit<BuiltIn,'id'>): Result` — must lie inside the room outline.
  - `buildWalls(place: Place): WallSeg[]` where `WallSeg = { a: Pt; b: Pt; thickness: number; side: Pt; holes: { from: number; to: number; sill: number; top: number }[]; height: number }`. Each room edge is offset outward by half thickness. **Shared walls:** where an edge of room A faces an edge of room B at distance `wallThickness` (parallel, opposite normals, overlapping span), the overlapping span is emitted **once** (by the room earlier in `place.rooms`) with the holes of both rooms' openings in that span; the remaining parts of each edge are emitted normally. Corners extend by half thickness so walls meet without gaps (as `buildRun` does today with `-T … +T`).
  - `connectingDoors(place: Place, roomA: string, roomB: string): { a: Pt; b: Pt }[]` — door spans (world coords along the shared wall) that join two rooms.

- [ ] **Step 1: Write failing tests**
```ts
const r = createRoom('Room', 300, 405, { x: 0, z: 0 });
expect(r.outline).toEqual([{x:0,z:0},{x:300,z:0},{x:300,z:405},{x:0,z:405}]);
expect(wallOf(r, 2).length).toBe(300);
expect(addOpening(r, { kind:'door', wall:2, offset:250, width:75, sill:0, top:205 })).toMatchObject({ ok:false, error:"Doesn't fit on this wall" });
const place = { ...emptyPlace(), rooms: [r] };              // emptyPlace: test helper
const lr = attachRoom(place, { roomId: r.id, wall: 2 }, 'LR', 307.5, 622.5, 180); // corner 180 cm from (300,405) towards (0,405)
expect(lr.ok && aabb(lr.room.outline)).toEqual({ x0: -187.5, z0: 415, x1: 120, z1: 1037.5 });
expect(attachRoom({ ...place, rooms:[r, lr.room] }, { roomId: r.id, wall: 2 }, 'X', 100, 100, 200))
  .toMatchObject({ ok:false, error:'Overlaps LR' });
// shared wall emitted once, with door hole from Room's wall 2
addOpening(r, { kind:'door', wall:2, offset:225, width:75, sill:0, top:205 });
const segs = buildWalls({ ...place, rooms:[r, lr.room] });
const atSplit = segs.filter(s => s.a.z === 410 && s.b.z === 410);
expect(atSplit.some(s => s.holes.length === 1)).toBe(true);
expect(connectingDoors({ ...place, rooms:[r, lr.room] }, r.id, lr.room.id)).toHaveLength(1);
expect(polysIntersect(footprint({x:0,z:0},100,50,0), footprint({x:100,z:0},100,50,0))).toBe(false); // touching
expect(polysIntersect(footprint({x:0,z:0},100,50,45), footprint({x:80,z:0},100,50,0))).toBe(true);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. Shared-wall detection: for each edge pair, check parallel + opposite `normalOut` + perpendicular distance ≈ `wallThickness` (±0.5 cm) + 1-D span overlap > 0.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(model): rooms, openings, built-ins and wall building`.

---

### Task 4: Import the current apartment

**Files:**
- Create: `src/model/seed.ts`
- Test: `tests/model/seed.test.ts`

**Interfaces:**
- Consumes: `createRoom`, `addOpening`, `addBuiltIn`, `connectingDoors`.
- Produces: `seedApartment(): Place` (name `"Apartment"`, `squareCm 30`, `wallThickness 10`, `gridOn true`, `snapOn false`).

Values (cm, converted from the HTML file, outline order as in Task 2):
- **Room** origin (0,0), 300 × 405. Window wall 0 offset 80 width 150 sill 100 top 210. Door wall 2 offset 225 width 75 (the doorway at x 0–75). Built-in "Closet" center (187.5, 367.5), w 225, d 75, h 240, rot 0.
- **Living room** from `attachRoom(Room wall 2, w 307.5, d 622.5, offset 180)` → x −187.5…120, z 415…1037.5. Doors (top 205): wall 0 offset 97.5 width 70 (to bedroom); wall 1 offset 10 width 108 and offset 535 width 81; wall 3 offset 29.5 width 102. Window wall 2 offset 82 width 128 sill 100 top 210.
- **Items** (center x, z, rot, all `roomId` = Room, `elevation 0`):
  - TV stand (`box`) 140×40×60 at (280,175) rot 270
  - TV (`tv`) 168×5×97 at (280,175) rot 270, `sitsOn` = TV stand
  - Sofa, 3-seat (`sofa`) 205×90×85 at (45,192.5) rot 90
  - Loveseat (`sofa`) 155×90×85 at (155,45) rot 0
  - Coffee table (`table`) 100×60×44 at (165,195) rot 90
  - Side table (`nightstand`) 55×45×62 at (22.5,325) rot 90
  - Treadmill, folded (`treadmill`) 75×35×142 at (37.5,17.5) rot 0
  - Floor lamp (`lamp`) 30×30×55 at (25,62) rot 0
  - Bean bag (`beanbag`) 76×76×47 at (205,285) rot 0

- [ ] **Step 1: Failing tests:** 2 rooms; `formatBoth(300,30)`/`formatBoth(405,30)` of Room → `10 sq`, `13½ sq`; `connectingDoors` Room↔LR length 1; 9 items; TV `sitsOn` = TV stand id; every opening passed `addOpening` (`ok`).
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(model): seed the current apartment`.

---

### Task 5: Placement rules

**Files:**
- Create: `src/model/placement.ts`
- Test: `tests/model/placement.test.ts`

**Interfaces:**
- Consumes: geometry, rooms (`connectingDoors`, `wallOf`). Built-in checks use `item.elevation` directly.
- Produces:
  - `isWallItem(item: Item): boolean` — `poster`, `shelf`, or `tv` with `elevation > 0 && sitsOn === null`.
  - `placeItem(place: Place, item: Item, target: Pt): { ok: true; x: number; z: number; roomId: string } | { ok: false; error: string }`
    1. Room switch: if `target` lies in another room and the segment from the item's current center to `target` passes within 5 cm of a `connectingDoors` span between the two rooms, switch `roomId`; otherwise stay in the current room.
    2. Clamp the rotated footprint's AABB inside the room's outline (rooms are rectangles today; generalize later).
    3. Built-ins: if footprint intersects a built-in and `item.elevation < builtIn.h`, push out along the axis of least penetration (as the current `place()` does with the closet), then re-clamp.
    4. Wall items: snap to the nearest wall: `rot` set so the item's back faces the wall, back edge flush with the wall's inner face.
    5. If the item can't fit inside the room at its rotation: `{ ok:false, error:"Too big for <room name>" }`.
  - `snapPoint(p: Pt, place: Place, room: Room): Pt` — when `place.snapOn`: half-square steps if `place.gridOn` (square = `room.squareCm ?? place.squareCm`, grid origin = room's first outline corner), else 5 cm steps.
  - `distancesToWalls(place: Place, item: Item): { wall: number; cm: number }[]` — gap from each footprint side to the nearest wall in that direction (for the 2D readout).

- [ ] **Step 1: Failing tests** (use `seedApartment()`):
```ts
// clamp: dragging the coffee table past the wall stops at the wall
expect(placeItem(p, table, { x: 1000, z: 195 })).toMatchObject({ ok:true, x: 300 - 30 });
// closet push-out: lamp dropped inside the closet ends outside it
const r1 = placeItem(p, lamp, { x: 200, z: 380 }); expect(r1.ok && r1.z <= 330 - 15).toBe(true);
// room switch only through the door
expect(placeItem(p, lamp, { x: 40, z: 600 })).toMatchObject({ roomId: lr.id });   // path via door x 0–75
expect(placeItem(p, beanbag, { x: 250, z: 600 })).toMatchObject({ roomId: room.id }); // no door at x 250
// too big (Review Focus 4)
expect(placeItem(p, { ...sofa, w: 450 }, { x: 150, z: 200 })).toEqual({ ok:false, error:'Too big for Room' });
// wall snap
const poster = { ...newItem('poster', 70, 2, 100), elevation: 150 };
expect(placeItem(p, poster, { x: 150, z: 20 })).toMatchObject({ ok:true, z: 1 });
expect(snapPoint({ x: 47, z: 31 }, { ...p, snapOn:true }, room)).toEqual({ x: 45, z: 30 });
```
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(model): placement, door passage, wall snap, grid snap`.

---

### Task 6: Stacking, overlap, edit operations

**Files:**
- Create: `src/model/stacking.ts`, `src/model/overlap.ts`, `src/model/edit.ts`
- Test: `tests/model/stacking.test.ts`, `tests/model/overlap.test.ts`, `tests/model/edit.test.ts`

**Interfaces:**
- Produces (`stacking.ts`):
  - `effectiveElevation(place: Place, item: Item): number` — `sitsOn` → parent's effective elevation + parent `h`; else `item.elevation`. Cycle-safe.
  - `canSitOn(place, child, parent): boolean` — parent not removed, not a descendant of child, not `rug`/`poster`/`lamp`/`tv`, child center inside parent footprint.
  - `childrenOf(place, id): Item[]` (direct + transitive).
- Produces (`overlap.ts`): `findOverlaps(place: Place): Map<string, string[]>` — pairs of non-removed items in the same room whose footprints intersect (circle for `roundTable`/`beanbag`) **and** whose height ranges `[e, e+h)` intersect; skip any pair where one sits (transitively) on the other, any `rug`, and pairs listed in either item's `allowOverlapWith`.
- Produces (`edit.ts`) — every UI change goes through these; each returns `EditResult = { place: Place; error?: string }` with a new, immutable `Place` (unchanged place + `error` on failure):
  - `moveItem(place, id, target: Pt)` (uses `placeItem`; moves children by the same delta; on drop, sets/clears `sitsOn` via `canSitOn` against the topmost item under the center)
  - `rotateItem(place, id, deg)` (children rotate around parent center)
  - `setItemLevel(place, id, n: 1|2|3|4|5)` (sets `elevation = LEVELS[n].cm`, clears `sitsOn`), `setItemHeight(place, id, cm)`
  - `resizeItem(place, id, {w,d,h})`, `renameItem`, `addItem(place, roomId, type, name, w, d, h)` (placed at room center via `placeItem`)
  - `removeItem(place, id)` (sets `removed`; children get `sitsOn = null` keeping their own `elevation`), `restoreItem(place, id)`
  - `allowOverlap(place, id)` — sets `allowOverlapWith` to the item's current overlap partners.
  - `addRoom`, `updateRoom`, `deleteRoom` (deleting a room removes its items after UI confirmation), `addOpeningTo`, `addBuiltInTo`, `setSquareSize(place, roomId | null, cm)`.

- [ ] **Step 1: Failing tests:**
```ts
expect(effectiveElevation(p, tv)).toBe(60);
// moving the stand carries the TV
const p2 = moveItem(p, stand.id, { x: 270, z: 175 }).place; expect(item(p2, tv.id).z).toBe(item(p2, stand.id).z);
// poster above sofa: no overlap; lamp on table: no overlap; two sofas on floor: overlap
expect(findOverlaps(withPosterAboveSofa).size).toBe(0);
expect(findOverlaps(twoSofasOverlapping).get(sofaA.id)).toEqual([sofaB.id]);
// allow overlap, then move into a third piece → warns again for the new pair only
const q = allowOverlap(twoSofasOverlapping, sofaA.id).place;
expect(findOverlaps(q).size).toBe(0);
const q2 = moveItem(q, sofaA.id, beanbagCenter).place; expect(findOverlaps(q2).get(sofaA.id)).toEqual([beanbag.id]);
// removing the stand drops the TV to its own elevation (Review Focus 5)
const p3 = removeItem(p, stand.id).place; expect(item(p3, tv.id).sitsOn).toBeNull(); expect(effectiveElevation(p3, item(p3, tv.id))).toBe(0);
expect(setItemLevel(p, lamp.id, 3).place.items.find(i => i.id === lamp.id)!.elevation).toBe(75);
```
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(model): stacking, overlap detection and edit operations`.

---

### Task 7: 3D scene from a Place

**Files:**
- Create: `src/ui/editor/scene.ts`, `src/ui/editor/furniture3d.ts`, `src/ui/dom.ts`
- Modify: `src/main.ts` (temporary dev route `#/dev` that shows `seedApartment()` with no sign-in; removed in Task 13)

**Interfaces:**
- Consumes: `buildWalls`, `effectiveElevation`, `levelForHeight`, `Place`.
- Produces:
  - `createSceneView(container: HTMLElement): SceneView` with `setPlace(place: Place): void` (diff-free rebuild is fine), `render(): void`, `renderer`, `scene`, `camera` slot, `pickables: Map<THREE.Object3D, string /*item id*/>`, `setLevelTint(on: boolean)`, `setOverlaps(ids: Set<string>)`, `setSelected(id: string | null)`, `dispose()`.
  - `buildFurniture(item: Item): THREE.Group` — front faces +z, footprint w × d, height h. Port the current file's sofa, TV, table, side table (→ nightstand), treadmill, lamp, bean bag builders, scaled to the item's w/d/h; new simple builders for chair, bed, roundTable, poster (thin frame), shelf, rug (2 cm slab), box.
  - `ui/dom.ts`: `h(tag, attrs, ...children)`, `toast(msg)`, `confirmDialog(text, okLabel): Promise<boolean>`, `numberField(label, unit: 'cm'|'sq', squareCm, value, onValid)` (uses `parseLength`, shows error text under the field).
- Rendering rules: floor per room with the tile texture from the current file (square size = room's square, grid lines only when `place.gridOn`, grid origin = first outline corner); walls from `buildWalls` with door/window holes and glass; wall fading exactly as today's `render()`; built-ins as dark boxes; room name + `formatBoth` size as floor labels; lighting/shadows as today.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify in browser:** `npm run dev`, open `http://localhost:5173/#/dev`. Expected: same apartment as the original file (Room with closet and window, Living room with its doors and window, 9 pieces, TV on stand); grid lines 30 cm match the old tiles; Room label reads `10 × 13½ sq`; walls fade when orbiting. Side-by-side screenshot with the original file looks equivalent.
- [ ] **Step 3:** `npm test && npm run build` pass. Commit `feat(ui): render a Place in 3D`.

---

### Task 8: Views, overlays, selection and dragging

**Files:**
- Create: `src/ui/editor/views.ts`, `src/ui/editor/overlays.ts`, `src/ui/editor/interaction.ts`, `src/ui/editor/panels.ts`, `src/ui/editor/editor.ts`

**Interfaces:**
- Consumes: `SceneView`, `edit.ts` operations, `findOverlaps`, `distancesToWalls`, `snapPoint`, `LEVELS`.
- Produces: `mountEditor(root: HTMLElement, place: Place, onChange: (p: Place) => void): { destroy(): void }`. Every edit calls `onChange` with the new Place (Task 12 wires it to saving).
- Behaviour:
  - **Header:** back to home, place name, `2D` / `3D` toggle, Save picture. **Scope bar:** one button per room + "All".
  - **2D:** `THREE.OrthographicCamera` looking straight down, framed to scope; pan + pinch zoom, no orbit. **3D:** perspective camera framed like today's `view3d()`.
  - **Overlays (2D):** room labels and sizes (`formatBoth`); selected piece's distances to walls (`formatCm`) drawn as dimension lines while dragging; red outline for every id in `findOverlaps`; **Height levels** toggle tints every item with `levelForHeight(effectiveElevation)` color and shows a legend of the 5 levels.
  - **Interaction:** tap to select, drag on the floor plane → `moveItem` with `snapPoint` (drag offset as today); multi-touch cancels drag and orbits/pinches; tapping empty space deselects. Error from `moveItem` (e.g. "Too big for Room") → `toast`.
  - **Selection panel:** name + `w × d × h` (`formatCm`), Turn 90°, Turn 15°, Remove, Done; **level picker** (5 colored buttons, current one pressed); **Allow overlap** button shown only when the piece is in `findOverlaps`; removed pieces listed as `+ name` chips (as today).
  - **Grid/snap toggles** in a small settings menu.
  - Save picture as today (canvas `toBlob`, overlay fallback).

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify in browser** (`#/dev`, desktop and DevTools phone 375×812):
  - drag the coffee table into a wall → stops flush, distance readout shows `0 cm`;
  - drag the lamp through the Room→Living room doorway → crosses; at x 250 → blocked;
  - drag one sofa onto the other → both red; Allow overlap → red clears; drag onto the bean bag → red again;
  - Height levels on → TV tinted counter/eye color, floor items floor color; pick level 3 on lamp → 3D shows it 75 cm up;
  - drag the TV stand → TV moves with it; 2D/3D toggle and scope buttons frame correctly; no horizontal page scroll on phone.
- [ ] **Step 3:** `npm test && npm run build`. Commit `feat(ui): 2D/3D views, overlays and dragging`.

---

### Task 9: Thumbnail

**Files:** Create `src/ui/editor/thumbnail.ts`

**Interfaces:** Produces `makeThumbnail(place: Place): string` — PNG data URL, 320×200, 2D plan (floors, walls, item footprints filled by level color), drawn on an offscreen 2D canvas (no WebGL).

- [ ] **Step 1:** Implement. **Step 2:** In `#/dev`, log `makeThumbnail(seedApartment()).length` → under 60 000 chars; open the data URL → recognizable plan.
- [ ] **Step 3:** Commit `feat(ui): place thumbnails`.

---

### Task 10: Add forms (rooms, openings, built-ins, furniture, item editor)

**Files:**
- Create: `src/ui/editor/forms.ts`
- Modify: `src/ui/editor/panels.ts`, `src/ui/editor/editor.ts`
- Test: `tests/ui/forms.test.ts` (jsdom)

**Interfaces:**
- Consumes: `numberField`, `attachRoom`, `createRoom`, `addOpening`, `addBuiltIn`, `edit.ts`.
- Produces: `openRoomForm(place, onDone)`, `openOpeningForm(place, roomId, onDone)`, `openBuiltInForm(place, roomId, onDone)`, `openFurnitureForm(place, roomId, onDone)`, `openItemEditor(place, itemId, onDone)`; each resolves with the new `Place` or `null` on cancel.
- Behaviour:
  - Every length field has a **cm / sq** switch (sq uses the room's square size; default unit = sq when `gridOn`), and shows the other unit live (`formatBoth`).
  - **+ Room:** name, width, depth, ceiling (default 240), square size (blank = place default). First room: placed at origin. Later rooms: pick target room → pick wall (the 2D view highlights the wall under the picker) → offset. Errors from `attachRoom` shown inline; Add disabled until valid.
  - **+ Door / Window:** pick room + wall, offset from corner, width; window sill + top.
  - **+ Built-in:** name, w, d, h, position (x, z from room corner).
  - **+ Furniture:** type grid (icons + names), name (prefilled with type), w × d × h; placed in the scope room's center; selected after adding.
  - **Item editor:** rename, resize, exact height (cm), shows sits-on parent name if any.
  - **Place settings:** name, default square size, wall thickness.

- [ ] **Step 1: Failing tests (jsdom):** room form with width `"abc"` shows `"Enter a number"` and Add stays disabled; width `13½` sq + depth `10` sq → Add enabled, `onDone` gets a Place whose new room's AABB is 405 × 300; attaching with an overlapping offset shows `"Overlaps Living room"`; furniture form with h `0` shows `"Must be more than 0"`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Verify in browser:** add a 10 × 8 sq room to the Room's right wall, add a door between them, add a 200×160×50 bed in it, drag the bed through the new door.
- [ ] **Step 6:** Commit `feat(ui): forms for rooms, openings, built-ins and furniture`.

---

### Task 11: Supabase schema, auth and repository

**Files:**
- Create: `supabase/schema.sql`, `src/data/supabase.ts`, `src/data/auth.ts`, `src/data/repo.ts`, `docs/SETUP.md` (owner steps 1–3 from Task 14's list, so the owner can create the Supabase project before Task 13)
- Test: `tests/data/repo.test.ts` (fake client)

**Interfaces:**
- `schema.sql`:
```sql
create table public.places (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  doc jsonb not null,
  thumb text,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.places enable row level security;
create policy "own rows" on public.places for all
  using (owner = auth.uid()) with check (owner = auth.uid());
```
- `supabase.ts`: `export const supabase` from `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; throws a readable error if missing.
- `auth.ts`: `signInWithGitHub(): Promise<void>` (redirect back to `location.origin + '/'`), `getUser(): Promise<User | null>`, `signOut()`, `onAuthChange(cb)`.
- `repo.ts`: `interface PlaceRow { id; name; doc: Place; thumb: string | null; version: number; updated_at: string }`
  - `listPlaces(): Promise<Omit<PlaceRow,'doc'>[]>` ordered by `updated_at desc`
  - `getPlace(id): Promise<PlaceRow>`
  - `createPlace(doc: Place, thumb): Promise<PlaceRow>`
  - `savePlace(id, doc, thumb, expectedVersion): Promise<{ ok: true; row: PlaceRow } | { ok: false; conflict: PlaceRow } | { ok: false; offline: true } | { ok: false; unreachable: true }>` — `update … set version = expected+1, updated_at = now() where id = ? and version = expected`; 0 rows → fetch current row → `conflict`; `navigator.onLine === false` or fetch TypeError → `offline`; 5xx / project-paused responses while online → `unreachable`.
  - `deletePlace(id)`, `duplicatePlace(id, newName)` (new ids for place, rooms, items, openings; `sitsOn`/`allowOverlapWith` remapped).
- Repo functions take the client as a parameter internally (`makeRepo(client)`) so tests can pass a fake.

- [ ] **Step 1: Failing tests:** `savePlace` with matching version → `ok`, version+1; mismatched → `conflict` with the server row; network TypeError → `offline`; `duplicatePlace` remaps the TV's `sitsOn` to the new stand id and shares no ids with the original.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(data): Supabase schema, GitHub sign-in and places repository`.

---

### Task 12: Local cache, save queue, conflicts

**Files:**
- Create: `src/data/cache.ts`, `src/data/saveQueue.ts`
- Test: `tests/data/saveQueue.test.ts` (fake timers, fake repo)

**Interfaces:**
- `cache.ts`: `readCached(id): { doc: Place; version: number; dirty: boolean } | null`, `writeCached(id, entry)`, `listCachedDirty(): string[]`; all localStorage access in try/catch.
- `saveQueue.ts`: `createSaveQueue(repo, id, initialVersion): SaveQueue` with
  - `push(doc: Place, thumb?: string)` — writes cache (dirty) immediately, saves after 800 ms debounce
  - `status: 'saved' | 'saving' | 'offline' | 'retrying' | 'conflict' | 'unreachable'`, `onStatus(cb)`
  - retry backoff 2 s, 5 s, 15 s, 30 s (repeat 30 s); also retries on `online` event and after sign-in
  - on `conflict`: stop, emit `conflict` with server row; `resolve('mine' | 'theirs')` — mine re-saves with the server's version as expected; theirs replaces local doc with the server's and clears dirty.
  - `flush(): Promise<void>` (used when leaving the editor).
- Editor wiring (modify `editor.ts`/`main.ts`): status chip in header (`Saved` / `Saving…` / `Offline — will save` / `Not saved, retrying` / `Can't reach your database — it may be paused. Open supabase.com → your project → Restore.`); conflict → dialog "This place was changed on another device." [Keep mine] [Use the other version].

- [ ] **Step 1: Failing tests:**
  - 5 pushes within 800 ms → 1 save call with the last doc;
  - offline → status `offline`, cache dirty; then online → saved, cache clean;
  - Review Focus 2: device A saves v1→v2; queue for device B (expected v1) pushes → status `conflict`; `resolve('mine')` → saved as v3 with B's doc; `resolve('theirs')` → local doc equals A's, cache clean;
  - Review Focus 5: repo returns auth error → status `retrying`, doc stays in cache dirty; after sign-in event → saved.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(data): offline cache, save queue and conflict handling`.

---

### Task 13: Sign-in, home page, routing, first run

**Files:**
- Create: `src/ui/signin.ts`, `src/ui/home.ts`
- Modify: `src/main.ts` (remove `#/dev`)

**Interfaces:**
- Consumes: auth, repo, cache, saveQueue, `seedApartment`, `makeThumbnail`, `mountEditor`.
- Behaviour:
  - Not signed in → sign-in screen: app name, one-line purpose, **Sign in with GitHub**.
  - `#/` → home (§7.2): places newest first, each with thumbnail, name, `N rooms · M pieces · <relative time>`; menu: Rename, Duplicate, Delete (`confirmDialog("Delete <name>? This can't be undone.", "Delete")`); **+ New place** → name prompt → creates a Place with no rooms → opens editor with the + Room form open.
  - First sign-in with zero places → create `seedApartment()` automatically.
  - `#/place/<id>` → editor; opens from cache instantly if present, then refreshes from server (if server version is newer and cache isn't dirty, swap in silently; if cache is dirty, normal save path handles conflict).
  - Leaving the editor flushes the queue and saves a fresh thumbnail.
  - Sign out in a small account menu on home.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify** against a real Supabase project (owner completes `docs/SETUP.md` steps 1–3 first, `.env.local` filled): sign in → Apartment appears; rename, duplicate, delete the duplicate; edit on desktop, reload phone emulation → change visible; airplane-mode test: DevTools offline, move a piece, status `Offline — will save`, go online → `Saved`; two tabs editing the same place → conflict dialog.
- [ ] **Step 3:** `npm test && npm run build`. Commit `feat(ui): sign-in, home page and routing`.

---

### Task 14: Deploy and owner setup guide

**Files:**
- Create: `.github/workflows/deploy.yml`, `public/CNAME`, `README.md`
- Modify: `docs/SETUP.md` (add steps 4–6)

**Interfaces:**
- `deploy.yml`: on push to `main`: checkout, Node 20, `npm ci`, `npm test`, `npm run build` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from repository **variables**, upload `dist` with `actions/upload-pages-artifact@v3`, deploy with `actions/deploy-pages@v4`.
- `public/CNAME`: `plan.mishpabox.com`.
- `docs/SETUP.md` (also copied to a Notion sub-page of the design page) — owner steps, numbered, each with where to click and what to paste:
  1. Supabase: create free project; SQL editor → run `supabase/schema.sql`; copy Project URL + anon key.
  2. GitHub → Settings → Developer settings → OAuth Apps → New: homepage `https://plan.mishpabox.com`, callback `https://<project>.supabase.co/auth/v1/callback`; copy Client ID + generate secret.
  3. Supabase → Authentication → Providers → GitHub: paste ID + secret; URL configuration: Site URL `https://plan.mishpabox.com`, redirect URLs add `http://localhost:5173`.
  4. GitHub repo → Settings → Secrets and variables → Actions → Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Settings → Pages → Source: GitHub Actions; custom domain `plan.mishpabox.com`; Enforce HTTPS.
  5. Porkbun → mishpabox.com → DNS: add `CNAME` host `plan` → `<github-username>.github.io`.
  6. If the app says the database can't be reached: supabase.com → project → Restore.

- [ ] **Step 1:** Create the GitHub repo `space-planner` (private) under the owner's account (`gh repo create`), push.
- [ ] **Step 2:** Owner does steps 4–5. **Verify:** Actions run green; `https://plan.mishpabox.com` loads with HTTPS on phone and computer; sign in on both; an edit on one shows on the other after reload.
- [ ] **Step 3:** Commit `chore: deploy to GitHub Pages and setup guide`; update the Notion design page status to "Built".
