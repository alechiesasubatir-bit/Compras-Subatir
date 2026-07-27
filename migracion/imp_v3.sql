-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v3
--
--  1) Los depósitos tienen tipo:
--       ALMACEN → se estaciona en racks (Furriol)
--       FABRICA → no se guarda, se usa (Artigas)
--  2) Los depósitos de fábrica se organizan por ZONAS, no por ranuras.
--  3) Un pallet que llega a fábrica se consume entero en el acto:
--     queda el rastro de que entró y de que se consumió.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v2.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Tipo de depósito ──────────────────────────────────────
alter table public.imp_depositos add column if not exists tipo text not null default 'ALMACEN';
alter table public.imp_depositos drop constraint if exists imp_depositos_tipo_check;
alter table public.imp_depositos add constraint imp_depositos_tipo_check
  check (tipo in ('ALMACEN','FABRICA'));

update public.imp_depositos set tipo='FABRICA' where nombre='Artigas';
update public.imp_depositos set tipo='ALMACEN' where nombre='Furriol';

-- ── 2. Zonas (sólo para depósitos de fábrica) ────────────────
create table if not exists public.imp_zonas (
  id         bigint generated always as identity primary key,
  deposito   text not null references public.imp_depositos(nombre),
  nombre     text not null,
  orden      int  not null default 1,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (deposito, nombre)
);
insert into public.imp_zonas(deposito,nombre,orden) values
  ('Artigas','Producción',1),
  ('Artigas','Playa',2),
  ('Artigas','Insumos',3)
  on conflict (deposito, nombre) do nothing;

-- ── 3. El pallet puede apuntar a una zona en vez de una ranura ─
alter table public.imp_pallets add column if not exists zona_id bigint;
do $$ begin
  alter table public.imp_pallets add constraint imp_pallets_zona_fk
    foreign key (zona_id) references public.imp_zonas(id) on delete set null;
exception when duplicate_object then null; when others then null; end $$;

-- Estado nuevo: CONSUMIDO (se usó en fábrica, ya no existe como pallet)
alter table public.imp_pallets drop constraint if exists imp_pallets_estado_check;
alter table public.imp_pallets add constraint imp_pallets_estado_check
  check (estado in ('ABIERTO','ESTACIONADO','EN_TRANSITO','RECIBIDO','CONSUMIDO'));

alter table public.imp_pallets add column if not exists consumido_at timestamptz;
alter table public.imp_pallets add column if not exists consumido_by text;

-- ── 4. RLS y realtime para la tabla nueva ────────────────────
alter table public.imp_zonas enable row level security;
drop policy if exists p_imp_zonas_read on public.imp_zonas;
create policy p_imp_zonas_read on public.imp_zonas for select using (auth.role()='authenticated');
drop policy if exists p_imp_zonas_write on public.imp_zonas;
create policy p_imp_zonas_write on public.imp_zonas for all
  using (public.has_module('importacion')) with check (public.has_module('importacion'));
do $$ begin
  execute 'alter publication supabase_realtime add table public.imp_zonas';
exception when duplicate_object then null; when others then null; end $$;

-- ── 5. Helper: tipo de un depósito ───────────────────────────
create or replace function public.imp_dep_tipo(p_dep text)
returns text language sql stable set search_path = public as $$
  select coalesce((select tipo from public.imp_depositos where nombre = p_dep), 'ALMACEN');
$$;

-- ── 6. Ubicación legible: ranura o zona ──────────────────────
create or replace function public.imp_ubic_txt2(p_est bigint, p_fila int, p_col int, p_zona bigint)
returns text language sql stable set search_path = public as $$
  select case
    when p_zona is not null then
      coalesce((select z.nombre from public.imp_zonas z where z.id = p_zona), 'Zona?')
    when p_est is not null and p_fila is not null and p_col is not null then
      coalesce((select e.nombre from public.imp_estanterias e where e.id = p_est), 'Est?')
      || ' · ' || chr(64 + p_fila) || p_col::text
    else null
  end;
$$;

