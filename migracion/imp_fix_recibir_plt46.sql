-- ============================================================
--  RECEPCIÓN MANUAL 07/10/2026 · Pallet 46 PLT-MSGKH5ON-6332
--  Art. 121 · 220034 Botella PET x 250 ml con Gatillo Mini trigger
--  8 cajas × 360 = 2.880 u.
--
--  Qué pasó (leído de la base):
--    · SALIDA mov 317: Furriol → Artigas, 07/10 13:59, alechiesa.subatir
--    · El pallet llegó a Artigas y se recibió, pero el escaneo no
--      lo deja cerrar porque lo despachó la misma persona.
--
--  Qué hace: exactamente lo que hace imp_pallet_scan con un pallet
--  EN_TRANSITO que llega a una FABRICA:
--    1. ENTRADA +2.880 en Artigas
--    2. CONSUMO −2.880 en Artigas (la fábrica consume al llegar)
--    3. Pallet → CONSUMIDO ("Recibido" en la interfaz), fin de
--       la trazabilidad.
--  El stock de Artigas queda igual (+2.880 −2.880); Furriol ya se
--  descontó en la salida.
--
--  Aborta sin tocar nada si el pallet ya no está EN_TRANSITO a Artigas.
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  p record;
  v_user text := 'alechiesa.subatir';
  v_nota text := 'Recepción cargada por SQL 07/10/2026: el pallet lo despachó la misma persona';
begin
  select * into p from public.imp_pallets
   where id = 46 and codigo = 'PLT-MSGKH5ON-6332' and articulo_id = 121;

  if not found then
    raise exception 'No encuentro el pallet 46 PLT-MSGKH5ON-6332. No se toca nada.';
  end if;
  if p.estado = 'CONSUMIDO' then
    raise notice 'Ya estaba recibido (%): no se hace nada.', p.llegada_at;
    return;
  end if;
  if p.estado <> 'EN_TRANSITO' or p.destino is distinct from 'Artigas' then
    raise exception 'El pallet está % con destino % (esperaba EN_TRANSITO a Artigas). No se toca nada.',
      p.estado, p.destino;
  end if;
  if public.imp_dep_tipo(p.destino) <> 'FABRICA' then
    raise exception 'Artigas ya no es FABRICA: recibirlo desde la app, que lo ubica en estantería.';
  end if;

  -- 1. Entrada
  perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,nota)
    values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,v_user,v_nota);

  -- 2. Consumo en fábrica
  perform public.imp_stock_add(p.articulo_id, p.destino, -p.unidades);
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,nota)
    values (p.id,p.articulo_id,'CONSUMO',p.destino,p.unidades,v_user,v_nota);

  -- 3. Fin del recorrido
  update public.imp_pallets
     set estado='CONSUMIDO', deposito=p.destino,
         estanteria_id=null, fila=null, columna=null, subdeposito_id=null,
         llegada_at=now(), llegada_by=v_user,
         consumido_at=now(), consumido_by=v_user
   where id=p.id;

  raise notice 'Listo: pallet 46 recibido en Artigas (% u.).', p.unidades;
end $$;

-- ── Verificación ─────────────────────────────────────────────
select 'pallet' as que, estado as detalle, deposito as donde, llegada_at::text as cuando
  from public.imp_pallets where id = 46
union all
select 'mov '||id, tipo, deposito, unidades::text
  from public.imp_movimientos where pallet_id = 46 and id >= 317
union all
select 'stock', 'art. 121', deposito, cantidad::text
  from public.imp_stock where articulo_id = 121;
