create table if not exists public.spine_scans (
  id text primary key,
  title text not null,
  item_type text default 'Other',
  decision text default 'scanned',
  value_bucket text default 'under $10',
  estimated_price numeric default 0,
  scan_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists spine_scans_updated_at_idx
  on public.spine_scans (updated_at desc);

alter table public.spine_scans enable row level security;

-- The hosted backend uses the Supabase service role key, so your phone never sees this key.
-- Do not add public browser policies unless you intentionally want direct browser access later.

create table if not exists public.resale_sold_memory (
  id text primary key,
  title text not null,
  title_key text,
  item_type text,
  sku text,
  sold_price numeric,
  sold_at timestamptz,
  days_to_sell integer,
  memory_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists resale_sold_memory_title_key_idx
  on public.resale_sold_memory (title_key);

create index if not exists resale_sold_memory_sold_at_idx
  on public.resale_sold_memory (sold_at desc);