-- ── 7. Escaneo ───────────────────────────────────────────────
--   Salida de un almacén  → EN_TRANSITO (resta stock del origen)
--   Llegada a un almacén  → RECIBIDO    (suma stock, se estaciona)
--   Llegada a una fábrica → CONSUMIDO   (entra y se consume en el acto)
--
--   Cuando el destino es fábrica hace falta la zona donde se descarga:
--   si no viene, devuelve need_zona para que la app la pida.
drop function if exists public.imp_pallet_scan(text, text);
create or replace function public.imp_pallet_scan(p_codigo text, p_user text, p_zona bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_tipo text; v_zona_dep text; v_ubic text;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where codigo = p_codigo;
  if not found then return jsonb_build_object('ok',false,'error','QR no encontrado'); end if;

  if p.estado = 'ABIERTO' then
    return jsonb_build_object('ok',false,'error','El pallet está abierto: cerralo antes de despacharlo','estado',p.estado);

  elsif p.estado = 'ESTACIONADO' then
    if p.destino is null then
      return jsonb_build_object('ok',false,'error','El pallet no tiene destino asignado (usá Despachar primero)','estado',p.estado);
    end if;
    perform public.imp_stock_add(p.articulo_id, p.deposito, -p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,ubicacion_de)
      values (p.id,p.articulo_id,'SALIDA',p.deposito,p.destino,p.deposito,p.unidades,p_user,
              public.imp_ubic_txt2(p.estanteria_id,p.fila,p.columna,p.zona_id));
    update public.imp_pallets
       set estado='EN_TRANSITO', origen=p.deposito, deposito=null,
           estanteria_id=null, fila=null, columna=null, zona_id=null,
           salida_at=now(), salida_by=p_user
     where id=p.id;
    return jsonb_build_object('ok',true,'estado','EN_TRANSITO','accion','salida','pallet',p.codigo,
                              'origen',p.deposito,'destino',p.destino,
                              'destino_tipo',public.imp_dep_tipo(p.destino));

  elsif p.estado = 'EN_TRANSITO' then
    v_tipo := public.imp_dep_tipo(p.destino);

    if v_tipo = 'FABRICA' then
      -- La zona es obligatoria: es el único rastro físico que queda
      if p_zona is null then
        return jsonb_build_object('ok',false,'need_zona',true,'deposito',p.destino,
                                  'error','Elegí la zona de '||p.destino||' donde se descarga');
      end if;
      select deposito into v_zona_dep from public.imp_zonas where id = p_zona;
      if v_zona_dep is distinct from p.destino then
        return jsonb_build_object('ok',false,'error','Esa zona no pertenece a '||p.destino);
      end if;
      v_ubic := public.imp_ubic_txt2(null,null,null,p_zona);

      -- Entra y se consume en el mismo acto: el stock de fábrica queda en cero,
      -- pero los dos hechos quedan asentados por separado.
      perform public.imp_stock_add(p.articulo_id, p.destino,  p.unidades);
      insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,ubicacion_a)
        values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user,v_ubic);
      perform public.imp_stock_add(p.articulo_id, p.destino, -p.unidades);
      insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,ubicacion_de)
        values (p.id,p.articulo_id,'CONSUMO',p.destino,p.unidades,p_user,v_ubic);

      update public.imp_pallets
         set estado='CONSUMIDO', deposito=p.destino, zona_id=p_zona,
             llegada_at=now(), llegada_by=p_user,
             consumido_at=now(), consumido_by=p_user
       where id=p.id;
      return jsonb_build_object('ok',true,'estado','CONSUMIDO','accion','consumo','pallet',p.codigo,
                                'destino',p.destino,'zona',v_ubic,'unidades',p.unidades);
    end if;

    -- Destino almacén: se recibe y queda para estacionar
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    update public.imp_pallets set estado='RECIBIDO', deposito=p.destino, llegada_at=now(), llegada_by=p_user where id=p.id;
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);
    return jsonb_build_object('ok',true,'estado','RECIBIDO','accion','entrada','pallet',p.codigo,'destino',p.destino);

  elsif p.estado = 'CONSUMIDO' then
    return jsonb_build_object('ok',false,'error','Ese pallet ya se consumió en '||coalesce(p.deposito,'fábrica'),'estado',p.estado);
  else
    return jsonb_build_object('ok',false,'error','El pallet ya fue recibido','estado',p.estado);
  end if;
end $$;

-- ── 8. Cerrar pallet: no tiene sentido en un depósito de fábrica ─
create or replace function public.imp_pallet_cerrar(p_pallet bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then return jsonb_build_object('ok',false,'error','Pallet inexistente'); end if;
  if p.estado <> 'ABIERTO' then
    return jsonb_build_object('ok',false,'error','El pallet ya fue cerrado','estado',p.estado);
  end if;
  if coalesce(p.unidades,0) <= 0 then
    return jsonb_build_object('ok',false,'error','Contá las unidades antes de cerrar el pallet');
  end if;
  if p.deposito is null then
    return jsonb_build_object('ok',false,'error','El pallet no tiene depósito asignado');
  end if;
  if public.imp_dep_tipo(p.deposito) = 'FABRICA' then
    return jsonb_build_object('ok',false,'error',p.deposito||' es depósito de fábrica: la mercadería se consume, no se arma en pallets');
  end if;

  perform public.imp_stock_add(p.articulo_id, p.deposito, p.unidades);
  update public.imp_pallets
     set estado='ESTACIONADO', cerrado_at=now(), cerrado_by=p_user
   where id=p.id;
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,destino,deposito,unidades,usuario,ubicacion_a)
    values (p.id,p.articulo_id,'RECEPCION',p.deposito,p.deposito,p.unidades,p_user,
            public.imp_ubic_txt2(p.estanteria_id,p.fila,p.columna,p.zona_id));
  return jsonb_build_object('ok',true,'codigo',p.codigo,'unidades',p.unidades,'deposito',p.deposito);
end $$;

-- ── 9. Vista para Compras: qué está entrando a cada fábrica ──
--   La app de depósitos y el sistema de Compras comparten la base,
--   así que Compras lee esto para avisar lo que viene en camino.
create or replace view public.imp_en_camino as
select p.id, p.codigo, p.articulo_id, a.descripcion as articulo, a.codigo as art_codigo,
       p.unidades, p.cajas, p.origen, p.destino, p.salida_at, p.salida_by,
       d.tipo as destino_tipo,
       extract(epoch from (now() - p.salida_at))/3600 as horas_en_transito
  from public.imp_pallets p
  left join public.imp_articulos a on a.id = p.articulo_id
  left join public.imp_depositos d on d.nombre = p.destino
 where p.estado = 'EN_TRANSITO';
