-- ============================================================
--  MÓDULO IMPORTACIÓN — esquema
--  Artículos importados (Consumo/Venta/Infraestructura) por
--  depósito, transferencias, pallets con QR y escaneos.
--  Correr UNA vez en Supabase → SQL Editor (luego imp_seed.sql).
-- ============================================================

-- ── Depósitos (configurable: agregar filas para nuevos) ──────
create table if not exists public.imp_depositos (
  nombre      text primary key,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.imp_depositos(nombre) values ('Furriol'),('Artigas')
  on conflict (nombre) do nothing;

-- ── Artículos ────────────────────────────────────────────────
create table if not exists public.imp_articulos (
  id          bigint generated always as identity primary key,
  proveedor   text,                 -- Subatir / Enjoy / Intex
  codigo      text,
  descripcion text not null,
  tipo        text,                 -- Consumo / Venta / Infraestructura (o null)
  un_x_caja   numeric,              -- unidades por caja (para armar pallets)
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (proveedor, descripcion)
);
create index if not exists idx_imp_art_prov on public.imp_articulos(proveedor);
create index if not exists idx_imp_art_tipo on public.imp_articulos(tipo);

-- ── Stock por depósito (en UNIDADES) ─────────────────────────
create table if not exists public.imp_stock (
  id          bigint generated always as identity primary key,
  articulo_id bigint not null references public.imp_articulos(id) on delete cascade,
  deposito    text   not null references public.imp_depositos(nombre),
  cantidad    numeric not null default 0,
  unique (articulo_id, deposito)
);
create index if not exists idx_imp_stock_art on public.imp_stock(articulo_id);

-- ── Pallets (1 artículo, N cajas) con código QR único ────────
create table if not exists public.imp_pallets (
  id          bigint generated always as identity primary key,
  codigo      text unique not null,          -- payload del QR
  articulo_id bigint not null references public.imp_articulos(id) on delete restrict,
  cajas       numeric,
  unidades    numeric not null default 0,    -- unidades que mueve el pallet
  origen      text references public.imp_depositos(nombre),
  destino     text references public.imp_depositos(nombre),
  estado      text not null default 'ARMADO' check (estado in ('ARMADO','EN_TRANSITO','RECIBIDO')),
  created_at  timestamptz not null default now(),
  created_by  text,
  salida_at   timestamptz, salida_by  text,
  llegada_at  timestamptz, llegada_by text
);
create index if not exists idx_imp_pallets_estado on public.imp_pallets(estado);

-- ── Movimientos (bitácora de transferencias y escaneos) ──────
create table if not exists public.imp_movimientos (
  id          bigint generated always as identity primary key,
  pallet_id   bigint references public.imp_pallets(id) on delete set null,
  articulo_id bigint references public.imp_articulos(id) on delete set null,
  tipo        text not null,                 -- SALIDA / ENTRADA / TRANSFER / AJUSTE
  origen      text, destino text, deposito text,
  unidades    numeric,
  usuario     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_imp_mov_pallet on public.imp_movimientos(pallet_id);

-- ── RLS: lectura autenticada, escritura con módulo importacion ─
do $$
declare t text;
begin
  foreach t in array array['imp_depositos','imp_articulos','imp_stock','imp_pallets','imp_movimientos'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_%I_read on public.%I;', t, t);
    execute format('create policy p_%I_read on public.%I for select using (auth.role()=''authenticated'');', t, t);
    execute format('drop policy if exists p_%I_write on public.%I;', t, t);
    execute format('create policy p_%I_write on public.%I for all using (public.has_module(''importacion'')) with check (public.has_module(''importacion''));', t, t);
  end loop;
end $$;

-- ── Helper: suma (o resta) stock de un artículo en un depósito ─
create or replace function public.imp_stock_add(p_art bigint, p_dep text, p_delta numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.imp_stock(articulo_id, deposito, cantidad)
  values (p_art, p_dep, p_delta)
  on conflict (articulo_id, deposito)
  do update set cantidad = public.imp_stock.cantidad + p_delta;
end $$;

-- ── Transferencia directa de stock entre depósitos ───────────
create or replace function public.imp_transfer(p_art bigint, p_origen text, p_destino text, p_unidades numeric, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare disp numeric;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  if p_unidades is null or p_unidades <= 0 then raise exception 'Cantidad inválida'; end if;
  if p_origen = p_destino then raise exception 'Origen y destino iguales'; end if;
  select coalesce(cantidad,0) into disp from public.imp_stock where articulo_id=p_art and deposito=p_origen;
  if coalesce(disp,0) < p_unidades then raise exception 'Stock insuficiente en %', p_origen; end if;
  perform public.imp_stock_add(p_art, p_origen, -p_unidades);
  perform public.imp_stock_add(p_art, p_destino,  p_unidades);
  insert into public.imp_movimientos(articulo_id,tipo,origen,destino,unidades,usuario)
    values (p_art,'TRANSFER',p_origen,p_destino,p_unidades,p_user);
  return jsonb_build_object('ok',true);
end $$;

-- ── Escaneo de pallet: 1º = SALIDA (sale del origen),
--    2º = ENTRADA (llega al destino). Mueve el stock atómicamente.
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where codigo = p_codigo;
  if not found then return jsonb_build_object('ok',false,'error','QR no encontrado'); end if;

  if p.estado = 'ARMADO' then
    perform public.imp_stock_add(p.articulo_id, p.origen, -p.unidades);
    update public.imp_pallets set estado='EN_TRANSITO', salida_at=now(), salida_by=p_user where id=p.id;
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'SALIDA',p.origen,p.destino,p.origen,p.unidades,p_user);
    return jsonb_build_object('ok',true,'estado','EN_TRANSITO','accion','salida','pallet',p.codigo,'origen',p.origen,'destino',p.destino);
  elsif p.estado = 'EN_TRANSITO' then
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    update public.imp_pallets set estado='RECIBIDO', llegada_at=now(), llegada_by=p_user where id=p.id;
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);
    return jsonb_build_object('ok',true,'estado','RECIBIDO','accion','entrada','pallet',p.codigo,'destino',p.destino);
  else
    return jsonb_build_object('ok',false,'error','El pallet ya fue recibido','estado',p.estado);
  end if;
end $$;

-- ── Realtime (para que las listas se actualicen solas) ───────
do $$
declare t text;
begin
  foreach t in array array['imp_articulos','imp_stock','imp_pallets','imp_movimientos'] loop
    begin execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when duplicate_object then null; when others then null; end;
  end loop;
end $$;
