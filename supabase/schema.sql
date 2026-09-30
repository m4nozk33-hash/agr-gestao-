-- Estrutura do Supabase para o AGR Gestão.
-- Execute no SQL Editor de um projeto Supabase exclusivo da AGR.
begin;

create table if not exists public.agr_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'user')),
  colab_id bigint,
  owner_id uuid references auth.users(id) on delete cascade,
  check (role = 'admin' or colab_id is not null)
);

alter table public.agr_profiles
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create table if not exists public.agr_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  data jsonb not null default '{"colabs":[],"clients":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Mantida apenas para migração de instalações antigas.
create table if not exists public.agr_state (
  id integer primary key check (id = 1),
  version bigint not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.agr_profiles enable row level security;
alter table public.agr_workspaces enable row level security;
alter table public.agr_state enable row level security;

revoke all on public.agr_profiles, public.agr_workspaces, public.agr_state from anon, authenticated;
grant all on public.agr_profiles, public.agr_workspaces, public.agr_state to service_role;

-- Os dois administradores solicitados. As senhas NÃO ficam no GitHub.
-- Estes registros só serão criados se os usuários já existirem em Authentication > Users.
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

-- Garante owner_id próprio para qualquer administrador já existente.
update public.agr_profiles
set owner_id = id
where role = 'admin' and owner_id is null;

commit;

-- IMPORTANTE:
-- 1. Crie os dois usuários em Authentication > Users com as senhas escolhidas.
-- 2. Rode este SQL novamente para vinculá-los como administradores.
-- 3. Cada ADM terá seu próprio workspace; colaboradores criados por ele ficam
--    vinculados ao owner_id daquele ADM e só acessam os clientes da sua carteira.
