# How Space Planner works

This guide explains Space Planner in plain language, so you can understand it and fix common problems yourself. You don't need to know how to code. File names are given in `this style` so you can find them in the repo when you want to look.

**The short version:** Space Planner is a website made of plain files. GitHub builds those files from the code and publishes them. Your web address, plan.mishpabox.com, points at them. When you're signed in, your places are saved to a free online database called Supabase. A copy is also kept on each device, so you don't lose work when the internet or the database is down.

---

## 1. The big picture

There are four pieces, and each one has a single job:

| Piece | What it does | Where you manage it |
|---|---|---|
| **The code** | Everything the app does, written in TypeScript (JavaScript with extra checks) | GitHub repo `bakutanuki/space-planner` |
| **GitHub Actions + GitHub Pages** | Turns the code into a website and hosts it for free | Repo → **Actions** tab and **Settings → Pages** |
| **Porkbun** | Owns `mishpabox.com` and sends `plan.mishpabox.com` to GitHub | Porkbun → Domain Management → DNS |
| **Supabase** | The database that stores your places, plus the "Sign in with GitHub" button | supabase.com → your `space-planner` project |

The website runs entirely in your browser. There's no server of our own to keep running. The only things that need to stay alive are GitHub Pages, which basically never goes down, and Supabase, which falls asleep if nobody uses it for a week (see section 5).

---

## 2. How the 3D room becomes the 2D plan

The key idea is that **there is only one model**. The app never draws a separate flat drawing. It builds a single 3D scene and then looks at it with one of two "cameras".

