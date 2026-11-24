-- ============================================================
--  RECEPCIÓN MANUAL 16/11/2026 · Pedidos #68 y #70 (Furriol → Artigas)
--
--  Leído de la base antes de escribir esto:
--    #68 · pallet 47 PLT-MSHILCZS-664F · art. 121 · 220034 Botella PET
--          x 250 ml con Gatillo Mini trigger · 4.320 u.
--          SALIDA mov 417, 11/11 13:37, Cristian montes de oca
--    #70 · pallet 84 PLT-MVJW9H4B-90BF · art. 134 · 220105 Gatillo
--          Pulverizador Común rosca 28 · 9.000 u.
--          SALIDA mov 421, 12/11 11:52, Cristian montes de oca
--  Los dos siguen EN_TRANSITO; Furriol ya se descontó en la salida
--  (stock Artigas 0 en ambos artículos).
--
--  Qué hace, por pallet: lo mismo que imp_pallet_scan cuando un
--  pallet EN_TRANSITO llega a una FABRICA:
--    1. ENTRADA +u. en Artigas
--    2. CONSUMO −u. en Artigas (la fábrica consume al llegar)
--    3. Pallet → CONSUMIDO ("Recibido" en la interfaz)
--  El trigger trg_imp_sol_sync pasa el item a ENTREGADO y el pedido
--  a ENTREGADA solo.
--
--  Aborta TODO sin tocar nada si alguno ya no está EN_TRANSITO a
--  Artigas. Si ya estaba recibido, lo saltea.
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  p record;
  v_user text := 'alechiesa.subatir';
  v_nota text := 'Recepción cargada por SQL 16/11/2026 (recorrido sin cerrar desde la app)';
  v_ids  bigint[] := array[47, 84];
  v_cods text[]   := array['PLT-MSHILCZS-664F', 'PLT-MVJW9H4B-90BF'];
  i int;
begin
  -- Primero validar los dos; recién después tocar
  for i in 1..2 loop
    select * into p from public.imp_pallets where id = v_ids[i] and codigo = v_cods[i];
    if not found then
      raise exception 'No encuentro el pallet % %. No se toca nada.', v_ids[i], v_cods[i];
    end if;
    if p.estado <> 'CONSUMIDO'
       and (p.estado <> 'EN_TRANSITO' or p.destino is distinct from 'Artigas') then
      raise exception 'El pallet % está % con destino % (esperaba EN_TRANSITO a Artigas). No se toca nada.',
        p.id, p.estado, p.destino;
    end if;
  end loop;
  if public.imp_dep_tipo('Artigas') <> 'FABRICA' then
    raise exception 'Artigas ya no es FABRICA: recibirlos desde la app, que los ubica en estantería.';
  end if;

  for i in 1..2 loop
    select * into p from public.imp_pallets where id = v_ids[i];
    if p.estado = 'CONSUMIDO' then
      raise notice 'Pallet % ya estaba recibido (%): se saltea.', p.id, p.llegada_at;
      continue;
    end if;

    -- 1. Entrada
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,nota)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,v_user,v_nota);

    -- 2. Consumo en fábrica
    perform public.imp_stock_add(p.articulo_id, p.destino, -p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,nota)
      values (p.id,p.articulo_id,'CONSUMO',p.destino,p.unidades,v_user,v_nota);

    -- 3. Fin del recorrido (dispara el cierre del pedido)
    update public.imp_pallets
       set estado='CONSUMIDO', deposito=p.destino,
           estanteria_id=null, fila=null, columna=null, subdeposito_id=null,
           llegada_at=now(), llegada_by=v_user,
           consumido_at=now(), consumido_by=v_user
     where id=p.id;

    raise notice 'Pallet % recibido en Artigas (% u.).', p.id, p.unidades;
  end loop;
end $$;

-- ── Verificación ─────────────────────────────────────────────
-- Esperado: pedidos 68 y 70 ENTREGADA · items ENTREGADO · pallets
-- 47 y 84 CONSUMIDO en Artigas · stock Artigas de 121 y 134 en 0
select 'pedido '||s.id as que, s.estado as detalle, i.estado as item, p.estado as pallet, p.deposito
  from public.imp_solicitudes s
  join public.imp_solicitud_items i on i.solicitud_id = s.id
  join public.imp_pallets p on p.id = i.pallet_id
 where s.id in (68, 70)
union all
select 'stock art. '||articulo_id, deposito, cantidad::text, null, null
  from public.imp_stock where articulo_id in (121, 134)
 order by 1, 2;
