-- ============================================================
--  SUBATIR — Esquema Supabase (Postgres)
--  App independiente de compras/stock. Reemplaza al Google Sheet.
--  Pegar y ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── Extensiones ──────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ============================================================
--  1) PERFILES + ROLES (control de acceso)
-- ============================================================
-- Cada usuario que se registra queda como 'user' sin módulos.
-- El admin (vos) asigna rol y módulos. Módulos válidos:
--   'precios','proveedores','pedidos','stock','contingencia'
--   (dashboard y copiloto son solo-lectura para cualquier usuario)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'user' check (role in ('admin','user')),
  modules     text[] not null default '{}',
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Helpers de seguridad (SECURITY DEFINER evita recursión de RLS)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.activo);
$$;

create or replace function public.has_module(m text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and (p.role = 'admin' or m = any(p.modules))
  );
$$;

-- Alta automática de perfil al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
--  2) TABLAS DE DATOS
-- ============================================================

create table if not exists public.proveedores (
  id              bigint generated always as identity primary key,
  empresa         text not null,
  nombre_contacto text,
  puesto          text,
  email           text,
  celular         text,
  telefono        text,
  rut             text,
  condicion_pago  text,
  rubro           text,
  direccion       text,
  calidad         text,
  observaciones   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.precios (
  id              bigint generated always as identity primary key,
  fecha_actualizado date,
  codigo          text,
  articulo        text,
  cod_prov        text,
  proveedor       text,
  precio_usd      numeric,
  precio_pesos    numeric,
  atencion        text,
  calidad         text,
  demora          text,
  modalidad_pago  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.pedidos (
  id              bigint generated always as identity primary key,
  fecha           date,
  n_orden         text,
  proveedor       text,
  cantidad        numeric,
  descripcion     text,
  moneda          text,
  precio_un       numeric,
  s_iva           numeric,
  c_iva           numeric,
  f_recepcion     date,
  f_vto           date,
  lote            text,
  coa             text,
  conforme        text,
  observaciones   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.inventario (
  id                 bigint generated always as identity primary key,
  codigo             text,
  descripcion        text,
  unidad             text,
  presentacion       text,
  consumo_mensual    numeric,
  stock_minimo       numeric,
  inventario         numeric,   -- stock actual
  solicitar          text,
  compra_sugerencia  numeric,
  proveedor_sugerido text,
  pendiente_entrega  numeric,
  proveedor          text,
  ext_id             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.contingencia (
  id                   bigint generated always as identity primary key,
  articulo             text,
  unidad               text,
  stock_inicial        numeric,
  consumido            numeric,
  stock_disponible     numeric,
  pct_restante         numeric,
  precio_usd_kg        numeric,
  consumo_mensual_est  numeric,
  meses_cobertura      numeric,
  estado               text,
  motivo               text,
  observaciones        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['proveedores','precios','pedidos','inventario','contingencia'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s
                    for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ============================================================
--  3) SEGURIDAD (RLS)
--  Lectura: cualquier usuario autenticado (para cálculos y copiloto)
--  Escritura: admin, o usuario con el módulo asignado
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.proveedores  enable row level security;
alter table public.precios      enable row level security;
alter table public.pedidos      enable row level security;
alter table public.inventario   enable row level security;
alter table public.contingencia enable row level security;

-- profiles: cada uno ve/edita el suyo; el admin ve/edita todos
drop policy if exists p_profiles_self_select on public.profiles;
create policy p_profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists p_profiles_admin_all on public.profiles;
create policy p_profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists p_profiles_self_update on public.profiles;
create policy p_profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid() and role = 'user');

-- Datos: lectura autenticada + escritura por módulo
do $$
declare tbl text; mod text;
begin
  foreach tbl in array array['proveedores','precios','pedidos','inventario','contingencia'] loop
    mod := case tbl when 'proveedores' then 'proveedores'
                    when 'precios' then 'precios'
                    when 'pedidos' then 'pedidos'
                    when 'inventario' then 'stock'
                    when 'contingencia' then 'contingencia' end;
    execute format('drop policy if exists p_%1$s_read on public.%1$s;', tbl);
    execute format('create policy p_%1$s_read on public.%1$s for select
                    using (auth.role() = ''authenticated'');', tbl);
    execute format('drop policy if exists p_%1$s_write on public.%1$s;', tbl);
    execute format('create policy p_%1$s_write on public.%1$s for all
                    using (public.has_module(%2$L)) with check (public.has_module(%2$L));', tbl, mod);
  end loop;
end $$;

-- ============================================================
--  4) DESPUÉS DE REGISTRARTE, CONVERTITE EN ADMIN
--  (ejecutá esto UNA vez, con tu email ya registrado en la app)
-- ============================================================
-- update public.profiles
--   set role = 'admin',
--       modules = array['precios','proveedores','pedidos','stock','contingencia']
--   where email = 'alechiesa.subatir@gmail.com';
