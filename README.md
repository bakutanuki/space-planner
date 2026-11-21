# Space Planner

Plan furniture layouts for your own spaces at true size, on phone and computer. Live at https://plan.mishpabox.com.

- Places list: open, add, rename, duplicate, delete.
- Editor: flat 2D plan and 3D view, rooms by typed size (cm or floor squares in half steps), doors, windows, built-ins, furniture at exact sizes, stacking, 5 height levels, overlap warnings, distances to walls while dragging.
- Saves automatically to Supabase (sign in with GitHub), keeps a copy on the device for offline use, and asks which version to keep if a place was changed on another device.

## Run it on a computer
```
npm install
npm run dev     # http://localhost:5173 (without .env.local it saves in the browser only)
npm test        # layout and saving rules
npm run build   # makes dist/
```
Copy `.env.example` to `.env.local` and fill in the Supabase values to use the real database locally.

## Setup and hosting
See [docs/SETUP.md](docs/SETUP.md). Every push to `main` is tested, built and published by `.github/workflows/deploy.yml`.

## Where things are
- `src/model/` layout rules (units, rooms and walls, placement, stacking, overlap, edits), all in centimetres and tested in `tests/`.
- `src/data/` Supabase sign-in, database, device cache, save queue.
- `src/ui/` screens; `src/ui/editor/` the 3D scene, furniture models, editor and forms.
- `docs/plan.md` the build plan.
