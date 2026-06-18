# Wardrobe App

A personal wardrobe tracker (Stylebook-style) for one user. Upload photos of
clothing items, track details (brand, colors, price, where/when purchased,
category), log every wear, and see stats like cost-per-wear, most/least worn,
and "haven't worn in a while."

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

- **items:** `id`, `user_id`, `name`, `category`, `brand`, `colors`, `price`,
  `purchase_date`, `purchase_place`, `notes`, `image_path` (path in Storage),
  `archived`, `created_at`.
- **wears:** `id`, `user_id`, `item_id`, `worn_on`, `occasion`, `created_at`.
  One row per wear. Cost-per-wear = item price ÷ wear count.
- **Photos:** stored in a Supabase Storage bucket, one image per item; the item
  row holds the file path, not the bytes. Compress client-side (canvas → ~1200px
  max, JPEG/WebP) before upload to stay within the free 1 GB.

## Deploy

GitHub Pages. Edit `index.html` → commit → push to `origin/main` → it deploys.
The repo and Pages already exist — do not create new ones.

- Repo: https://github.com/aluke0311/wardrobe_app
- Live: https://aluke0311.github.io/wardrobe_app/
