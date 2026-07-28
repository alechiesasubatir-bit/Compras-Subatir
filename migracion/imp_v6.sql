-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v6
--
--  Se van las zonas de fábrica del flujo.
--
--  v3 había modelado Artigas con zonas (Producción / Playa /
--  Insumos) y las hacía obligatorias: al escanear la llegada, el
--  RPC devolvía need_zona y no dejaba confirmar sin elegir una.
--  Esos nombres eran una semilla inventada en la migración, no
--  una división real: en Artigas la mercadería llega y se usa,
--  sin escala intermedia. Llegar ES el fin de la trazabilidad.
--
--  Las zonas NO se borran: el pallet que ya se consumió apunta a
--  una y su bitácora tiene que seguir siendo legible.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v5.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Escaneo sin zona ──────────────────────────────────────
--    Se reemplaza la firma de 3 parámetros de v3 por una de 2.
drop function if exists public.imp_pallet_scan(text, text, bigint);
drop function if exists public.imp_pallet_scan(text, text);
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_tipo text;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
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
    v_tipo := public.imp_dep_tipo(p.destino);

    if v_tipo = 'FABRICA' then
      -- Llega y se consume en el acto. Confirmar la recepción es todo
      -- lo que hay que hacer: no se estaciona ni se elige lugar.
      perform public.imp_stock_add(p.articulo_id, p.destino,  p.unidades);
      insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
        values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);
      perform public.imp_stock_add(p.articulo_id, p.destino, -p.unidades);
      insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario)
        values (p.id,p.articulo_id,'CONSUMO',p.destino,p.unidades,p_user);

      update public.imp_pallets
         set estado='CONSUMIDO', deposito=p.destino,
             llegada_at=now(), llegada_by=p_user,
             consumido_at=now(), consumido_by=p_user
       where id=p.id;
      return jsonb_build_object('ok',true,'estado','CONSUMIDO','accion','consumo','pallet',p.codigo,
                                'destino',p.destino,'unidades',p.unidades);
    end if;

    -- Destino almacén: se recibe y queda para estacionar
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    update public.imp_pallets set estado='RECIBIDO', deposito=p.destino,
           llegada_at=now(), llegada_by=p_user where id=p.id;
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);
    return jsonb_build_object('ok',true,'estado','RECIBIDO','accion','entrada','pallet',p.codigo,'destino',p.destino);

  elsif p.estado = 'CONSUMIDO' then
    return jsonb_build_object('ok',false,
      'error','Ese pallet ya se consumió en '||coalesce(p.deposito,'fábrica'),'estado',p.estado);
  else
    return jsonb_build_object('ok',false,'error','El pallet ya fue recibido','estado',p.estado);
  end if;
end $$;

-- ── 2. Las zonas quedan como dato histórico ──────────────────
--    No se borran ni se desactivan: imp_zonas sigue resolviendo el
--    nombre del lugar donde se consumieron los pallets viejos.
--    Si algún día Artigas abre su depósito, se le cambia el tipo a
--    ALMACEN y se le cargan estanterías; el modelo ya lo contempla.

-- ── 3. Comprobación ──────────────────────────────────────────
-- select p.proname, p.pronargs from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname='imp_pallet_scan';
--  → tiene que quedar una sola fila, con pronargs = 2
