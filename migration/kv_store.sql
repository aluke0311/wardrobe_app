-- kv: tiny per-user key/value store for small app state that isn't
-- item/wear/outfit/capsule shaped (day plans, one-time-shown flags, future
-- rounds' named formulas, etc.). A handful of rows per user, JSONB values.
-- Round A uses key 'dayplan' (see ROADMAP.md "Tomorrow" section).
--
-- Run in the Supabase SQL editor. Idempotent.

create table if not exists public.kv (
  user_id uuid not null references auth.users (id) on delete cascade,
  key     text not null,
  value   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.kv enable row level security;

drop policy if exists kv_own_rows on public.kv;
create policy kv_own_rows on public.kv
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
