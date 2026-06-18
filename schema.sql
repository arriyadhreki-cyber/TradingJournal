-- ============================================================
-- FX JOURNAL — DATABASE SCHEMA
-- Jalankan script ini di Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Tabel utama untuk menyimpan trade
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  trade_date timestamptz not null,
  pair text not null,
  type text not null check (type in ('buy','sell')),
  lot numeric not null default 0,
  entry_price numeric,
  exit_price numeric,
  stop_loss numeric,
  take_profit numeric,
  pnl numeric not null default 0,
  result text not null check (result in ('win','loss','be')),
  setup text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index untuk query lebih cepat per user
create index if not exists trades_user_id_idx on public.trades(user_id);
create index if not exists trades_date_idx on public.trades(trade_date);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Wajib diaktifkan supaya user hanya bisa lihat/edit data miliknya sendiri
-- ============================================================
alter table public.trades enable row level security;

-- Policy: user hanya bisa SELECT data miliknya
create policy "Users can view own trades"
  on public.trades for select
  using (auth.uid() = user_id);

-- Policy: user hanya bisa INSERT dengan user_id miliknya sendiri
create policy "Users can insert own trades"
  on public.trades for insert
  with check (auth.uid() = user_id);

-- Policy: user hanya bisa UPDATE data miliknya
create policy "Users can update own trades"
  on public.trades for update
  using (auth.uid() = user_id);

-- Policy: user hanya bisa DELETE data miliknya
create policy "Users can delete own trades"
  on public.trades for delete
  using (auth.uid() = user_id);

-- ============================================================
-- AUTO-UPDATE updated_at TIMESTAMP
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trades_updated_at
  before update on public.trades
  for each row
  execute function public.handle_updated_at();
