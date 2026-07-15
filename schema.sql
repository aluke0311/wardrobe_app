-- ===================================================================
-- Wardrobe app — Supabase schema (clean target, 2026-06-26)
-- Run in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Tables: items · wears · outfits (+ outfit_items) · capsules (+ capsule_items)
--         · exclusions
-- Formality: items.formality is smallint[] (a SET of 1–8 levels).
--   1=Function · 2=Very Casual · 3=Casual · 4=Polished Casual ·
--   5=Smart Casual · 6=Dressed Up · 7=Business Professional · 8=Formal
-- wears.formality_for is smallint (single level — demand capture).
--
-- The `wardrobe` storage bucket + its policies already exist.
-- ===================================================================

-- -------------------------------------------------------------------
-- OPTIONAL RESET — uncomment to wipe before a clean re-import.
-- -------------------------------------------------------------------
-- drop table if exists wears cascade;
-- drop table if exists outfit_items, capsule_items, outfits, capsules cascade;
-- drop table if exists exclusions cascade;
-- drop table if exists items cascade;

-- -------------------------------------------------------------------
-- ITEMS — every garment (Available, in Storage, or Archived)
-- -------------------------------------------------------------------
create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  name          text not null,
  category      text,           -- Tops, Bottoms, Dresses, Outerwear, Shoes, Workout
  subcategory   text,           -- e.g. "Jeans", "Cocktail dresses"
  brand         text,
  retailer      text,
  color_family  text,           -- single colour family
  price         numeric,
  purchase_date date,
  date_is_guess boolean not null default false,
  acquisition   text,           -- New | Secondhand | Gift
  size          text,
  fabric        text[] not null default '{}',
  season        text[] not null default '{}',
  formality     smallint[],                 -- set of 1–8 levels (see scale above)
  status        text not null default 'Available'
                  check (status in ('Available','Storage','Archive')),
  tags          text[] not null default '{}',
  url           text,
  order_no      text,
  receipt_url   text,
  official_name text,
  notes         text,
  image_path    text,           -- <user_id>/<uuid>.webp in the wardrobe bucket
  last_washed   date,           -- null = laundry not tracked yet (reads clean)
  laundry_state text,           -- one-time override: 'hamper' | 'extra:<n>' (see migration/items_laundry.sql)
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------
-- OUTFITS — a saved set of items worn together
-- -------------------------------------------------------------------
create table if not exists outfits (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid(),
  name               text,
  context            text,
  notes              text,
  image_path         text,
  formality_override text,      -- one of the FORMALITY_BUCKETS keys (nullable)
  layout             jsonb not null default '[]',  -- Build-a-look canvas arrangement
  rating             smallint check (rating between 1 and 5),  -- reserved
  created_at         timestamptz not null default now()
);

create table if not exists outfit_items (
  outfit_id uuid not null references outfits(id) on delete cascade,
  item_id   uuid not null references items(id)   on delete cascade,
  user_id   uuid not null default auth.uid(),
  primary key (outfit_id, item_id)
);

-- -------------------------------------------------------------------
-- CAPSULES — named sets (seasonal capsule, trip packing list)
-- -------------------------------------------------------------------
create table if not exists capsules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  name       text not null,
  kind       text not null default 'capsule'
               check (kind in ('capsule','packing','travel')),
  start_date date,
  end_date   date,
  notes      text,
  locations  jsonb not null default '[]',  -- [{name,lat,lon,from,to}] for trip weather
  created_at timestamptz not null default now()
);

create table if not exists capsule_items (
  capsule_id uuid not null references capsules(id) on delete cascade,
  item_id    uuid not null references items(id)    on delete cascade,
  user_id    uuid not null default auth.uid(),
  packed     boolean not null default false,
  primary key (capsule_id, item_id)
);

-- -------------------------------------------------------------------
-- WEARS — one row per item per day worn
-- -------------------------------------------------------------------
create table if not exists wears (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  item_id       uuid not null references items(id)   on delete cascade,
  outfit_id     uuid references outfits(id)          on delete set null,
  worn_on       date not null,
  context       text[],         -- named contexts for this wearing (multi-select)
  formality_for smallint check (formality_for between 1 and 8),  -- demand capture (single level)
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------
-- EXCLUSIONS — explicit "these two don't go together" pairs
-- -------------------------------------------------------------------
create table if not exists exclusions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  item_a     uuid not null references items(id) on delete cascade,
  item_b     uuid not null references items(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  constraint exclusions_ordered check (item_a < item_b),
  constraint exclusions_unique  unique (user_id, item_a, item_b)
);

-- -------------------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------------------
create index if not exists items_user_idx        on items(user_id);
create index if not exists items_status_idx       on items(user_id, status);
create index if not exists wears_item_idx         on wears(item_id);
create index if not exists wears_worn_on_idx      on wears(user_id, worn_on);
create index if not exists outfit_items_item_idx  on outfit_items(item_id);
create index if not exists capsule_items_item_idx on capsule_items(item_id);
create index if not exists exclusions_user_idx    on exclusions(user_id);
create index if not exists exclusions_item_a_idx  on exclusions(item_a);
create index if not exists exclusions_item_b_idx  on exclusions(item_b);

-- -------------------------------------------------------------------
-- ROW-LEVEL SECURITY — every table scoped to the signed-in user.
-- -------------------------------------------------------------------
alter table items         enable row level security;
alter table outfits       enable row level security;
alter table outfit_items  enable row level security;
alter table capsules      enable row level security;
alter table capsule_items enable row level security;
alter table wears         enable row level security;
alter table exclusions    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['items','outfits','outfit_items','capsules','capsule_items','wears','exclusions']
  loop
    execute format('drop policy if exists own_rows on %I', t);
    execute format(
      'create policy own_rows on %I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
