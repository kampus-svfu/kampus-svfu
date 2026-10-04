-- Кампус СВФУ — схема базы для Supabase.
-- Запуск: Supabase → SQL Editor → New query → вставить весь файл → Run.

create extension if not exists pgcrypto;

create table if not exists public.listings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  author      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('room', 'books', 'job')),
  title       text not null check (char_length(title) between 5 and 90),
  body        text check (char_length(body) <= 1200),
  contact     text not null check (char_length(contact) between 3 and 80),
  price       integer check (price between 0 and 10000000),
  details     jsonb not null default '{}'::jsonb check (pg_column_size(details) < 4000)
);

create index if not exists listings_kind_created_idx on public.listings (kind, created_at desc);
create index if not exists listings_author_idx on public.listings (author);

-- Открыть таблицу для сайта (нужно, если в проекте выключено "Automatically expose new tables").
-- Гости только читают, вошедшие ещё и публикуют. Что именно можно — решают правила ниже.
grant usage on schema public to anon, authenticated;
grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;

-- Доступ: читать могут все, публиковать — только вошедшие, менять и удалять — только своё.
alter table public.listings enable row level security;

drop policy if exists "listings_read_all"    on public.listings;
drop policy if exists "listings_insert_own"  on public.listings;
drop policy if exists "listings_update_own"  on public.listings;
drop policy if exists "listings_delete_own"  on public.listings;

create policy "listings_read_all" on public.listings
  for select using (true);

create policy "listings_insert_own" on public.listings
  for insert to authenticated
  with check (
    author = auth.uid()
    -- Чтобы пускать только студенческую почту СВФУ, раскомментируйте строку ниже
    -- и впишите ["stud.s-vfu.ru"] в ALLOWED_EMAIL_DOMAINS в config.js:
    -- and lower(auth.jwt() ->> 'email') like '%@stud.s-vfu.ru'
  );

create policy "listings_update_own" on public.listings
  for update to authenticated
  using (author = auth.uid()) with check (author = auth.uid());

create policy "listings_delete_own" on public.listings
  for delete to authenticated
  using (author = auth.uid());

-- Защита от спама: не больше 10 объявлений в сутки с одного аккаунта.
create or replace function public.listings_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.listings
      where author = new.author and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Слишком много объявлений за сутки';
  end if;
  return new;
end $$;

drop trigger if exists listings_rate_limit on public.listings;
create trigger listings_rate_limit
  before insert on public.listings
  for each row execute function public.listings_rate_limit();

-- Необязательно: удалять объявления старше 60 дней раз в сутки.
-- Требует расширения pg_cron (Database → Extensions → pg_cron).
-- select cron.schedule('kampus-cleanup', '0 4 * * *',
--   $$delete from public.listings where created_at < now() - interval '60 days'$$);
