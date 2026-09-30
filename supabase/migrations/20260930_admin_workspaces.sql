-- Migração: separar dados por administrador no AGR Gestão.
-- Execute no Supabase SQL Editor ANTES de publicar o código deste branch.

begin;

alter table public.agr_profiles
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create table if not exists public.agr_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  data jsonb not null default '{"colabs":[],"clients":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.agr_workspaces enable row level security;
revoke all on public.agr_workspaces from anon, authenticated;
grant all on public.agr_workspaces to service_role;

insert into public.agr_profiles (id, nome, email, role, colab_id, owner_id)
select id,
       case
         when lower(email) = 'm4nozk33@gmail.com' then 'Administrador AGR'
         when lower(email) = 'lucasjoselage@gmail.com' then 'Lucas'
         else coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1))
       end,
       lower(email),
       'admin',
       null,
       id
from auth.users
where lower(email) in ('m4nozk33@gmail.com', 'lucasjoselage@gmail.com')
on conflict (id) do update
set role = 'admin',
    owner_id = excluded.id,
    colab_id = null,
    email = excluded.email;

update public.agr_profiles
set owner_id = id
where role = 'admin' and owner_id is null;

commit;
