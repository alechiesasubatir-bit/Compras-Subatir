-- ============================================================
--  imp_v23 · Infraestructura se pide por unidad, sin pallet
--            + quién puede pedir cada tipo de artículo
--
--  DOS COSAS, QUE VAN JUNTAS PORQUE TOCAN LO MISMO
--
--  1· Venta, Venta Piscina e Infraestructura los pide sólo un
--     administrador. Consumo lo sigue pidiendo cualquiera con acceso
--     a Solicitar — es lo que Fabricantes pide todos los días y
--     cortarlo pararía la operación.
--
--  2· Infraestructura (estanterías: parantes, estantes, pórticos) NO
--     se palletiza: se pide una CANTIDAD del stock suelto. Venta y
--     Venta Piscina siguen pidiéndose por pallet, como hasta ahora.
--
--  POR QUÉ EN LA MISMA TABLA Y NO EN UNA APARTE
--  Decisión del usuario: el pedido de infraestructura tiene que caerle
--  al operario en la MISMA bandeja que los de consumo. Viviendo en
--  imp_solicitudes, el aviso, la lista del operario, "Mis pedidos" y
--  los estados salen gratis y no hay dos lugares para mirar.
--
--  Un renglón de imp_solicitud_items ahora es una de dos cosas:
--    · un PALLET  (pallet_id, como siempre)
--    · un SUELTO  (articulo_id + unidades, sin pallet)
--  El check no deja que sea las dos ni ninguna.
--
--  EL TRIGGER VIEJO NO SE TOCA. trg_imp_sol_sync busca el renglón por
--  pallet_id, así que los sueltos nunca lo despiertan: no hay forma de
--  que un pallet cierre por accidente un renglón suelto. Los sueltos
--  los cierran sus propias funciones, que además cierran la solicitud
--  cuando ya no queda nada pendiente — lo mismo que hace el trigger,
--  pero por el otro camino.
--
--  SIN QR. Un suelto no tiene etiqueta que escanear: el operario marca
--  "despachado" y quien recibe marca "recibido". Por eso cada renglón
--  guarda QUIÉN marcó cada paso y CUÁNDO.
--
--  SE ENVÍA EXACTO. No hay cantidad parcial: se despacha y se recibe
--  lo que dice el renglón. Decisión del usuario.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Quién puede pedir cada tipo ───────────────────────────
create or replace function public.imp_puede_pedir_tipo(p_tipo text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_tipo,'Consumo') = 'Consumo' or public.is_admin();
$$;
grant execute on function public.imp_puede_pedir_tipo(text) to authenticated;

-- ── 2. Los renglones sueltos ─────────────────────────────────
alter table public.imp_solicitud_items
  alter column pallet_id drop not null;

alter table public.imp_solicitud_items
  add column if not exists articulo_id   bigint references public.imp_articulos(id),
  add column if not exists unidades      numeric,
  add column if not exists despachado_at timestamptz,
  add column if not exists despachado_by text,
  add column if not exists recibido_at   timestamptz,
  add column if not exists recibido_by   text;

--  O es un pallet, o es una cantidad de un artículo. Nunca las dos.
alter table public.imp_solicitud_items drop constraint if exists imp_sol_items_linea_check;
alter table public.imp_solicitud_items add constraint imp_sol_items_linea_check
  check ( (pallet_id is not null and articulo_id is null)
       or (pallet_id is null and articulo_id is not null and unidades > 0) );

--  La reserva de pallets sigue igual. Se recrea sólo para dejar
--  explícito que no aplica a los sueltos (dos NULL no chocan en un
--  índice único, pero eso hay que saberlo para leerlo).
drop index if exists public.imp_solicitud_items_pallet_vivo;
create unique index imp_solicitud_items_pallet_vivo
  on public.imp_solicitud_items(pallet_id)
  where pallet_id is not null and estado in ('PEDIDO','ENVIADO');

create index if not exists imp_sol_items_art_idx
  on public.imp_solicitud_items(articulo_id) where articulo_id is not null;

