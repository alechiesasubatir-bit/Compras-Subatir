-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v18
--
--  Lo que llega a la FÁBRICA va derecho a producción.
--
--  Regla del negocio: en Artigas no se guarda stock. La mercadería
--  que llega se usa. Hasta ahora la llegada dejaba el pallet
--  RECIBIDO con las unidades sumadas al stock de Artigas, y
--  después alguien tenía que apretar "Consumir" — un segundo paso
--  que en la práctica siempre se hace, y que mientras tanto muestra
--  un stock en Artigas que no existe.
--
--  Desde acá, al escanear la llegada en un depósito de tipo
--  FABRICA el pallet queda CONSUMIDO en el mismo acto. En un
--  depósito de tipo ALMACEN no cambia nada: llega, queda RECIBIDO
--  y se guarda en una estantería.
--
--  La bitácora sigue mostrando las dos cosas —ENTRADA y CONSUMO—
--  porque las dos pasaron: llegó y se usó. Y el stock del destino
--  sube y baja en la misma transacción, así que nunca queda un
--  saldo en Artigas pero los informes que leen movimientos siguen
--  cuadrando.
--
--  imp_pallet_consumir NO se toca: sigue estando para el pallet
--  que ya estaba estacionado en la fábrica de antes.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v17.sql
--  Es idempotente.
-- ============================================================

create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_uid uuid := auth.uid(); v_quien text; v_tipo text;
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
           salida_at=now(), salida_by=p_user, salida_uid=v_uid
     where id=p.id;
    return jsonb_build_object('ok',true,'estado','EN_TRANSITO','accion','salida','pallet',p.codigo,
                              'origen',p.deposito,'destino',p.destino,
                              'destino_tipo',public.imp_dep_tipo(p.destino));

  elsif p.estado = 'EN_TRANSITO' then
    -- El que despachó no puede confirmar su propia entrega (v17)
    if p.salida_uid is not null and v_uid is not null and p.salida_uid = v_uid then
      v_quien := coalesce(nullif(btrim(p.salida_by),''), 'vos mismo');
      return jsonb_build_object('ok',false,'estado',p.estado,'accion','bloqueada',
        'error','Este pallet lo despachaste vos ('||v_quien||'): la llegada la tiene que '||
                'confirmar otra persona en '||coalesce(p.destino,'destino')||'.');
    end if;

    v_tipo := public.imp_dep_tipo(p.destino);

    -- Siempre se registra la ENTRADA: llegó, y eso hay que poder verlo.
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);

    if v_tipo = 'FABRICA' then
      -- Va a producción en el mismo acto: el stock que acaba de entrar
      -- se descuenta ya, así en la fábrica no queda saldo.
      perform public.imp_stock_add(p.articulo_id, p.destino, -p.unidades);
      insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario)
        values (p.id,p.articulo_id,'CONSUMO',p.destino,p.unidades,p_user);
      update public.imp_pallets
         set estado='CONSUMIDO', deposito=p.destino,
             estanteria_id=null, fila=null, columna=null, subdeposito_id=null,
             llegada_at=now(), llegada_by=p_user, llegada_uid=v_uid,
             consumido_at=now(), consumido_by=p_user
       where id=p.id;
      return jsonb_build_object('ok',true,'estado','CONSUMIDO','accion','produccion','pallet',p.codigo,
                                'destino',p.destino,'destino_tipo',v_tipo,'unidades',p.unidades);
    end if;

    -- Almacén: llega y espera que lo guarden en una estantería
    update public.imp_pallets set estado='RECIBIDO', deposito=p.destino,
           llegada_at=now(), llegada_by=p_user, llegada_uid=v_uid where id=p.id;
    return jsonb_build_object('ok',true,'estado','RECIBIDO','accion','entrada','pallet',p.codigo,
                              'destino',p.destino,'destino_tipo',v_tipo);

  elsif p.estado = 'CONSUMIDO' then
    return jsonb_build_object('ok',false,
      'error','Ese pallet ya se consumió en '||coalesce(p.deposito,'fábrica'),'estado',p.estado);
  else
    return jsonb_build_object('ok',false,'error','El pallet ya fue recibido','estado',p.estado);
  end if;
end $$;

-- ── Comprobación ─────────────────────────────────────────────
select case when exists(
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='imp_pallet_scan'
            and pg_get_functiondef(p.oid) like '%accion%produccion%')
       then '✅ la llegada a fábrica va a producción' else '❌ no se aplicó' end as estado;

-- Que no quede saldo en las fábricas:
-- select d.nombre, d.tipo, coalesce(sum(s.cantidad),0) as unidades
--   from public.imp_depositos d
--   left join public.imp_stock s on s.deposito = d.nombre
--  group by 1,2 order by 2,1;
