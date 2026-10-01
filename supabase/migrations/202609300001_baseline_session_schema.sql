-- Freely session persistence baseline.
-- The live development database predates this migration.
-- This file is the reproducible schema for fresh environments.

create extension if not exists pgcrypto;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  circuit_id text not null,
  created_at timestamptz not null default now()
);

create table public.session_items (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.sessions(id)
    on delete cascade,

  turn_id uuid not null,

  item_index integer not null
    check (item_index >= 0),

  category text not null
    check (category in ('observation', 'evidence', 'hypothesis')),

  kind text,

  content text not null,

  source_text text not null,

  subject text,

  value jsonb,

  unit text,

  test text,

  result text,

  provenance jsonb not null,

  supersedes_id uuid
    references public.session_items(id),

  created_at timestamptz not null default now(),

  constraint session_items_category_kind_check
    check (
      (category = 'observation' and kind is null)
      or
      (category = 'hypothesis' and kind is null)
      or
      (category = 'evidence' and kind in ('measurement', 'test_result'))
    ),

  constraint session_items_turn_slot_unique
    unique (session_id, turn_id, item_index)
);

create unique index session_items_one_direct_correction
  on public.session_items (supersedes_id)
  where supersedes_id is not null;
