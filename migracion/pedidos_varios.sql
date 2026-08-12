-- ============================================================
--  PEDIDOS VARIOS · compras especiales o fuera de lo habitual
--
--  El circuito normal (Pedidos → Recepción) trabaja sobre el
--  maestro de artículos y proveedores. Hay compras que no entran
--  ahí: un repuesto puntual, un servicio, algo que se compra una
--  vez. Este módulo las registra a mano y les da trazabilidad,
--  SIN mezclarlas con las OC habituales: tabla propia, se ven
--  sólo acá.
--
--  El precio y el total pueden quedar vacíos a propósito: muchas
--  veces se pide primero y el importe se sabe después.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

create table if not exists public.pedidos_varios (
  id            bigint generated always as identity primary key,
  fecha         date not null default current_date,
  proveedor     text not null,
  articulo      text not null,
  cantidad      numeric,                       -- opcional
  precio        numeric,                       -- unitario, opcional
  total         numeric,                       -- opcional, no se deduce solo
  moneda        text not null default '$',
  nota          text,
  estado        text not null default 'PENDIENTE',
  -- Recepción: cierra el pedido, igual que en Recepción de Mercadería
  f_recepcion   date,
  recibido_por  text,
  obs_recepcion text,
  creado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.pedidos_varios drop constraint if exists pedidos_varios_estado_check;
alter table public.pedidos_varios add constraint pedidos_varios_estado_check
  check (estado in ('PENDIENTE','RECIBIDO','ANULADO'));

alter table public.pedidos_varios drop constraint if exists pedidos_varios_moneda_check;
alter table public.pedidos_varios add constraint pedidos_varios_moneda_check
  check (moneda in ('$','U$S'));

create index if not exists idx_pvarios_estado on public.pedidos_varios(estado);
create index if not exists idx_pvarios_fecha  on public.pedidos_varios(fecha desc);
create index if not exists idx_pvarios_prov   on public.pedidos_varios(proveedor);

comment on table  public.pedidos_varios        is 'Compras especiales, fuera del circuito de OC habitual';
comment on column public.pedidos_varios.precio is 'Unitario. Puede quedar vacío: a veces se sabe después';
comment on column public.pedidos_varios.total  is 'Puede quedar vacío. No se calcula solo: se carga lo que dice la factura';

-- updated_at al día
create or replace function public.pvarios_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_pvarios_touch on public.pedidos_varios;
create trigger trg_pvarios_touch before update on public.pedidos_varios
  for each row execute function public.pvarios_touch();

-- ── Permisos ─────────────────────────────────────────────────
--  Leer: cualquier autenticado que tenga el módulo. Escribir: igual.
--  El admin pasa por has_module() como en el resto del sistema.
alter table public.pedidos_varios enable row level security;

drop policy if exists p_pvarios_read on public.pedidos_varios;
create policy p_pvarios_read on public.pedidos_varios
  for select using (public.has_module('varios'));

drop policy if exists p_pvarios_write on public.pedidos_varios;
create policy p_pvarios_write on public.pedidos_varios
  for all
  using (public.has_module('varios'))
  with check (public.has_module('varios'));

grant select, insert, update, delete on public.pedidos_varios to authenticated;
grant usage, select on sequence public.pedidos_varios_id_seq to authenticated;

-- ── Habilitar el módulo ──────────────────────────────────────
--  A los administradores les alcanza con el rol. Acá se lo damos
--  a quien ya maneja Pedidos, que es quien va a cargar estos.
update public.profiles
   set modules = array_append(modules, 'varios')
 where activo
   and 'pedidos' = any(modules)
   and not ('varios' = any(modules));

-- ── Comprobar ────────────────────────────────────────────────
select email, full_name, modules
  from public.profiles
 where 'varios' = any(modules) or role = 'admin'
 order by email;
