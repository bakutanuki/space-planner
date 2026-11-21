# Setup (things only you can do)

These steps involve passwords and keys, so you do the clicking. Nothing here is secret except the **GitHub Client secret** in step 2: paste it only into Supabase.

## 1. Create the database (Supabase)
1. Go to https://supabase.com, sign in with GitHub, press **New project**. Name it `space-planner`, pick a region near you, set any database password (save it in your password manager), press **Create**.
2. When it's ready, open **SQL Editor** (left menu) → **New query**, paste everything from [`supabase/schema.sql`](../supabase/schema.sql), press **Run**. It should say "Success. No rows returned".
3. Open **Project Settings → Data API** (or **API**) and keep the tab open: you need the **Project URL** and the **anon / publishable** key in steps 2 and 4.

## 2. Create the GitHub sign-in app
1. Go to https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. Application name `Space Planner`; Homepage URL `https://plan.mishpabox.com`; Authorization callback URL `https://<your-project-ref>.supabase.co/auth/v1/callback` (your Project URL followed by `/auth/v1/callback`).
3. Press **Register application**, copy the **Client ID**, press **Generate a new client secret** and copy it.

## 3. Turn on GitHub sign-in in Supabase
1. Supabase → **Authentication → Sign In / Providers → GitHub**: switch it on, paste the Client ID and Client secret, **Save**.
2. Supabase → **Authentication → URL Configuration**: Site URL `https://plan.mishpabox.com`. Under Redirect URLs add `https://plan.mishpabox.com/**` and `http://localhost:5173/**`. **Save**.

## 4. Give the website the database address
GitHub repo `bakutanuki/space-planner` → **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**, twice:
- `VITE_SUPABASE_URL` = the Project URL
- `VITE_SUPABASE_ANON_KEY` = the anon / publishable key

These are meant to be public (they're inside the website anyway); the database only shows each signed-in person their own places.

## 5. Publish with GitHub Pages
Repo → **Settings → Pages** → Source: **GitHub Actions**. Then **Actions** tab → **Deploy** → **Run workflow** (or push any change). When it's green, back in **Settings → Pages** set Custom domain `plan.mishpabox.com`, **Save**.

## 6. Point the domain (Porkbun)
Porkbun → **Domain Management** → `mishpabox.com` → **DNS** → add a record: Type `CNAME`, Host `plan`, Answer `bakutanuki.github.io`, TTL default. Wait a few minutes, then in GitHub **Settings → Pages** tick **Enforce HTTPS** once it's offered (can take up to an hour).

## 7. If the app says it can't reach the database
Free Supabase projects pause after about a week without use. Go to supabase.com → your project → **Restore**. Nothing is lost, and changes made meanwhile are kept on your device and saved once it's back.

## 8. Sharing and email sign-in
- Sharing: run [`supabase/002_sharing.sql`](../supabase/002_sharing.sql) once in the SQL Editor. Then use ⋯ → Share… on a place to send an invite link.
- Email sign-in links work when Supabase → **Authentication → Sign In / Providers → Email** is on (it is by default). The link must be opened in the same browser that asked for it.
