-- ============================================================
--  REGISTRO DE CONTEOS · historial del Control de Stock
--
--  El Control de Stock escribe la cantidad contada derecho sobre
--  inventario.INVENTARIO, así que apenas se cierra el recorrido
--  el número contado PASA A SER el stock actual y ya no se puede
--  reconstruir qué había antes ni cuánto dio la diferencia. Es
--  justo lo que hay que poder mostrar después: qué se contó, quién
--  lo contó y qué faltaba.
--
--  Por eso cada recorrido queda acá con su foto: la cabecera en
--  `conteos` y una línea por artículo en `conteo_lineas` con el
--  stock que tenía el sistema ANTES, lo contado y la diferencia.
--  Es un registro histórico: no se recalcula ni se toca cuando el
--  stock cambia después.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── Cabecera: un renglón por recorrido ───────────────────────
create table if not exists public.conteos (
  id             bigint generated always as identity primary key,
  fecha          timestamptz not null default now(),  -- cuándo arrancó
  cerrado_at     timestamptz,                         -- cuándo tocó "Terminar"
  responsable    text,
  filtros        text,          -- qué filtro tenía puesto (queda como contexto)
  articulos      integer not null default 0,  -- cuántos había en la lista
  contados       integer not null default 0,
  con_diferencia integer not null default 0,
  cerrado        boolean not null default false,
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── Detalle: un renglón por artículo contado ─────────────────
--  Los datos del artículo se copian (código, descripción, unidad):
--  el registro tiene que seguir leyéndose igual aunque después le
--  cambien el nombre o lo borren del inventario. Por eso
--  inventario_id NO es una foreign key.
create table if not exists public.conteo_lineas (
  id             bigint generated always as identity primary key,
  conteo_id      bigint not null references public.conteos(id) on delete cascade,
  inventario_id  bigint,
  codigo         text,
  descripcion    text not null,
  unidad         text,
  categoria      text,
  stock_anterior numeric,   -- lo que decía el sistema antes de contar
  contado        numeric,   -- lo que se contó en el depósito
  diferencia     numeric,   -- contado - stock_anterior
  estado         text,      -- semáforo al momento del conteo
  hora           timestamptz not null default now()
);

-- Un artículo entra una sola vez por recorrido: si se corrige el
-- número, se pisa la línea en vez de duplicarla.
create unique index if not exists idx_conteo_lineas_unico
  on public.conteo_lineas(conteo_id, descripcion);

create index if not exists idx_conteos_fecha       on public.conteos(fecha desc);
create index if not exists idx_conteo_lineas_conteo on public.conteo_lineas(conteo_id);

comment on table  public.conteos               is 'Historial de recorridos de Control de Stock';
comment on table  public.conteo_lineas         is 'Detalle por artículo: foto del antes/contado/diferencia';
comment on column public.conteo_lineas.stock_anterior is 'Stock del sistema ANTES de contar. Historico: no se recalcula';

-- updated_at al día
create or replace function public.conteos_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_conteos_touch on public.conteos;
create trigger trg_conteos_touch before update on public.conteos
  for each row execute function public.conteos_touch();

-- ── Permisos ─────────────────────────────────────────────────
--  Mismo criterio que el resto: quien tiene el módulo de stock
--  cuenta y ve el historial. El admin pasa por has_module().
alter table public.conteos       enable row level security;
alter table public.conteo_lineas enable row level security;

drop policy if exists p_conteos_read on public.conteos;
create policy p_conteos_read on public.conteos
  for select using (public.has_module('stock'));

drop policy if exists p_conteos_write on public.conteos;
create policy p_conteos_write on public.conteos
  for all using (public.has_module('stock')) with check (public.has_module('stock'));

drop policy if exists p_conteo_lineas_read on public.conteo_lineas;
create policy p_conteo_lineas_read on public.conteo_lineas
  for select using (public.has_module('stock'));

drop policy if exists p_conteo_lineas_write on public.conteo_lineas;
create policy p_conteo_lineas_write on public.conteo_lineas
  for all using (public.has_module('stock')) with check (public.has_module('stock'));

grant select, insert, update, delete on public.conteos       to authenticated;
grant select, insert, update, delete on public.conteo_lineas to authenticated;
grant usage, select on sequence public.conteos_id_seq        to authenticated;
grant usage, select on sequence public.conteo_lineas_id_seq  to authenticated;

-- ── Comprobar ────────────────────────────────────────────────
select 'conteos'       as tabla, count(*) as filas from public.conteos
union all
select 'conteo_lineas' as tabla, count(*)          from public.conteo_lineas;
