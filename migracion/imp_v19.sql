-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v19
--
--  Nace el Operador Logístico: el que recibe en destino.
--
--  Hasta ahora "recorrido" era un permiso solo: el mismo que
--  levanta y despacha en Furriol podía confirmar llegadas. La v17
--  obligó a que fueran personas distintas, pero seguían siendo el
--  mismo tipo de usuario, con la misma pantalla y la misma
--  capacidad de despachar.
--
--  Con el módulo nuevo 'recepcion_deposito' la figura queda
--  separada de verdad:
--
--    recorrido          → busca el pallet, lo levanta y DESPACHA.
--                         (sigue pudiendo recibir lo que no despachó él)
--    recepcion_deposito → SÓLO confirma llegadas. No puede sacar
--                         mercadería de un depósito ni iniciar un
--                         pedido. Es el Operador Logístico de destino.
--
--  Por qué no alcanzaba con crear otro usuario con 'recorrido':
--  ese usuario podría despachar desde Furriol y ver todos los
--  pedidos. Quien espera en Artigas no tiene nada que hacer del
--  otro lado; darle sólo lo que necesita es lo que hace que el
--  control de la v17 signifique algo.
--
--  La regla de la v17 sigue en pie y no se toca: quien despachó no
--  confirma su propia entrega, sea cual sea su módulo.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v18.sql
--  Es idempotente. No cambia ningún dato ni ningún permiso ya dado.
-- ============================================================

-- ── 1. Quién puede hacer qué ─────────────────────────────────
--    Dos funciones en vez de una: la diferencia entre sacar y
--    recibir es justamente lo que se quiere separar.

-- Sacar mercadería de un depósito: sigue siendo del recorrido.
create or replace function public.imp_puede_despachar()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_module('recorrido') or public.has_module('importacion');
$$;

-- Confirmar una llegada: el operador logístico de destino, y también
-- quien hace el recorrido (muchas veces viaja con la carga y la recibe
-- otra persona del equipo, pero el circuito tiene que seguir andando
-- si el que espera es el mismo que atiende otros pedidos).
create or replace function public.imp_puede_recibir()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_module('recepcion_deposito')
      or public.has_module('recorrido')
      or public.has_module('importacion');
$$;

-- Se conserva por compatibilidad: la usan imp_pallet_ubicar y
-- imp_pallet_consumir, que las hacen los dos roles.
create or replace function public.imp_puede_recorrido()
returns boolean language sql stable security definer set search_path = public as $$
  select public.imp_puede_recibir();
$$;

-- ── 2. El escaneo, con cada punta en su permiso ──────────────
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_uid uuid := auth.uid(); v_quien text; v_tipo text;
begin
  select * into p from public.imp_pallets where codigo = p_codigo;
  if not found then return jsonb_build_object('ok',false,'error','QR no encontrado'); end if;

  if p.estado = 'ABIERTO' then
    return jsonb_build_object('ok',false,
      'error','El pallet está abierto: cerralo antes de despacharlo','estado',p.estado);

  elsif p.estado = 'ESTACIONADO' then
    -- SALIDA: sacar mercadería de un depósito. El operador logístico de
    -- destino no puede hacerlo: él recibe, no despacha.
    if not public.imp_puede_despachar() then
      return jsonb_build_object('ok',false,'estado',p.estado,'accion','bloqueada',
        'error','Este pallet todavía no salió. Vos confirmás las llegadas, '||
                'el despacho lo hace quien arma el recorrido.');
    end if;
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
    -- LLEGADA: acá sí entra el operador logístico.
    if not public.imp_puede_recibir() then raise exception 'Sin permiso'; end if;

    -- v17: el que despachó no confirma su propia entrega.
    if p.salida_uid is not null and v_uid is not null and p.salida_uid = v_uid then
      v_quien := coalesce(nullif(btrim(p.salida_by),''), 'vos mismo');
      return jsonb_build_object('ok',false,'estado',p.estado,'accion','bloqueada',
        'error','Este pallet lo despachaste vos ('||v_quien||'): la llegada la tiene que '||
                'confirmar otra persona en '||coalesce(p.destino,'destino')||'.');
    end if;

    v_tipo := public.imp_dep_tipo(p.destino);

    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);

    if v_tipo = 'FABRICA' then
      -- v18: en la fábrica no queda saldo, va derecho a producción.
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

-- ── 3. Iniciar el recorrido: sólo quien lo camina ────────────
create or replace function public.imp_solicitud_iniciar(p_sol bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_n int;
begin
  if not public.imp_puede_despachar() then raise exception 'Sin permiso'; end if;
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

-- ── 4. Qué está por llegar a cada depósito ───────────────────
--    La pantalla del operador logístico: lo que viene en camino,
--    sin la lista de pedidos ni el recorrido de Furriol.
create or replace view public.imp_por_recibir
with (security_invoker = true) as
select p.id, p.codigo, p.articulo_id, a.descripcion as articulo, a.codigo as art_codigo,
       p.unidades, p.origen, p.destino, p.salida_at, p.salida_by,
       (p.salida_uid is not null and p.salida_uid = auth.uid()) as lo_despache_yo,
       public.imp_dep_tipo(p.destino) as destino_tipo,
       i.solicitud_id
  from public.imp_pallets p
  join public.imp_articulos a on a.id = p.articulo_id
  left join public.imp_solicitud_items i
         on i.pallet_id = p.id and i.estado in ('PEDIDO','ENVIADO')
 where p.estado = 'EN_TRANSITO';

-- ── 5. Comprobación ──────────────────────────────────────────
select case when exists(
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='imp_puede_recibir')
       then '✅ el rol de recepción existe' else '❌ no se aplicó' end as rol_recepcion,
       case when exists(select 1 from information_schema.views
                         where table_schema='public' and table_name='imp_por_recibir')
       then '✅ vista imp_por_recibir' else '❌ falta la vista' end as vista;

-- Para dar de alta al Operador Logístico desde usuarios.html se le marca
-- "Recepción en destino". A mano sería:
-- update public.profiles
--    set modules = array_append(modules,'recepcion_deposito')
--  where email = 'operadorlogistico.artigas@gmail.com';
