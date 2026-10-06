-- ============================================================
--  imp_v25 · Infraestructura: quién pide, para qué, y a sucursal
--
--  Sobre imp_v23_infra.sql (tiene que estar corrido).
--
--  QUÉ CAMBIA
--  1· Todo pedido de infraestructura lleva QUIÉN LO PIDE (la persona,
--     no la cuenta que lo carga) y el MOTIVO. Los dos obligatorios: sin
--     eso el movimiento no se puede justificar después.
--  2· El destino puede ser un depósito (Artigas) o una SUCURSAL escrita
--     a mano. La sucursal no es un depósito: no tiene stock ni nadie que
--     use la app, así que el renglón se CIERRA AL DESPACHAR (decisión
--     del usuario, 06/10/2026). Sale del stock de origen y listo.
--  3· Vista imp_infra_traza: un renglón por artículo movido, con fecha,
--     quién pidió, motivo, destino, quién despachó y quién recibió.
--     La usa Informes → Depósitos → Infraestructura.
--
--  LA SUCURSAL VIVE EN SU PROPIA COLUMNA, NO EN destino
--  destino tiene FK a imp_depositos: meter "Sucursal Centro" ahí
--  obligaría a darla de alta como depósito, y aparecería en todos los
--  selectores de traslados y de stock. Un pedido tiene destino O
--  sucursal, nunca las dos (check). Las pantallas leen el resumen, que
--  devuelve en "destino" la sucursal cuando no hay depósito, así que
--  no se rompe ninguna que ya muestre "origen → destino".
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente.
-- ============================================================

-- ── 1. Columnas nuevas ───────────────────────────────────────
alter table public.imp_solicitudes
  add column if not exists sucursal    text,
  add column if not exists responsable text,
  add column if not exists motivo      text;

alter table public.imp_solicitudes alter column destino drop not null;

--  Un depósito o una sucursal: exactamente uno.
alter table public.imp_solicitudes drop constraint if exists imp_solicitudes_destino_check;
alter table public.imp_solicitudes add constraint imp_solicitudes_destino_check
  check ( (destino is not null) <> (nullif(trim(coalesce(sucursal,'')),'') is not null) );
--  imp_solicitudes_dep_check (origen <> destino) sigue igual: con destino
--  NULL da NULL y no rechaza, que es lo que corresponde para una sucursal.

-- ── 2. El resumen: "destino" muestra la sucursal si no hay depósito ──
--  Columnas explícitas en vez de s.*: las nuevas van AL FINAL para que
--  create or replace no choque con el orden de la vista anterior.
create or replace view public.imp_solicitud_resumen
with (security_invoker = true) as
select s.id, s.solicitante, s.origen,
       coalesce(s.destino, s.sucursal) as destino,
       s.estado, s.nota, s.operario, s.created_at, s.iniciada_at,
       s.entregada_at, s.cerrada_by, s.pedido_por,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as items,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado = 'ENTREGADO') as entregados,
       (select coalesce(sum(coalesce(p.unidades, i.unidades)),0)
          from public.imp_solicitud_items i
          left join public.imp_pallets p on p.id = i.pallet_id
         where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as unidades,
       (select coalesce(jsonb_agg(to_jsonb(x) order by x.un desc), '[]'::jsonb)
          from (
            select coalesce(a.descripcion, '(sin artículo)') as art,
                   a.codigo                                  as cod,
                   sum(coalesce(p.unidades, i.unidades))     as un,
                   count(*) filter (where i.pallet_id is not null) as pal
              from public.imp_solicitud_items i
              left join public.imp_pallets p   on p.id = i.pallet_id
              left join public.imp_articulos a on a.id = coalesce(p.articulo_id, i.articulo_id)
             where i.solicitud_id = s.id and i.estado <> 'CANCELADO'
             group by a.descripcion, a.codigo
          ) x
       ) as articulos,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.pallet_id is null
           and i.estado <> 'CANCELADO') as sueltos,
       s.sucursal, s.responsable, s.motivo,
       s.destino as destino_deposito
  from public.imp_solicitudes s;

grant select on public.imp_solicitud_resumen to authenticated;

