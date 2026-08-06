-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v16
--
--  El módulo "recorrido" puede operar de verdad.
--
--  El problema: en la v14 se creó la pantalla de Recorrido con su
--  propio permiso ('recorrido', para el operario que sale a llevar
--  y traer pallets con el teléfono), pero las funciones que esa
--  pantalla usa quedaron pidiendo 'importacion', que es el permiso
--  del panel completo. Resultado: el operario entra a la pantalla,
--  escanea, y la base le contesta "Sin permiso". Podía mirar pero
--  no trabajar.
--
--  Qué cambia: las cuatro funciones del recorrido aceptan ahora
--  'recorrido' O 'importacion'. Nada más. Los cuerpos son los
--  mismos de la v13/v14 y v2: sólo se movió la línea del permiso.
--
--    · imp_pallet_scan       — escanear el QR (salida y llegada)
--    · imp_pallet_consumir   — consumir el pallet en la fábrica
--    · imp_pallet_ubicar     — guardarlo en una ranura al llegar
--    · imp_solicitud_iniciar — arrancar el pedido que va a llevar
--
--  Lo que NO se toca: armar pallets, ingresar mercadería, contar,
--  configurar el depósito. Todo eso sigue siendo sólo de
--  'importacion': el operario del recorrido mueve lo que ya existe,
--  no crea ni ajusta stock.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v15.sql
--  Es idempotente.
-- ============================================================

-- ── 0. Quién puede operar el recorrido ───────────────────────
--    En una sola función para no repetir el criterio en cuatro
--    lugares y que la próxima vez se cambie en uno solo.
create or replace function public.imp_puede_recorrido()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_module('recorrido') or public.has_module('importacion');
$$;

-- ── 1. Escaneo del QR ────────────────────────────────────────
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.imp_puede_recorrido() then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where codigo = p_codigo;
  if not found then return jsonb_build_object('ok',false,'error','QR no encontrado'); end if;

  if p.estado = 'ABIERTO' then
    return jsonb_build_object('ok',false,
      'error','El pallet está abierto: cerralo antes de despacharlo','estado',p.estado);

  elsif p.estado = 'ESTACIONADO' then
    if p.destino is null then
      return jsonb_build_object('ok',false,
        'error','El pallet no tiene destino asignado (marcalo desde Transferir pallets)','estado',p.estado);
    end if;
    perform public.imp_stock_add(p.articulo_id, p.deposito, -p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,ubicacion_de)
      values (p.id,p.articulo_id,'SALIDA',p.deposito,p.destino,p.deposito,p.unidades,p_user,
              public.imp_ubic_txt2(p.estanteria_id,p.fila,p.columna,p.zona_id));
    update public.imp_pallets
       set estado='EN_TRANSITO', origen=p.deposito, deposito=null,
           estanteria_id=null, fila=null, columna=null,
           salida_at=now(), salida_by=p_user
     where id=p.id;
    return jsonb_build_object('ok',true,'estado','EN_TRANSITO','accion','salida','pallet',p.codigo,
                              'origen',p.deposito,'destino',p.destino,
                              'destino_tipo',public.imp_dep_tipo(p.destino));

  elsif p.estado = 'EN_TRANSITO' then
    -- Sin distinguir almacén de fábrica: en los dos casos la mercadería
    -- llega y queda sin ubicar, esperando que la guarden o la usen.
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    update public.imp_pallets set estado='RECIBIDO', deposito=p.destino,
           llegada_at=now(), llegada_by=p_user where id=p.id;
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);
    return jsonb_build_object('ok',true,'estado','RECIBIDO','accion','entrada','pallet',p.codigo,
                              'destino',p.destino,
                              'destino_tipo',public.imp_dep_tipo(p.destino));

  elsif p.estado = 'CONSUMIDO' then
    return jsonb_build_object('ok',false,
      'error','Ese pallet ya se consumió en '||coalesce(p.deposito,'fábrica'),'estado',p.estado);
  else
    return jsonb_build_object('ok',false,'error','El pallet ya fue recibido','estado',p.estado);
  end if;