### Everything is stored as numbers in centimetres
A place is a list of rooms and furniture, written down as plain numbers (`src/model/types.ts`):
- A **room** is its four corners, its ceiling height, its doors and windows (which wall they're on, how far along it, how wide, and how high), and its built-ins, like the closet.
- A **piece of furniture** has a width, depth and height, a position (`x` running left to right and `z` running top to bottom on the plan), a turn angle, and how high its bottom sits off the floor.

All sizes stay in exact centimetres. The app only rounds when it shows you a label, never the stored number, so a 2 cm misfit can't be hidden (`src/model/units.ts`). When you type a size in "squares", it's converted to centimetres right away, using the square size of that room (30 cm unless you change it).

### Turning numbers into a 3D scene
The drawing is done by **three.js**, a well-known free library for 3D in the browser (`src/ui/editor/scene.ts`):
- **Floors** are flat tiles with a texture. The grid lines are painted on, starting at the room's corner.
- **Walls** come from `buildWalls` in `src/model/rooms.ts`, which works out every wall piece and cuts holes where the doors and windows are. A wall shared by two rooms is only drawn once.
- **Furniture** models are built from simple boxes and cylinders in `src/ui/editor/furniture3d.ts`, scaled to the exact size you typed.
- **Stacking.** When something sits on something else, like the TV on the TV stand, its height is worked out automatically: the height of what it sits on, plus that thing's own height (`src/model/stacking.ts`).

### Two cameras, one scene
- **2D plan** uses an *orthographic* camera. It looks straight down from above, with no perspective, so a 1 m sofa is always drawn the same length wherever it is. That's what makes the plan true to scale. In this view the wall above doors and windows is left out, so openings show up as gaps.
- **3D view** uses a normal *perspective* camera you can spin around. Any wall standing between you and the room fades almost to see-through, so it doesn't block your view.

The **3D / 2D** button in the editor only switches cameras. Nothing about your place changes.

### Extras drawn on top
- **Height levels** colours each piece by where its bottom sits: Floor 0 cm, Seat 45 cm, Table 75 cm, Counter 90 cm, Eye level 150 cm (`src/model/levels.ts`).
- **Red outlines** show pieces that bump into each other: same room, overlapping on the floor, *and* overlapping in height (`src/model/overlap.ts`). Rugs never count, and neither do things stacked on each other.
- **Dragging** keeps a piece inside its room, out of built-ins, and lets it change rooms only through a door (`src/model/placement.ts`). It also shows the distance to each wall while you drag.
- The **little pictures on the home page** are drawn separately, as a flat image, by `src/ui/editor/thumbnail.ts`.

---

## 3. How the website is built and hosted

### From code to website
Browsers can't run TypeScript directly, so the code is "built" into plain HTML, CSS and JavaScript files. A tool called **Vite** does this (`npm run build`), and the result goes into a folder called `dist/`.

### Automatic publishing
You never upload anything by hand. The file `.github/workflows/deploy.yml` tells GitHub that **every time something is pushed to `main`**, it should:
1. Install the tools.
2. **Run the tests** (`npm test`). If any test fails, it stops here and the live site stays exactly as it was. That's a safety net, not a breakage.
3. Build the site, putting in the two Supabase settings (the repo variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).
4. Publish `dist/` to **GitHub Pages**.

You can watch this happen in the repo's **Actions** tab. A green tick means it's live (give it a minute to show up). A red cross means something stopped it, and you can click in to see which step.

You can also re-publish without changing anything: **Actions → Deploy → Run workflow**.

### How the address finds the site
- The file `public/CNAME` contains `plan.mishpabox.com`. That tells GitHub Pages which address it answers to.
- At Porkbun, a **CNAME record** (Host `plan`, Answer `bakutanuki.github.io`) sends anyone visiting plan.mishpabox.com to GitHub.
- GitHub provides the padlock (HTTPS) for free once **Enforce HTTPS** is ticked in **Settings → Pages**.

### Are those keys secret?
No. The Supabase "anon / publishable" key is *meant* to be in the website, since every visitor's browser needs it. What actually protects your data is a database rule (next section) that only lets each signed-in person see their own places. The one real secret is the **GitHub Client secret**, and that lives only inside Supabase.

---

## 4. How saving and sync work

### Signing in
The **Sign in with GitHub** button sends you to GitHub, which confirms who you are and sends you back (`src/data/auth.ts`). Supabase remembers the sign-in on that device, so you stay signed in.

### Where your places live
In Supabase there's one table called `places`, with **one row per place** (`supabase/schema.sql`). Each row holds the place's name, the whole layout, a small picture, and a **version number**. A rule called *row level security* means each person can only read or change rows they own.

### Saving automatically
You never press Save. Here's what happens after you change something (`src/data/saveQueue.ts`):
1. **Straight away**, the change is written to your device (the browser's local storage) and marked "not yet saved online".
2. After you stop for **less than a second**, it's sent to Supabase.
3. When Supabase confirms, the device copy is marked "saved", and the editor shows **Saved**.

If sending fails, the app tries again after 2 s, then 5 s, then 15 s, then every 30 s. It also tries again the moment your internet comes back. Your work stays on the device the whole time. If you try to close the tab while something isn't saved, the browser asks first.

When you leave a place, the app saves one last time, together with a fresh picture for the home page.

### Changes made on another device
Every save says "I'm changing version 7 into version 8". If the database is already on version 8 because your other device saved first, the save is refused instead of overwriting it, and you'll see **"This place was changed on another device"**. You choose:
- **Keep mine (this device)** replaces the other version with what's on this screen.
- **Use the other version** replaces this screen with what the other device saved.

This way, one device can never silently wipe out work from another. If a place was deleted on another device while you were still editing it here, the app saves it again rather than losing your changes.

### The status label in the editor
| Label | What it means | What to do |
|---|---|---|
| **Saved** | Everything is in the database | Nothing |
| **Saving…** | Sending now | Nothing |
| **Offline, will save** | No internet. Changes are on this device | Nothing. It saves when you're back online. Tap it to retry now |
| **Not saved, retrying** | Something went wrong. It keeps trying | Tap it to retry now. If it won't clear, see the table below |
| **Can't reach database** | Supabase is probably asleep | Restore it (see below). Your changes are safe on this device |
| **Signed out, not saved** | Your sign-in ran out | Tap it to sign in again. It then saves |
| **Changed elsewhere** | Another device saved first | Pick which version to keep |

### Without a database
If the site is built without the two Supabase settings, for example on your own computer with no `.env.local` file, it still works but saves **only inside that browser**, with no sign-in. That's handy for trying things out. Don't rely on it for real plans.

### The first time you sign in
If you have no places yet, the app creates your current apartment for you, converted from the original "Apartment Layout Planner" file (`src/model/seed.ts`).

---

## 5. When something breaks

Start with the row that matches what you see. Most problems are in the first three rows.

| What you see | Most likely cause | How to fix it |
|---|---|---|
| "Can't reach your database", or **Can't reach database** in the editor | The free Supabase project went to sleep after about a week without use | supabase.com → your project → **Restore**. Wait a minute or two, then reload the app. Nothing is lost, and changes kept on your device save once it's back |
| Sign-in goes to GitHub, then comes back to the sign-in screen or shows an error | Supabase's allowed addresses or the GitHub app settings don't match | Supabase → **Authentication → URL Configuration**: Site URL `https://plan.mishpabox.com`, Redirect URLs include `https://plan.mishpabox.com/**`. GitHub → Settings → Developer settings → OAuth Apps → Space Planner: callback URL is your Supabase Project URL + `/auth/v1/callback` |
| "Your sign-in expired", or **Signed out, not saved** | Sign-in ran out on this device | Tap the label, or reload the page and sign in. Unsaved changes are kept and then saved |
| A change you pushed doesn't show up on the site | The publish stopped, or your browser is showing an old copy | Repo → **Actions**. A red cross means open it and see which step failed (a failed **npm test** means a change broke a layout rule, and the old site stays live). A green tick means wait a minute, then hard-reload (Ctrl+Shift+R, or Cmd+Shift+R on Mac) |
| The site works, but no sign-in button appears and places don't follow you between devices | The site was built without the Supabase settings | Repo → **Settings → Secrets and variables → Actions → Variables**: check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are there and correct, then **Actions → Deploy → Run workflow** |
| plan.mishpabox.com doesn't load at all, or "Site not found" | DNS record or Pages custom domain is missing | Porkbun → mishpabox.com → DNS: a CNAME with Host `plan` and Answer `bakutanuki.github.io`. GitHub → **Settings → Pages**: Custom domain `plan.mishpabox.com`. Changes can take up to an hour |
| Browser warns "not secure" | HTTPS not switched on yet | GitHub → **Settings → Pages** → tick **Enforce HTTPS** (it can take up to an hour to be offered after the DNS change) |
| "This place was changed on another device" keeps coming back | You closed the box without choosing | Pick one of the two buttons. The box keeps coming back until you do, so nothing gets overwritten by accident |
| The home page shows places, but with a note that you're offline | No internet, or the database is unreachable | Check your connection. If you're online, treat it like the first row |
| "This place no longer exists" | It was deleted, maybe on another device | Go back to your places. Deleting can't be undone, so use **Duplicate** first next time you're unsure |
| The 3D view is blank or black, but the buttons work | The browser or device has 3D graphics (WebGL) switched off, or it ran out of memory | Reload the page. Try another browser. On a computer, check hardware acceleration is on in the browser settings |
| A piece won't go where you drag it | That's a rule: pieces stay in their room, stay out of built-ins, and only move between rooms through a door | Drag it through a doorway into the other room |
| A piece is outlined in red | It overlaps another piece at the same height | Move it, or select it and press **Allow overlap** if it's meant to be that way |
| Sizes look slightly off | Labels in squares are rounded for display, and **≈** means "not a whole or half square" | Switch the label to cm or m to see the exact number. Stored sizes are never rounded |

### If you need to undo a code change
Every change to the code is kept in GitHub's history. To roll the website back: repo → **Commits**, find the last commit that worked, and ask Claude to "revert the site to commit `<the commit's short code>`". When that's pushed, the site re-publishes automatically. Your saved places are in Supabase, not in the code, so rolling back the code never touches them.

### Before asking for help, note down
- What you were doing and the exact message on screen.
- The status label in the editor.
- Whether the latest run in the **Actions** tab is green or red.

---

## 6. Where things are in the code

| Folder or file | What's in it |
|---|---|
| `src/model/` | The layout rules: sizes and units, rooms and walls, dragging and snapping, stacking, overlaps, edits. No drawing or saving, so it's easy to test |
| `src/data/` | Sign-in, talking to Supabase, the copy on the device, and the save queue |
| `src/ui/` | The screens. `home.ts` is the places list. `editor/` has the 3D scene, furniture models, the editor and its forms |
| `src/main.ts` | Starts the app and decides which screen to show |
| `tests/` | Automatic checks for the layout and saving rules. They run before every publish |
| `supabase/schema.sql` | The database table and its "only your own places" rule |
| `.github/workflows/deploy.yml` | The automatic test, build and publish steps |
| `public/CNAME` | The web address GitHub Pages answers to |
| `docs/SETUP.md` | The one-time account setup steps |