-- ── 3. Pedir infraestructura: con responsable, motivo y sucursal ──
--  Se borra la firma vieja de 6 parámetros: con dos versiones, una
--  llamada con 6 argumentos sería ambigua.
drop function if exists public.imp_infra_pedir(text,text,jsonb,text,text,text);

create or replace function public.imp_infra_pedir(
  p_origen      text,
  p_destino     text,
  p_lineas      jsonb,
  p_nota        text,
  p_user        text,
  p_operador    text default null,
  p_sucursal    text default null,
  p_responsable text default null,
  p_motivo      text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; l record; v_art record; v_disp numeric; v_n int := 0;
        v_suc text := nullif(trim(coalesce(p_sucursal,'')),'');
        v_dst text := nullif(trim(coalesce(p_destino,'')),'');
        v_resp text := nullif(trim(coalesce(p_responsable,'')),'');
        v_mot  text := nullif(trim(coalesce(p_motivo,'')),'');
begin
  if not public.is_admin() then
    raise exception 'Sólo un administrador puede pedir infraestructura';
  end if;
  if v_resp is null then
    return jsonb_build_object('ok',false,'error','Falta quién lo pide');
  end if;
  if v_mot is null then
    return jsonb_build_object('ok',false,'error','Falta el motivo');
  end if;
  if (v_dst is null) = (v_suc is null) then
    return jsonb_build_object('ok',false,'error','Elegí un depósito o escribí la sucursal (uno de los dos)');
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    return jsonb_build_object('ok',false,'error','No pediste ningún artículo');
  end if;
  if p_origen = v_dst then
    return jsonb_build_object('ok',false,'error','El origen y el destino son el mismo depósito');
  end if;

  insert into public.imp_solicitudes(solicitante,origen,destino,sucursal,responsable,motivo,nota,pedido_por)
    values (p_user, p_origen, v_dst, v_suc, v_resp, v_mot,
            nullif(trim(coalesce(p_nota,'')),''),
            nullif(trim(coalesce(p_operador,'')),''))
    returning id into v_id;

  for l in select (e->>'articulo_id')::bigint as art, (e->>'unidades')::numeric as un
             from jsonb_array_elements(p_lineas) e loop
    if l.art is null or coalesce(l.un,0) <= 0 then
      raise exception 'Renglón inválido: falta el artículo o la cantidad';
    end if;
    select * into v_art from public.imp_articulos where id = l.art;
    if not found then raise exception 'Artículo % inexistente', l.art; end if;
    if v_art.tipo is distinct from 'Infraestructura' then
      raise exception '«%» no es de Infraestructura: eso se pide por pallet', v_art.descripcion;
    end if;
    select coalesce(cantidad,0) into v_disp
      from public.imp_stock where articulo_id = l.art and deposito = p_origen;
    if coalesce(v_disp,0) < l.un then
      raise exception 'No hay tanto de «%» en %: quedan %', v_art.descripcion, p_origen, coalesce(v_disp,0);
    end if;

    insert into public.imp_solicitud_items(solicitud_id, articulo_id, unidades)
      values (v_id, l.art, l.un);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok',true,'solicitud',v_id,'items',v_n,
                            'destino',coalesce(v_dst,v_suc));
end $$;

grant execute on function public.imp_infra_pedir(text,text,jsonb,text,text,text,text,text,text) to authenticated;

