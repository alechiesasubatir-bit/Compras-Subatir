-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v2
--
--  1) Pallet ABIERTO → CERRADO. El cierre es la recepción:
--     genera el QR y suma el stock al depósito.
--  2) La ubicación queda rastreada en imp_movimientos.
--  3) Disposición de las estanterías en el plano (fila + orden),
--     para representar racks en línea o en paralelo.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_schema.sql
--  Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================

-- ── 0. Freno: v2 no se corre encima de v3 ────────────────────
--   v2 es idempotente consigo mismo, pero NO con las etapas que
--   vienen después: reinstalaría el imp_pallet_scan de 2 parámetros
--   (conviviendo con el de 3 de v3 → llamada ambigua), el
--   imp_pallet_cerrar sin el control de depósito de fábrica, y el
--   imp_pallet_contar de 4 parámetros que v4 elimina.
--   Si v3 ya está aplicada, saltá directo a la etapa que falte.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='imp_zonas') then
    raise exception 'imp_v2 ya fue superado por imp_v3 (existe imp_zonas). No lo vuelvas a correr: reinstalaría versiones viejas de imp_pallet_scan, imp_pallet_cerrar e imp_pallet_contar. Corré imp_check.sql para ver qué falta.';
  end if;
end $$;

-- ── 1. Pallets: estado ABIERTO + datos del cierre ────────────
-- un_x_caja se congela en el pallet: si mañana cambia el del
-- artículo, la etiqueta impresa sigue cuadrando con lo que se contó.
alter table public.imp_pallets add column if not exists un_x_caja  numeric;
alter table public.imp_pallets add column if not exists cerrado_at timestamptz;
alter table public.imp_pallets add column if not exists cerrado_by text;

alter table public.imp_pallets drop constraint if exists imp_pallets_estado_check;
alter table public.imp_pallets add constraint imp_pallets_estado_check
  check (estado in ('ABIERTO','ESTACIONADO','EN_TRANSITO','RECIBIDO'));

-- Los pallets que ya existían se dan por cerrados: su stock ya fue contado.
update public.imp_pallets
   set cerrado_at = coalesce(cerrado_at, created_at),
       cerrado_by = coalesce(cerrado_by, created_by)
 where estado <> 'ABIERTO' and cerrado_at is null;

-- ── 2. Movimientos: de qué ubicación a qué ubicación ─────────
alter table public.imp_movimientos add column if not exists ubicacion_de text;
alter table public.imp_movimientos add column if not exists ubicacion_a  text;

-- Ubicación legible: "Rack A · B3"
create or replace function public.imp_ubic_txt(p_est bigint, p_fila int, p_col int)
returns text language sql stable set search_path = public as $$
  select case
    when p_est is null or p_fila is null or p_col is null then null
    else coalesce((select e.nombre from public.imp_estanterias e where e.id = p_est), 'Est?')
         || ' · ' || chr(64 + p_fila) || p_col::text
  end;
$$;

-- ── 3. Estanterías: posición en el plano del depósito ────────
--   plano_fila  = en qué hilera del plano está el rack
--   plano_orden = su lugar dentro de esa hilera
--   Todos en fila 1  → racks en LÍNEA (uno al lado del otro)
--   Una fila cada uno → racks en PARALELO (enfrentados, con pasillo)
alter table public.imp_estanterias add column if not exists plano_fila  int not null default 1;
alter table public.imp_estanterias add column if not exists plano_orden int not null default 1;

-- Semilla: numera el orden por nombre dentro de cada depósito.
-- Sólo en la primera corrida, cuando nadie tocó todavía la disposición.
-- Si ya está configurada, renumerar la rompería: en la disposición en
-- PARALELO todos los racks tienen plano_orden = 1 y se distinguen por
-- plano_fila, así que numerarlos 1..n los desparramaría en diagonal.
do $$
begin
  if not exists (select 1 from public.imp_estanterias
                  where plano_fila <> 1 or plano_orden <> 1) then
    with r as (
      select id, row_number() over (partition by deposito order by nombre) rn
        from public.imp_estanterias
    )
    update public.imp_estanterias e
       set plano_orden = r.rn
      from r
     where r.id = e.id;
  end if;
