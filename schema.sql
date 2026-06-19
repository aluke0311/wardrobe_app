-- ===================================================================
-- Wardrobe app — Supabase schema
-- Run in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- This is a CLEAN schema for the migrated, multi-table app:
--   items · wears · outfits (+ outfit_items) · capsules (+ capsule_items)
-- Contexts and the 1–7 formality ladder live in index.html as constants,
-- not as tables — only their *names/numbers* are stored on rows.
--
-- The `wardrobe` storage bucket + its policies already exist from the
-- prototype and are reused as-is (private; photos served via signed URLs).
-- ===================================================================

-- -------------------------------------------------------------------
-- OPTIONAL RESET — the prototype created `items` and `wears` with the
-- old columns. The real data lives in Airtable, so a clean slate is
-- safe. Uncomment these four lines ONCE to drop the old tables before
-- creating the new ones. Skip if you're starting from an empty project.
-- -------------------------------------------------------------------
-- drop table if exists wears cascade;
-- drop table if exists outfit_items, capsule_items, outfits, capsules cascade;
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
  brand         text,           -- the maker
  retailer      text,           -- where it was bought
  color_family  text,           -- single colour family
  price         numeric,
  purchase_date date,
  date_is_guess boolean not null default false,
  acquisition   text,           -- New | Secondhand | Gift
  size          text,
  fabric        text[] not null default '{}',
  season        text[] not null default '{}',
  min_occasion  smallint check (min_occasion between 1 and 7),
  max_occasion  smallint check (max_occasion between 1 and 7),
  status        text not null default 'Available'
                  check (status in ('Available','Storage','Archive')),
  -- upkeep (slice 6): where the item is right now + how to care for it
  availability    text not null default 'Ready'
                    check (availability in ('Ready','Laundry','Cleaners','Lent')),
  care            text[] not null default '{}',   -- wash/care methods
  needs_repair    boolean not null default false,
  needs_tailoring boolean not null default false,
  -- fit & storage (slice 8): optional physical descriptors
  storage_location text,          -- where it lives in the home
  fit             text,           -- Tight | Fitted | Relaxed | Oversized
  length          text,           -- Cropped | Regular | Long
  rise            text,           -- Low | Mid | High (bottoms)
  price_original  numeric,        -- retail/MSRP for discount tracking
  tags          text[] not null default '{}',
  url           text,           -- product link
  order_no      text,
  receipt_url   text,
  official_name text,           -- manufacturer's product name (optional)
  notes         text,
  image_path    text,           -- <user_id>/<uuid>.webp in the wardrobe bucket
  created_at    timestamptz not null default now(),
  constraint occasion_range check (max_occasion >= min_occasion)
);

-- Migration for the EXISTING DB (slice 6 — upkeep fields). Idempotent; run once
-- in the Supabase SQL editor. Safe on a fresh DB too (columns already present).
alter table items
  add column if not exists availability    text not null default 'Ready',
  add column if not exists care            text[] not null default '{}',
  add column if not exists needs_repair    boolean not null default false,
  add column if not exists needs_tailoring boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'items_availability_check') then
    alter table items add constraint items_availability_check
      check (availability in ('Ready','Laundry','Cleaners','Lent'));
  end if;
end $$;

-- Migration for the EXISTING DB (slice 8 — fit & storage fields). Idempotent.
alter table items
  add column if not exists storage_location text,
  add column if not exists fit              text,
  add column if not exists length           text,
  add column if not exists rise             text,
  add column if not exists price_original   numeric;

-- -------------------------------------------------------------------
-- OUTFITS — a saved set of items worn together
-- -------------------------------------------------------------------
create table if not exists outfits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  name       text,
  context    text,              -- one of the configured contexts
  notes      text,
  image_path text,              -- optional photo of the whole outfit
  created_at timestamptz not null default now()
);

create table if not exists outfit_items (
  outfit_id uuid not null references outfits(id) on delete cascade,
  item_id   uuid not null references items(id)   on delete cascade,
  user_id   uuid not null default auth.uid(),
  primary key (outfit_id, item_id)
);

-- -------------------------------------------------------------------
-- CAPSULES — named sets you build (seasonal capsule, "Spain trip",
-- travel/packing). Trips can carry a date range.
-- -------------------------------------------------------------------
create table if not exists capsules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  name       text not null,
  kind       text not null default 'capsule'   -- capsule | packing | travel
                check (kind in ('capsule','packing','travel')),
  start_date date,
  end_date   date,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists capsule_items (
  capsule_id uuid not null references capsules(id) on delete cascade,
  item_id    uuid not null references items(id)    on delete cascade,
  user_id    uuid not null default auth.uid(),
  primary key (capsule_id, item_id)
);

-- -------------------------------------------------------------------
-- WEARS — one row per item per day it was worn. `context` is the
-- occasion; `outfit_id` is set when the wear came from logging an
-- outfit. worn_on accepts any date, so historical wears back-fill fine.
-- -------------------------------------------------------------------
create table if not exists wears (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  item_id    uuid not null references items(id)   on delete cascade,
  outfit_id  uuid references outfits(id)          on delete set null,
  worn_on    date not null,
  context    text,
  -- ratings (slice 7): how the wear felt. rating 3=loved 2=fine 1=didn't work.
  rating      smallint check (rating between 1 and 3),
  compliments boolean not null default false,
  note        text,
  created_at timestamptz not null default now()
);

-- Migration for the EXISTING DB (slice 7 — wear ratings). Idempotent; run once
-- in the Supabase SQL editor. Safe on a fresh DB too.
alter table wears
  add column if not exists rating      smallint,
  add column if not exists compliments boolean not null default false,
  add column if not exists note        text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wears_rating_check') then
    alter table wears add constraint wears_rating_check check (rating between 1 and 3);
  end if;
end $$;

-- -------------------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------------------
create index if not exists items_user_idx        on items(user_id);
create index if not exists items_status_idx       on items(user_id, status);
create index if not exists wears_item_idx         on wears(item_id);
create index if not exists wears_worn_on_idx      on wears(user_id, worn_on);
create index if not exists outfit_items_item_idx  on outfit_items(item_id);
create index if not exists capsule_items_item_idx on capsule_items(item_id);

-- -------------------------------------------------------------------
-- ROW-LEVEL SECURITY — every table scoped to the signed-in user.
-- One permissive policy per table covering select/insert/update/delete.
-- -------------------------------------------------------------------
alter table items         enable row level security;
alter table outfits       enable row level security;
alter table outfit_items  enable row level security;
alter table capsules      enable row level security;
alter table capsule_items enable row level security;
alter table wears         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['items','outfits','outfit_items','capsules','capsule_items','wears']
  loop
    execute format('drop policy if exists own_rows on %I', t);
    execute format(
      'create policy own_rows on %I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