-- ── 4. Despachar: a una sucursal, cierra en el acto ──────────
--  La nota del movimiento lleva quién pidió y para qué: así el
--  movimiento se explica solo aunque se lo mire sin el pedido.
create or replace function public.imp_infra_despachar(p_item bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i record; s record; v_disp numeric; v_dst text; v_nota text; v_suc boolean;
begin
  if not public.imp_puede_despachar() then
    raise exception 'El despacho lo hace quien arma el recorrido';
  end if;
  select * into i from public.imp_solicitud_items where id = p_item;
  if not found then return jsonb_build_object('ok',false,'error','Renglón inexistente'); end if;
  if i.pallet_id is not null then
    return jsonb_build_object('ok',false,'error','Ese renglón es un pallet: se despacha escaneando el QR');
  end if;
  if i.estado <> 'PEDIDO' then
    return jsonb_build_object('ok',false,'error','Ese renglón ya está '||i.estado);
  end if;
  select * into s from public.imp_solicitudes where id = i.solicitud_id;
  v_suc  := s.destino is null;
  v_dst  := coalesce(s.destino, s.sucursal);
  v_nota := 'Infraestructura · pedido #'||s.id||' · sin pallet'
         || case when v_suc then ' · a sucursal '||s.sucursal else '' end
         || coalesce(' · pide '||s.responsable,'')
         || coalesce(' · motivo: '||coalesce(s.motivo,s.nota),'');

  select coalesce(cantidad,0) into v_disp
    from public.imp_stock where articulo_id = i.articulo_id and deposito = s.origen;
  if coalesce(v_disp,0) < i.unidades then
    return jsonb_build_object('ok',false,
      'error','Ya no hay '||i.unidades||' en '||s.origen||': quedan '||coalesce(v_disp,0));
  end if;

  perform public.imp_stock_add(i.articulo_id, s.origen, -i.unidades);
  insert into public.imp_movimientos(articulo_id,tipo,origen,destino,deposito,unidades,usuario,nota)
    values (i.articulo_id,'SALIDA',s.origen,v_dst,s.origen,i.unidades,p_user,v_nota);

  if v_suc then
    -- Nadie en la sucursal confirma: despachado = entregado.
    update public.imp_solicitud_items
       set estado='ENTREGADO', despachado_at=now(), despachado_by=p_user,
           recibido_at=now(), recibido_by=p_user
     where id = i.id;
    if not exists(select 1 from public.imp_solicitud_items
                   where solicitud_id = s.id and estado in ('PEDIDO','ENVIADO')) then
      update public.imp_solicitudes
         set estado='ENTREGADA', entregada_at=now(), iniciada_at=coalesce(iniciada_at,now())
       where id = s.id and estado <> 'ENTREGADA';
    else
      update public.imp_solicitudes set estado='EN_TRANSITO', iniciada_at=coalesce(iniciada_at,now())
       where id = s.id and estado in ('PENDIENTE','EN_PREPARACION');
    end if;
  else
    update public.imp_solicitud_items
       set estado='ENVIADO', despachado_at=now(), despachado_by=p_user
     where id = i.id;
    update public.imp_solicitudes set estado='EN_TRANSITO', iniciada_at=coalesce(iniciada_at,now())
     where id = s.id and estado in ('PENDIENTE','EN_PREPARACION');
  end if;

  return jsonb_build_object('ok',true,'item',i.id,'unidades',i.unidades,
                            'destino',v_dst,'sucursal',v_suc);
end $$;

-- ── 5. Recibir: la nota también lleva quién pidió y para qué ──
create or replace function public.imp_infra_recibir(p_item bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i record; s record; v_tipo text; v_nota text;
begin
  if not public.imp_puede_recibir() then
    raise exception 'Sin permiso para recibir mercadería';
  end if;
  select * into i from public.imp_solicitud_items where id = p_item;
  if not found then return jsonb_build_object('ok',false,'error','Renglón inexistente'); end if;
  if i.pallet_id is not null then
    return jsonb_build_object('ok',false,'error','Ese renglón es un pallet: se recibe escaneando el QR');
  end if;
  if i.estado <> 'ENVIADO' then
    return jsonb_build_object('ok',false,
      'error', case when i.estado='PEDIDO' then 'Todavía no lo despacharon'
                    else 'Ese renglón ya está '||i.estado end);
  end if;
  select * into s from public.imp_solicitudes where id = i.solicitud_id;
  if s.destino is null then
    return jsonb_build_object('ok',false,'error','Va a una sucursal: se cierra al despachar');
  end if;
  v_tipo := public.imp_dep_tipo(s.destino);
  v_nota := 'Infraestructura · pedido #'||s.id||' · sin pallet'
         || coalesce(' · pide '||s.responsable,'')
         || coalesce(' · motivo: '||coalesce(s.motivo,s.nota),'');

  perform public.imp_stock_add(i.articulo_id, s.destino, i.unidades);
  insert into public.imp_movimientos(articulo_id,tipo,origen,destino,deposito,unidades,usuario,nota)
    values (i.articulo_id,'ENTRADA',s.origen,s.destino,s.destino,i.unidades,p_user,v_nota);

  if v_tipo = 'FABRICA' then
    perform public.imp_stock_add(i.articulo_id, s.destino, -i.unidades);
    insert into public.imp_movimientos(articulo_id,tipo,deposito,unidades,usuario,nota)
      values (i.articulo_id,'CONSUMO',s.destino,i.unidades,p_user,v_nota);
  end if;

  update public.imp_solicitud_items
     set estado='ENTREGADO', recibido_at=now(), recibido_by=p_user
   where id = i.id;

  if not exists(select 1 from public.imp_solicitud_items
                 where solicitud_id = s.id and estado in ('PEDIDO','ENVIADO')) then
    update public.imp_solicitudes set estado='ENTREGADA', entregada_at=now()
     where id = s.id and estado <> 'ENTREGADA';
  end if;

  return jsonb_build_object('ok',true,'item',i.id,'unidades',i.unidades,
                            'destino',s.destino,'destino_tipo',v_tipo);
end $$;

-- ── 6. Bandeja del operario: con sucursal, responsable y motivo ──
create or replace view public.imp_infra_pendientes
with (security_invoker = true) as
select i.id            as item_id,
       i.solicitud_id,
       s.origen, coalesce(s.destino, s.sucursal) as destino,
       s.solicitante, s.pedido_por, s.estado as sol_estado,
       i.estado, i.unidades,
       i.despachado_at, i.despachado_by, i.recibido_at, i.recibido_by,
       a.id            as articulo_id,
       a.descripcion   as articulo,
       a.codigo        as art_codigo,
       coalesce(st.cantidad,0) as stock_origen,
       s.created_at,
       s.sucursal, s.responsable, coalesce(s.motivo, s.nota) as motivo
  from public.imp_solicitud_items i
  join public.imp_solicitudes s on s.id = i.solicitud_id
  join public.imp_articulos   a on a.id = i.articulo_id
  left join public.imp_stock st on st.articulo_id = i.articulo_id and st.deposito = s.origen
 where i.pallet_id is null and i.estado in ('PEDIDO','ENVIADO');

grant select on public.imp_infra_pendientes to authenticated;

-- ── 7. La traza: cada artículo que salió, con fecha y por qué ──
--  Incluye los cancelados (con estado) para que no "desaparezca" nada:
--  el informe decide qué mostrar.
create or replace view public.imp_infra_traza
with (security_invoker = true) as
select i.id              as item_id,
       s.id              as solicitud_id,
       s.created_at      as pedido_at,
       i.despachado_at,
       i.recibido_at,
       a.codigo,
       a.descripcion     as articulo,
       i.unidades,
       s.origen,
       coalesce(s.destino, s.sucursal) as destino,
       case when s.destino is null then 'Sucursal' else 'Depósito' end as destino_tipo,
       s.responsable,
       coalesce(s.motivo, s.nota) as motivo,
       s.solicitante,
       i.despachado_by,
       i.recibido_by,
       i.estado,
       a.id              as articulo_id
  from public.imp_solicitud_items i
  join public.imp_solicitudes s on s.id = i.solicitud_id
  join public.imp_articulos   a on a.id = i.articulo_id
 where i.pallet_id is null;

grant select on public.imp_infra_traza to authenticated;

-- ── 8. Control ─────────────────────────────────────────────
select column_name from information_schema.columns
 where table_name='imp_solicitudes' and column_name in ('sucursal','responsable','motivo')
 order by 1;
-- Esperado: motivo · responsable · sucursal

select solicitud_id, despachado_at::date, articulo, unidades, origen, destino, motivo, estado
  from public.imp_infra_traza order by despachado_at;
-- Esperado: pedido #36 (02/09, 2+14+1 a Artigas, motivo «Fabrica Diego»)
--           y pedido #48 (06/10, 16+5 a Artigas)

select count(*) as pedidos_sin_destino from public.imp_solicitudes
 where destino is null and sucursal is null;
-- Esperado: 0