end $$;

-- ── 2. Consumir en la fábrica ────────────────────────────────
create or replace function public.imp_pallet_consumir(p_pallet bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_tipo text;
begin
  if not public.imp_puede_recorrido() then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then return jsonb_build_object('ok',false,'error','Pallet inexistente'); end if;

  if p.estado = 'CONSUMIDO' then
    return jsonb_build_object('ok',false,'error','Ese pallet ya está consumido');
  end if;
  if p.estado not in ('RECIBIDO','ESTACIONADO') then
    return jsonb_build_object('ok',false,
      'error','Sólo se puede consumir un pallet recibido o estacionado (está '||p.estado||')');
  end if;
  if p.deposito is null then
    return jsonb_build_object('ok',false,'error','El pallet no está en ningún depósito');
  end if;

  v_tipo := public.imp_dep_tipo(p.deposito);
  if v_tipo <> 'FABRICA' then
    return jsonb_build_object('ok',false,
      'error','En '||p.deposito||' la mercadería sale por transferencia, no se consume');
  end if;

  perform public.imp_stock_add(p.articulo_id, p.deposito, -p.unidades);
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,ubicacion_de)
    values (p.id,p.articulo_id,'CONSUMO',p.deposito,p.unidades,p_user,
            public.imp_ubic_txt2(p.estanteria_id,p.fila,p.columna,p.zona_id));

  -- Se libera la ranura: el pallet ya no está físicamente ahí.
  update public.imp_pallets
     set estado='CONSUMIDO', estanteria_id=null, fila=null, columna=null,
         subdeposito_id=null, consumido_at=now(), consumido_by=p_user
   where id=p.id;

  return jsonb_build_object('ok',true,'estado','CONSUMIDO','pallet',p.codigo,
                            'deposito',p.deposito,'unidades',p.unidades);
end $$;

-- ── 3. Guardar el pallet en una ranura ───────────────────────
create or replace function public.imp_pallet_ubicar(p_pallet bigint, p_est bigint, p_fila int, p_col int, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dep text; p record; v_de text; v_a text;
begin
  if not public.imp_puede_recorrido() then raise exception 'Sin permiso'; end if;
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

-- ── 4. Arrancar la solicitud que sale a buscar ───────────────
create or replace function public.imp_solicitud_iniciar(p_sol bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_n int;
begin
  if not public.imp_puede_recorrido() then raise exception 'Sin permiso'; end if;
  select * into s from public.imp_solicitudes where id = p_sol;
  if not found then return jsonb_build_object('ok',false,'error','Solicitud inexistente'); end if;
  if s.estado <> 'PENDIENTE' then
    return jsonb_build_object('ok',false,'error','La solicitud ya está '||s.estado);
  end if;

  update public.imp_pallets p
     set destino = s.destino
    from public.imp_solicitud_items i
   where i.solicitud_id = p_sol and i.estado = 'PEDIDO' and p.id = i.pallet_id;
  get diagnostics v_n = row_count;

  update public.imp_solicitudes
     set estado='EN_PREPARACION', operario=p_user, iniciada_at=now()
   where id = p_sol;

  return jsonb_build_object('ok',true,'solicitud',p_sol,'pallets',v_n,'destino',s.destino);
end $$;

-- Las políticas RLS de las tablas quedan como están, a propósito: las
-- cuatro funciones son SECURITY DEFINER y la pantalla de Recorrido no
-- escribe ninguna tabla en forma directa (sólo llama a estas RPC). Así
-- el operario puede hacer su trabajo por el camino previsto y nada más:
-- desde la consola del navegador no puede tocar pallets ni stock.

-- ── 5. Comprobación ──────────────────────────────────────────
select p.proname as funcion,
       case when pg_get_functiondef(p.oid) like '%imp_puede_recorrido%'
            then '✅ acepta recorrido' else '❌ sigue pidiendo importacion' end as estado
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public'
   and p.proname in ('imp_pallet_scan','imp_pallet_consumir','imp_pallet_ubicar','imp_solicitud_iniciar')
 order by 1;
