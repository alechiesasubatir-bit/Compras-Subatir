-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v13
--
--  Llegar a la fábrica deja de consumir. Ahora son DOS pasos.
--
--  v6 había decidido que en Artigas "llegar ES el fin de la
--  trazabilidad": al escanear la llegada el pallet pasaba directo a
--  CONSUMIDO, en el mismo movimiento. Eso ya no alcanza — la
--  mercadería que llega de Furriol puede quedarse guardada en Artigas
--  un tiempo antes de usarse.
--
--  El flujo pasa a ser:
--
--    Furriol --escaneo de salida--> EN_TRANSITO
--       --escaneo de llegada--> RECIBIDO en Artigas, SIN UBICAR (piso)
--          ├── Consumir  -> CONSUMIDO   (va a fabricación, fin)
--          └── Ubicar    -> ESTACIONADO en una estantería de Artigas
--                           y se consume más adelante
--
--  Artigas SIGUE siendo tipo FABRICA: lo que cambia es que la llegada
--  ya no consume sola. La diferencia real de una fábrica pasa a ser
--  que ahí SÍ se puede consumir, cosa que en un almacén no tiene
--  sentido (de un almacén la mercadería sale por transferencia).
--
--  Sobre el stock: la llegada suma al depósito destino y el consumo
--  resta, igual que antes. Lo único que cambia es CUÁNDO pasa lo
--  segundo. Un pallet recibido y todavía no consumido ahora figura
--  como stock real en Artigas, que es lo correcto: está ahí.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v12.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Escaneo: la llegada siempre deja el pallet RECIBIDO ───
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
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

-- ── 2. Consumir: el paso que antes iba pegado a la llegada ───
--  Sólo en depósitos de tipo FABRICA. En un almacén la mercadería sale
--  por transferencia, no se consume: dejarlo abierto ahí sería una
--  forma silenciosa de descontar stock sin dejar a dónde fue.
create or replace function public.imp_pallet_consumir(p_pallet bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_tipo text;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
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

-- ── 3. Comprobación ──────────────────────────────────────────
-- select codigo, estado, deposito, estanteria_id, llegada_at, consumido_at
--   from public.imp_pallets order by created_at desc;
--
--  Lo que llegó a Artigas y todavía no se usó:
-- select p.codigo, a.descripcion, p.unidades, p.llegada_at
--   from public.imp_pallets p join public.imp_articulos a on a.id=p.articulo_id
--  where p.deposito='Artigas' and p.estado in ('RECIBIDO','ESTACIONADO');
