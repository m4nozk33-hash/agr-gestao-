-- Execute uma vez no SQL Editor de um projeto Supabase exclusivo da AGR.
-- O acesso aos dados é feito somente pelas funções do servidor da Vercel.
begin;
create table if not exists public.agr_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'user')),
  colab_id bigint,
  check (role = 'admin' or colab_id is not null)
);
create table if not exists public.agr_state (
  id integer primary key check (id = 1),
  version bigint not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.agr_profiles enable row level security;
alter table public.agr_state enable row level security;
revoke all on public.agr_profiles, public.agr_state from anon, authenticated;
grant all on public.agr_profiles, public.agr_state to service_role;
insert into public.agr_state (id, data) values (1,
  '{"colabs":[{"id":1,"nome":"Gabi","com":60},{"id":2,"nome":"Laura","com":60},{"id":3,"nome":"Emanuel","com":60},{"id":4,"nome":"Lucas","com":60}],"clients":[]}'::jsonb
) on conflict (id) do nothing;
commit;

-- Após criar seu usuário em Authentication > Users > Add user,
-- execute o trecho abaixo, substituindo o e-mail pelo seu e-mail real:
-- insert into public.agr_profiles (id, nome, email, role)
-- select id, 'Lucas', email, 'admin' from auth.users
-- where email = 'SEU_EMAIL_AQUI'
-- on conflict (id) do nothing;
