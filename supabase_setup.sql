-- Run this once in your Supabase project → SQL Editor

create table if not exists properties (
  id          bigint primary key,
  data        jsonb   not null default '{}'::jsonb,
  published   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Index for fast published-only queries
create index if not exists properties_published_idx on properties (published);

-- Allow the service-role key full access (RLS off for server-side access)
alter table properties disable row level security;
