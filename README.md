# Wardrobe App

A personal wardrobe tracker (Stylebook-style) for one user. Upload photos of
clothing items, track details (brand, colors, price, where/when purchased,
category), log every wear, and see stats like cost-per-wear, most/least worn,
and "haven't worn in a while."

**Status:** Live and in use. Supabase backend (tables, RLS, Storage bucket +
policies, login user) is set up. — _v2026-06-17_

## Features

- Email + password login; shows only a login screen when signed out.
- **Closet** — photo grid; tap a tile for an item detail sheet.
- **Add Item** — pick a photo from library/camera, auto-compressed to WebP
  before upload; name, category, brand, multi-select colors, price, purchase
  date/place, notes.
- **Log Wear** — one tap to log a wear (today or a chosen date), optional
  occasion; recent-wears list with remove.
- **Stats** — cost-per-wear (headline), most/least/never worn, "haven't worn in
  a while", total wardrobe value, wears by category and color.
- **Settings** — account, manual refresh/sync, sign out.
- Archive (donated/sold) keeps history without cluttering the active closet.

## Architecture

- **Single file:** the entire app is `index.html` — HTML, CSS, and JavaScript in
  one file. No build step, no framework, no bundler, no JS libraries / CDN scripts.
- **Backend: Supabase (free tier).** Data and photos sync across devices.
  - Talk to Supabase via its **REST API and Storage API using plain `fetch`** —
    do **not** add the supabase-js library.
  - **Project URL:** `https://ofwaxqrwbcixrnjkepuz.supabase.co`
  - **Publishable key** (sent as the `apikey` header; Supabase's new name for the
    anon key — safe to expose in public client code):
    `sb_publishable_MbsUbmttzon5YNsJgUsDrw_Mg5NMCGy`
  - The **secret key is never used here** and must never be committed.
- **Auth:** single user, email + password via Supabase Auth. App stores the
  session token and sends it on every request. Not logged in → login screen only.
- **Security:** the project was created with automatic Row Level Security enabled,
  so all data and photos are private to the logged-in account.

## Data model

- **items:** `id`, `user_id`, `name`, `category`, `brand`, `colors` (text[]),
  `price` (numeric), `purchase_date`, `purchase_place`, `notes`, `image_path`
  (path in Storage), `archived` (bool), `created_at`.
- **wears:** `id`, `user_id`, `item_id`, `worn_on`, `occasion`, `created_at`.
  One row per wear. Cost-per-wear = item price ÷ wear count.
- **Photos:** stored in the private `wardrobe` Storage bucket at
  `<user_id>/<uuid>.webp` — one image per item; the item row holds the path, not
  the bytes. Compressed client-side (canvas → 1200px max edge → WebP, JPEG
  fallback) before upload to stay within the free 1 GB.

### Fixed choices (decided with the user)

- **Categories:** Tops, Bottoms, Dresses, Outerwear, Shoes, Activewear.
- **Colors:** fixed 14-swatch palette, multi-select (Black, White, Grey, Navy,
  Blue, Green, Red, Pink, Purple, Brown, Beige, Yellow, Orange, Multi).
- **Headline stat:** cost-per-wear.

These live as `CATEGORIES` / `PALETTE` constants near the top of the `<script>`
in `index.html`. Edit there to change them.

## Backend setup (already done)

The Supabase backend was configured by hand in the dashboard:
1. Login user created (Authentication → Users, auto-confirmed).
2. `items` + `wears` tables with RLS policies scoped to `auth.uid() = user_id`.
3. Private `wardrobe` Storage bucket.
4. Storage policies scoped to the `<user_id>/` first path segment.

The SQL for tables/RLS/storage is in the project's commit history / chat record.
RLS makes the publishable key safe to ship: it can only ever read/write the
signed-in user's own rows and files.

## Deploy

GitHub Pages. Edit `index.html` → commit → push to `origin/main` → it deploys
(~1–2 min). Hard-refresh (`Cmd+Shift+R`) to bypass cache. The repo and Pages
already exist — do not create new ones. See the `deploy-wardrobe` skill.

- Repo: https://github.com/aluke0311/wardrobe_app
- Live: https://aluke0311.github.io/wardrobe_app/

## Conventions

- `APP_VERSION` is a date string near the top of the `<script>`, shown in the UI.
  Bump it on each meaningful change (use the current date).
- Mobile-first. Single file. No libraries, no CDN, plain `fetch`.
- See `CLAUDE.md` for architecture details and known gotchas.