end $$;

-- ── 4. Ubicar un pallet: ahora deja rastro ───────────────────
create or replace function public.imp_pallet_ubicar(p_pallet bigint, p_est bigint, p_fila int, p_col int, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dep text; p record; v_de text; v_a text;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then raise exception 'Pallet inexistente'; end if;

  v_de := public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna);

  if p_est is not null then
    select deposito into v_dep from public.imp_estanterias where id = p_est;
    if v_dep is null then raise exception 'Estantería inválida'; end if;
    if exists(select 1 from public.imp_pallets
               where estanteria_id = p_est and fila = p_fila and columna = p_col and id <> p_pallet) then
      raise exception 'Esa ranura ya está ocupada';
    end if;
    update public.imp_pallets
       set estanteria_id = p_est, fila = p_fila, columna = p_col, deposito = v_dep
     where id = p_pallet;
    v_a := public.imp_ubic_txt(p_est, p_fila, p_col);
  else
    update public.imp_pallets
       set estanteria_id = null, fila = null, columna = null
     where id = p_pallet;
    v_a := null;
  end if;

  -- Sin movimiento si no cambió nada
  if v_de is distinct from v_a then
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,ubicacion_de,ubicacion_a)
      values (p_pallet, p.articulo_id, 'UBICACION', coalesce(v_dep, p.deposito), p.unidades, p_user, v_de, v_a);
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ── 5. Contar: ajustar cajas/unidades mientras está ABIERTO ──
create or replace function public.imp_pallet_contar(p_pallet bigint, p_cajas numeric, p_unidades numeric, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then return jsonb_build_object('ok',false,'error','Pallet inexistente'); end if;
  if p.estado <> 'ABIERTO' then
    return jsonb_build_object('ok',false,'error','El pallet ya está cerrado: no se puede cambiar el conteo');
  end if;
  update public.imp_pallets set cajas = p_cajas, unidades = coalesce(p_unidades,0) where id = p_pallet;
  return jsonb_build_object('ok', true);
end $$;

-- ── 6. CERRAR pallet = recepción de la mercadería ────────────
--   Suma el stock al depósito y deja el movimiento RECEPCION.
--   A partir de acá el QR es válido para despachar.
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

  perform public.imp_stock_add(p.articulo_id, p.deposito, p.unidades);
  update public.imp_pallets
     set estado = 'ESTACIONADO', cerrado_at = now(), cerrado_by = p_user
   where id = p.id;
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,destino,deposito,unidades,usuario,ubicacion_a)
    values (p.id, p.articulo_id, 'RECEPCION', p.deposito, p.deposito, p.unidades, p_user,
            public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna));

  return jsonb_build_object('ok',true,'codigo',p.codigo,'unidades',p.unidades,'deposito',p.deposito);
end $$;

-- ── 7. Escaneo: un pallet abierto no se puede despachar ──────
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
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
              public.imp_ubic_txt(p.estanteria_id,p.fila,p.columna));
    update public.imp_pallets
       set estado='EN_TRANSITO', origen=p.deposito, deposito=null,
           estanteria_id=null, fila=null, columna=null, salida_at=now(), salida_by=p_user
     where id=p.id;
    return jsonb_build_object('ok',true,'estado','EN_TRANSITO','accion','salida','pallet',p.codigo,'origen',p.deposito,'destino',p.destino);

  elsif p.estado = 'EN_TRANSITO' then
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    update public.imp_pallets set estado='RECIBIDO', deposito=p.destino, llegada_at=now(), llegada_by=p_user where id=p.id;
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);
    return jsonb_build_object('ok',true,'estado','RECIBIDO','accion','entrada','pallet',p.codigo,'destino',p.destino);

  else
    return jsonb_build_object('ok',false,'error','El pallet ya fue recibido','estado',p.estado);
  end if;
end $$;
