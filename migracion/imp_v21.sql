-- ============================================================
--  imp_v21 · El pallet recuerda su última ranura
--
--  Cuando un pallet sale del depósito se le borra la ranura, y al
--  volver no hay forma de saber dónde estaba: hay que buscarlo a
--  ojo en el mapa. Ya pasó dos veces al deshacer traslados de
--  prueba — el dato simplemente no existía en ningún lado.
--
--  Ahora la posición se guarda ANTES de borrarla, en tres campos
--  del propio pallet, y la pantalla la usa para sugerir "volvé a
--  dejarlo donde estaba". Es una SUGERENCIA: si la ranura se
--  ocupó mientras el pallet estaba de viaje, se avisa y se elige
--  otra.
--
--  Se guarda en tres momentos:
--    · al SALIR del depósito (imp_pallet_scan)
--    · al llegar a una FÁBRICA y consumirse (por si se deshace)
--    · al sacarlo de una ranura a mano (imp_pallet_ubicar con null)
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Dónde estaba ──────────────────────────────────────────
alter table public.imp_pallets
  add column if not exists ult_estanteria_id bigint,
  add column if not exists ult_fila          int,
  add column if not exists ult_columna       int;

do $$ begin
  alter table public.imp_pallets add constraint imp_pallets_ult_est_fk
    foreign key (ult_estanteria_id) references public.imp_estanterias(id) on delete set null;
exception when duplicate_object then null; when others then null; end $$;

comment on column public.imp_pallets.ult_estanteria_id is 'Última ranura ocupada, para sugerirla al volver';

--  Los que hoy están en una ranura ya saben dónde están: se copia,
--  así el dato sirve desde el primer día y no sólo para los que
--  salgan de acá en adelante.
update public.imp_pallets
   set ult_estanteria_id = estanteria_id, ult_fila = fila, ult_columna = columna
 where estanteria_id is not null and ult_estanteria_id is null;

-- ── 2. Guardarla al salir y al consumirse ────────────────────
--  Se reescribe imp_pallet_scan agregando el "recordá dónde estaba"
--  justo antes de cada borrado de ranura. El resto queda igual que
--  en imp_v19: permisos, quién despacha, quién recibe, fábrica.
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_tipo text; v_uid uuid := auth.uid(); v_quien text;
begin
  select * into p from public.imp_pallets where codigo = p_codigo;
  if not found then
    return jsonb_build_object('ok',false,'error','Ese QR no corresponde a ningún pallet');
  end if;

  if p.estado in ('ESTACIONADO','RECIBIDO') then
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
           -- v21: de dónde salió, para sugerirlo cuando vuelva
           ult_estanteria_id = coalesce(p.estanteria_id, ult_estanteria_id),
           ult_fila          = coalesce(p.fila,          ult_fila),
           ult_columna       = coalesce(p.columna,       ult_columna),
           estanteria_id=null, fila=null, columna=null,
           salida_at=now(), salida_by=p_user, salida_uid=v_uid
     where id=p.id;
    return jsonb_build_object('ok',true,'estado','EN_TRANSITO','accion','salida','pallet',p.codigo,
                              'origen',p.deposito,'destino',p.destino,
                              'destino_tipo',public.imp_dep_tipo(p.destino));

  elsif p.estado = 'EN_TRANSITO' then
    if not public.imp_puede_recibir() then raise exception 'Sin permiso'; end if;

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
      perform public.imp_stock_add(p.articulo_id, p.destino, -p.unidades);
      insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario)
        values (p.id,p.articulo_id,'CONSUMO',p.destino,p.unidades,p_user);
      update public.imp_pallets
         set estado='CONSUMIDO', deposito=p.destino,
             ult_estanteria_id = coalesce(p.estanteria_id, ult_estanteria_id),
             ult_fila          = coalesce(p.fila,          ult_fila),
             ult_columna       = coalesce(p.columna,       ult_columna),
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
    return jsonb_build_object('ok',false,'estado',p.estado,
      'error','Ese pallet ya se consumió en '||coalesce(p.deposito,'la fábrica'));
  else
    return jsonb_build_object('ok',false,'estado',p.estado,
      'error','El pallet está en estado '||p.estado||' y no se puede escanear');
  end if;
end $$;

-- ── 3. Guardarla al sacarlo de la ranura a mano ──────────────
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
       set estanteria_id = p_est, fila = p_fila, columna = p_col, deposito = v_dep,
           -- Donde queda ahora es también "la última" para la próxima vuelta
           ult_estanteria_id = p_est, ult_fila = p_fila, ult_columna = p_col
     where id = p_pallet;
    v_a := public.imp_ubic_txt(p_est, p_fila, p_col);
  else
    update public.imp_pallets
       set ult_estanteria_id = coalesce(estanteria_id, ult_estanteria_id),
           ult_fila          = coalesce(fila,          ult_fila),
           ult_columna       = coalesce(columna,       ult_columna),
           estanteria_id = null, fila = null, columna = null
     where id = p_pallet;
    v_a := null;
  end if;

  -- Sin movimiento si no cambió nada
  if v_de is distinct from v_a then
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,ubicacion_de,ubicacion_a)
      values (p_pallet,p.articulo_id,'UBICACION',coalesce(v_dep,p.deposito),p.unidades,p_user,v_de,v_a);
  end if;

  return jsonb_build_object('ok',true,'de',v_de,'a',v_a);
end $$;

-- ── 4. ¿La ranura sugerida sigue libre? ──────────────────────
--  Una vista chica para que la pantalla no tenga que razonarlo:
--  devuelve la última ranura de cada pallet y si está ocupada.
create or replace view public.imp_pallet_ult_ranura
with (security_invoker = true) as
select p.id                                as pallet_id,
       p.ult_estanteria_id,
       p.ult_fila,
       p.ult_columna,
       e.nombre                            as estanteria,
       e.deposito,
       public.imp_ubic_txt(p.ult_estanteria_id, p.ult_fila, p.ult_columna) as ubicacion,
       exists (select 1 from public.imp_pallets o
                where o.estanteria_id = p.ult_estanteria_id
                  and o.fila = p.ult_fila and o.columna = p.ult_columna
                  and o.id <> p.id)        as ocupada
  from public.imp_pallets p
  join public.imp_estanterias e on e.id = p.ult_estanteria_id
 where p.ult_estanteria_id is not null;

grant select on public.imp_pallet_ult_ranura to authenticated;

-- ── 5. Comprobar ─────────────────────────────────────────────
select pallet_id, estanteria, ubicacion, deposito, ocupada
  from public.imp_pallet_ult_ranura
 order by pallet_id
 limit 10;