-- ── 3. El resumen cuenta las dos clases de renglón ───────────
--  Antes hacía join con imp_pallets para sacar unidades y artículo.
--  Con join interno un renglón suelto desaparecía del resumen: el
--  pedido se vería vacío. Ahora el join es left y las unidades salen
--  del pallet o del propio renglón, según cuál sea.
create or replace view public.imp_solicitud_resumen
with (security_invoker = true) as
select s.*,
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
       -- Cuántos renglones van sin pallet: la pantalla los muestra
       -- distinto, porque se marcan a mano en vez de escanearse.
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.pallet_id is null
           and i.estado <> 'CANCELADO') as sueltos
  from public.imp_solicitudes s;

grant select on public.imp_solicitud_resumen to authenticated;

-- ── 4. Pedir por pallet: ahora mira el tipo ──────────────────
--  El filtro de la pantalla no alcanza: cualquiera puede llamar a la
--  función con el id de un pallet que no le tocaba.
create or replace function public.imp_solicitud_crear(
  p_origen   text,
  p_destino  text,
  p_pallets  bigint[],
  p_nota     text,
  p_user     text,
  p_operador text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_pid bigint; v_ok boolean; v_malos text := ''; v_vedados text := '';
begin
  if not (public.has_module('solicitante') or public.has_module('importacion')) then
    raise exception 'Sin permiso para solicitar mercadería';
  end if;
  if p_pallets is null or array_length(p_pallets,1) is null then
    return jsonb_build_object('ok',false,'error','No elegiste ningún pallet');
  end if;
  if p_origen = p_destino then
    return jsonb_build_object('ok',false,'error','El origen y el destino son el mismo depósito');
  end if;

  insert into public.imp_solicitudes(solicitante,origen,destino,nota,pedido_por)
    values (p_user, p_origen, p_destino, nullif(trim(coalesce(p_nota,'')),''),
            nullif(trim(coalesce(p_operador,'')),''))
    returning id into v_id;

  foreach v_pid in array p_pallets loop
    -- ¿le corresponde este tipo de mercadería?
    if not exists(select 1 from public.imp_pallets_disponibles d
                   where d.id = v_pid and public.imp_puede_pedir_tipo(d.tipo)) then
      v_vedados := v_vedados
        || coalesce((select codigo from public.imp_pallets where id=v_pid), v_pid::text) || ', ';
      continue;
    end if;
    select exists(select 1 from public.imp_pallets_disponibles d
                   where d.id = v_pid and d.deposito = p_origen) into v_ok;
    if v_ok then
      insert into public.imp_solicitud_items(solicitud_id,pallet_id) values (v_id, v_pid);
    else
      v_malos := v_malos || coalesce((select codigo from public.imp_pallets where id=v_pid), v_pid::text) || ', ';
    end if;
  end loop;

  if not exists(select 1 from public.imp_solicitud_items where solicitud_id = v_id) then
    delete from public.imp_solicitudes where id = v_id;
    if v_vedados <> '' then
      return jsonb_build_object('ok',false,
        'error','Venta, Venta Piscina e Infraestructura los pide un administrador.');
    end if;
    return jsonb_build_object('ok',false,
      'error','Ninguno de los pallets sigue disponible: alguien se los llevó mientras armabas el pedido');
  end if;

  return jsonb_build_object('ok',true,'solicitud',v_id,
    'items',(select count(*) from public.imp_solicitud_items where solicitud_id=v_id),
    'no_disponibles', nullif(rtrim(v_malos,', '),''),
    'sin_permiso',    nullif(rtrim(v_vedados,', '),''));
end $$;

-- ── 5. Pedir infraestructura (por cantidad) ──────────────────
--  p_lineas: [{"articulo_id":128,"unidades":20}, …]
create or replace function public.imp_infra_pedir(
  p_origen   text,
  p_destino  text,
  p_lineas   jsonb,
  p_nota     text,
  p_user     text,
  p_operador text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; l record; v_art record; v_disp numeric; v_n int := 0;
begin
  if not public.is_admin() then
    raise exception 'Sólo un administrador puede pedir infraestructura';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    return jsonb_build_object('ok',false,'error','No pediste ningún artículo');
  end if;
  if p_origen = p_destino then
    return jsonb_build_object('ok',false,'error','El origen y el destino son el mismo depósito');
  end if;

  insert into public.imp_solicitudes(solicitante,origen,destino,nota,pedido_por)
    values (p_user, p_origen, p_destino, nullif(trim(coalesce(p_nota,'')),''),
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
    -- Se controla acá y OTRA VEZ al despachar: entre el pedido y la
    -- carga puede haber salido stock por otro lado.
    select coalesce(cantidad,0) into v_disp
      from public.imp_stock where articulo_id = l.art and deposito = p_origen;
    if coalesce(v_disp,0) < l.un then
      raise exception 'No hay tanto de «%» en %: quedan %', v_art.descripcion, p_origen, coalesce(v_disp,0);
    end if;

    insert into public.imp_solicitud_items(solicitud_id, articulo_id, unidades)
      values (v_id, l.art, l.un);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok',true,'solicitud',v_id,'items',v_n);
end $$;

-- ── 6. Despachar un renglón suelto (sin QR) ──────────────────
create or replace function public.imp_infra_despachar(p_item bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i record; s record; v_disp numeric;
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

  select coalesce(cantidad,0) into v_disp
    from public.imp_stock where articulo_id = i.articulo_id and deposito = s.origen;
  if coalesce(v_disp,0) < i.unidades then
    return jsonb_build_object('ok',false,
      'error','Ya no hay '||i.unidades||' en '||s.origen||': quedan '||coalesce(v_disp,0));
  end if;

  perform public.imp_stock_add(i.articulo_id, s.origen, -i.unidades);
  insert into public.imp_movimientos(articulo_id,tipo,origen,destino,deposito,unidades,usuario,nota)
    values (i.articulo_id,'SALIDA',s.origen,s.destino,s.origen,i.unidades,p_user,
            'Infraestructura · pedido #'||s.id||' · sin pallet');

  update public.imp_solicitud_items
     set estado='ENVIADO', despachado_at=now(), despachado_by=p_user
   where id = i.id;
  update public.imp_solicitudes set estado='EN_TRANSITO', iniciada_at=coalesce(iniciada_at,now())
   where id = s.id and estado in ('PENDIENTE','EN_PREPARACION');

  return jsonb_build_object('ok',true,'item',i.id,'unidades',i.unidades,'destino',s.destino);
end $$;

-- ── 7. Recibir un renglón suelto (sin QR) ────────────────────
create or replace function public.imp_infra_recibir(p_item bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i record; s record; v_tipo text;
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
  v_tipo := public.imp_dep_tipo(s.destino);

  perform public.imp_stock_add(i.articulo_id, s.destino, i.unidades);
  insert into public.imp_movimientos(articulo_id,tipo,origen,destino,deposito,unidades,usuario,nota)
    values (i.articulo_id,'ENTRADA',s.origen,s.destino,s.destino,i.unidades,p_user,
            'Infraestructura · pedido #'||s.id||' · sin pallet');

  -- En una fábrica la mercadería se consume al llegar, igual que un pallet
  if v_tipo = 'FABRICA' then
    perform public.imp_stock_add(i.articulo_id, s.destino, -i.unidades);
    insert into public.imp_movimientos(articulo_id,tipo,deposito,unidades,usuario,nota)
      values (i.articulo_id,'CONSUMO',s.destino,i.unidades,p_user,
              'Infraestructura · pedido #'||s.id||' · sin pallet');
  end if;

  update public.imp_solicitud_items
     set estado='ENTREGADO', recibido_at=now(), recibido_by=p_user
   where id = i.id;

  -- Cerrar el pedido si ya no queda nada en camino. Lo mismo que hace
  -- trg_imp_sol_sync con los pallets, pero por este otro camino: el
  -- trigger no se entera de los sueltos porque busca por pallet_id.
  if not exists(select 1 from public.imp_solicitud_items
                 where solicitud_id = s.id and estado in ('PEDIDO','ENVIADO')) then
    update public.imp_solicitudes set estado='ENTREGADA', entregada_at=now()
     where id = s.id and estado <> 'ENTREGADA';
  end if;

  return jsonb_build_object('ok',true,'item',i.id,'unidades',i.unidades,
                            'destino',s.destino,'destino_tipo',v_tipo);
end $$;

-- ── 8. Cancelar: contemplar los sueltos ──────────────────────
--  El chequeo viejo hacía join con imp_pallets, así que un renglón
--  suelto ya despachado se le escapaba y el pedido se cancelaba con
--  la mercadería viajando.
create or replace function public.imp_solicitud_cancelar(p_sol bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not (public.has_module('solicitante') or public.has_module('importacion')) then
    raise exception 'Sin permiso';
  end if;
  select * into s from public.imp_solicitudes where id = p_sol;
  if not found then return jsonb_build_object('ok',false,'error','Solicitud inexistente'); end if;
  if s.estado in ('ENTREGADA','CANCELADA') then
    return jsonb_build_object('ok',false,'error','La solicitud ya está '||s.estado);
  end if;
  if exists(select 1 from public.imp_solicitud_items i
             join public.imp_pallets p on p.id=i.pallet_id
            where i.solicitud_id=p_sol and p.estado='EN_TRANSITO') then
    return jsonb_build_object('ok',false,
      'error','Hay pallets ya despachados: no se puede cancelar, hay que recibirlos');
  end if;
  if exists(select 1 from public.imp_solicitud_items i
            where i.solicitud_id=p_sol and i.pallet_id is null and i.estado='ENVIADO') then
    return jsonb_build_object('ok',false,
      'error','Ya despacharon parte de este pedido: no se puede cancelar, hay que recibirlo');
  end if;

  update public.imp_pallets p set destino = null
    from public.imp_solicitud_items i
   where i.solicitud_id=p_sol and p.id=i.pallet_id and p.estado='ESTACIONADO';

  update public.imp_solicitud_items set estado='CANCELADO'
   where solicitud_id=p_sol and estado in ('PEDIDO','ENVIADO');
  update public.imp_solicitudes
     set estado='CANCELADA', cerrada_by=p_user, entregada_at=now()
   where id=p_sol;

  return jsonb_build_object('ok',true,'solicitud',p_sol);
end $$;

-- ── 9. Lo que el operario tiene que juntar ───────────────────
--  Una vista para la bandeja: los renglones sueltos vivos, con dónde
--  está la mercadería y en qué paso va cada uno.
create or replace view public.imp_infra_pendientes
with (security_invoker = true) as
select i.id            as item_id,
       i.solicitud_id,
       s.origen, s.destino, s.solicitante, s.pedido_por, s.estado as sol_estado,
       i.estado, i.unidades,
       i.despachado_at, i.despachado_by, i.recibido_at, i.recibido_by,
       a.id            as articulo_id,
       a.descripcion   as articulo,
       a.codigo        as art_codigo,
       coalesce(st.cantidad,0) as stock_origen,
       s.created_at
  from public.imp_solicitud_items i
  join public.imp_solicitudes s on s.id = i.solicitud_id
  join public.imp_articulos   a on a.id = i.articulo_id
  left join public.imp_stock st on st.articulo_id = i.articulo_id and st.deposito = s.origen
 where i.pallet_id is null and i.estado in ('PEDIDO','ENVIADO');

grant select on public.imp_infra_pendientes to authenticated;

grant execute on function public.imp_infra_pedir(text,text,jsonb,text,text,text) to authenticated;
grant execute on function public.imp_infra_despachar(bigint,text) to authenticated;
grant execute on function public.imp_infra_recibir(bigint,text)   to authenticated;

-- ── 10. Control ─────────────────────────────────────────────
select column_name, is_nullable
  from information_schema.columns
 where table_name='imp_solicitud_items'
   and column_name in ('pallet_id','articulo_id','unidades','despachado_by','recibido_by')
 order by column_name;
-- Esperado: pallet_id YES · articulo_id YES · unidades YES · los dos _by YES

select tipo, count(*) from public.imp_articulos group by tipo order by tipo;
-- Esperado: Consumo 14 · Infraestructura 3 · Venta 33 · Venta Piscina 69

select public.imp_puede_pedir_tipo('Consumo')        as consumo_todos,
       public.imp_puede_pedir_tipo('Infraestructura') as infra_solo_admin;
-- Desde el SQL Editor auth.uid() es NULL, así que is_admin() da false:
-- lo esperado acá es  true · false.  El permiso real se prueba desde la app.

select id, estado, items, sueltos, unidades from public.imp_solicitud_resumen
 order by created_at desc limit 5;
-- Esperado: los pedidos de siempre, con sueltos = 0 y las mismas unidades
