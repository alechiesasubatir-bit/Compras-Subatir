-- ============================================================
--  PEDIDOS VARIOS v2 · varios artículos por pedido + IVA
--
--  Un pedido especial casi nunca es un solo renglón: se le compran
--  tres cosas al mismo proveedor en la misma compra. Pasa a ser
--  cabezal + líneas, como una OC de verdad.
--
--    pedidos_varios        → proveedor, fecha, moneda, IVA, estado
--    pedidos_varios_items  → un renglón por artículo
--
--  IVA: los precios se cargan CON o SIN IVA (se elige por pedido) y
--  el total sale solo. Si algún renglón no tiene precio, el total
--  queda VACÍO a propósito: media suma es peor que ninguna.
--
--  SEGURIDAD: este script REESTRUCTURA la tabla y sólo corre si
--  todavía no hay pedidos cargados. Si ya hay, se planta y avisa.
--
--  Correr UNA vez en Supabase → SQL Editor.
--  Requiere haber corrido antes pedidos_varios.sql
-- ============================================================

-- ── 0. Freno de mano ─────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.pedidos_varios) then
    raise exception 'pedidos_varios ya tiene % fila(s). No se reestructura sin migrar: avisá antes de correr esto.',
      (select count(*) from public.pedidos_varios);
  end if;
end $$;

-- ── 1. Las líneas del pedido ─────────────────────────────────
create table if not exists public.pedidos_varios_items (
  id         bigint generated always as identity primary key,
  pedido_id  bigint not null references public.pedidos_varios(id) on delete cascade,
  articulo   text not null,
  cantidad   numeric,          -- opcional
  precio     numeric,          -- unitario, opcional
  orden      int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_pvitems_pedido on public.pedidos_varios_items(pedido_id, orden);

comment on table  public.pedidos_varios_items         is 'Renglones de un pedido vario';
comment on column public.pedidos_varios_items.precio  is 'Unitario. Vacío = todavía no se sabe';

-- ── 2. El cabezal deja de tener el artículo suelto ───────────
alter table public.pedidos_varios
  drop column if exists articulo,
  drop column if exists cantidad,
  drop column if exists precio;

--  Cómo se cargaron los precios y con qué tasa, para poder
--  recalcular sin ambigüedad.
alter table public.pedidos_varios
  add column if not exists iva_incluido boolean not null default false,
  add column if not exists iva_tasa     numeric not null default 22,
  add column if not exists subtotal     numeric,
  add column if not exists iva_monto    numeric;

alter table public.pedidos_varios drop constraint if exists pedidos_varios_iva_check;
alter table public.pedidos_varios add constraint pedidos_varios_iva_check
  check (iva_tasa in (0, 10, 22));

comment on column public.pedidos_varios.iva_incluido is 'true = los precios cargados YA traen IVA';
comment on column public.pedidos_varios.iva_tasa     is 'Tasa aplicada: 22, 10 o 0 (exento)';
comment on column public.pedidos_varios.subtotal     is 'Neto sin IVA. Vacío si falta algún precio';
comment on column public.pedidos_varios.total        is 'Con IVA. Vacío si falta algún precio';

-- ── 3. Permisos de las líneas ────────────────────────────────
alter table public.pedidos_varios_items enable row level security;

drop policy if exists p_pvitems_read on public.pedidos_varios_items;
create policy p_pvitems_read on public.pedidos_varios_items
  for select using (public.has_module('varios'));

drop policy if exists p_pvitems_write on public.pedidos_varios_items;
create policy p_pvitems_write on public.pedidos_varios_items
  for all
  using (public.has_module('varios'))
  with check (public.has_module('varios'));

grant select, insert, update, delete on public.pedidos_varios_items to authenticated;
grant usage, select on sequence public.pedidos_varios_items_id_seq to authenticated;

-- ── 4. Comprobar ─────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema='public' and table_name='pedidos_varios'
 order by ordinal_position;
