-- ============================================================
--  RECEPCIÓN MANUAL 24/11/2026 · Pedido #69 (Furriol → Artigas)
--  Los dos pallets llegaron a Artigas pero nadie los escaneó: ni la
--  salida de Furriol ni la llegada. Siguen ESTACIONADOS en Furriol.
--
--  Leído de la base antes de escribir esto:
--    pallet 31 PLT-MSGD313S-33BE · art. 133 · 220106 Gatillo Mini
--          Trigger rosca 24 · 10.000 u. · Estantería 1 · C3
--    pallet 88 PLT-MVJY20FJ-6444 · art. 246 · 220202 Botella PET
--          60 ml con spray Blanco · 9.240 u. · Estantería 9
--    Stock Furriol: art. 133 = 31.000 · art. 246 = 9.240
--    Pedido 69 EN_PREPARACION, items 78 y 79 PEDIDO.
--
--  Qué hace, por pallet, lo mismo que imp_pallet_scan dos veces:
--    1. SALIDA −u. en Furriol → EN_TRANSITO
--    2. ENTRADA +u. y CONSUMO −u. en Artigas → CONSUMIDO ("Recibido")
--  El trigger trg_imp_sol_sync pasa los items a ENTREGADO y el pedido
--  a ENTREGADA solo.
--
--  Aborta TODO sin tocar nada si alguno no está ESTACIONADO en Furriol
--  con destino Artigas. Si ya estaba recibido, lo saltea.
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  p record;
  v_user text := 'alechiesa.subatir';
  v_nota text := 'Pedido #69: salida y llegada cargadas por SQL 24/11/2026 (no se escaneó)';
  v_ids  bigint[] := array[31, 88];
  v_cods text[]   := array['PLT-MSGD313S-33BE', 'PLT-MVJY20FJ-6444'];
  i int;
begin
  -- Primero validar los dos; recién después tocar
  for i in 1..2 loop
    select * into p from public.imp_pallets where id = v_ids[i] and codigo = v_cods[i];
    if not found then
      raise exception 'No encuentro el pallet % %. No se toca nada.', v_ids[i], v_cods[i];
    end if;
    if p.estado <> 'CONSUMIDO'
       and (p.estado <> 'ESTACIONADO' or p.deposito is distinct from 'Furriol'
            or p.destino is distinct from 'Artigas') then
      raise exception 'El pallet % está % en % con destino % (esperaba ESTACIONADO en Furriol → Artigas). No se toca nada.',
        p.id, p.estado, p.deposito, p.destino;
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

    -- 1. Salida de Furriol (como el primer escaneo)
    perform public.imp_stock_add(p.articulo_id, p.deposito, -p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,ubicacion_de,nota)
      values (p.id,p.articulo_id,'SALIDA',p.deposito,p.destino,p.deposito,p.unidades,v_user,
              public.imp_ubic_txt2(p.estanteria_id,p.fila,p.columna,p.zona_id),v_nota);
    update public.imp_pallets
       set estado='EN_TRANSITO', origen=p.deposito, deposito=null,
           ult_estanteria_id = coalesce(p.estanteria_id, ult_estanteria_id),
           ult_fila          = coalesce(p.fila,          ult_fila),
           ult_columna       = coalesce(p.columna,       ult_columna),
           estanteria_id=null, fila=null, columna=null,
           salida_at=now(), salida_by=v_user
     where id=p.id;

    -- 2. Llegada a Artigas (fábrica: entra y se consume)
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,nota)
      values (p.id,p.articulo_id,'ENTRADA',p.deposito,p.destino,p.destino,p.unidades,v_user,v_nota);
    perform public.imp_stock_add(p.articulo_id, p.destino, -p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,nota)
      values (p.id,p.articulo_id,'CONSUMO',p.destino,p.unidades,v_user,v_nota);
    update public.imp_pallets
       set estado='CONSUMIDO', deposito=p.destino, subdeposito_id=null,
           llegada_at=now(), llegada_by=v_user,
           consumido_at=now(), consumido_by=v_user
     where id=p.id;

    raise notice 'Pallet % salió de Furriol y se recibió en Artigas (% u.).', p.id, p.unidades;
  end loop;
end $$;

-- ── Verificación ─────────────────────────────────────────────
-- Esperado: pedido 69 ENTREGADA · items ENTREGADO · pallets 31 y 88
-- CONSUMIDO en Artigas · Furriol art. 133 = 21.000, art. 246 = 0 ·
-- Artigas en 0 los dos
select 'pedido '||s.id as que, s.estado as detalle, i.estado as item, p.estado as pallet, p.deposito
  from public.imp_solicitudes s
  join public.imp_solicitud_items i on i.solicitud_id = s.id
  join public.imp_pallets p on p.id = i.pallet_id
 where s.id = 69
union all
select 'stock art. '||articulo_id, deposito, cantidad::text, null, null
  from public.imp_stock where articulo_id in (133, 246)
 order by 1, 2;
