-- ============================================================
--  08/10/2026 · Dos cosas en una sola transacción
--
--  A. RESTAURAR EL PEDIDO #47 tal como estaba
--     imp_deshacer_traslado_47.sql se corrió por error: el que había
--     que anular era el #49. Esto vuelve a poner el traslado del #47
--     exacto, con los MISMOS ids, horas y usuarios que tenía (leídos
--     de la base antes de borrarlo):
--       #317 SALIDA   Furriol→Artigas  07/10 16:59:41 UTC  alechiesa.subatir
--                     (desde "Estantería 4 · D4")
--       #318 ENTRADA  Artigas          07/10 17:34:09 UTC  (nota del SQL de recepción)
--       #319 CONSUMO  Artigas          07/10 17:34:09 UTC  (ídem)
--     Pallet 46 PLT-MSGKH5ON-6332 → CONSUMIDO en Artigas
--     Pedido #47 → ENTREGADA, operario "Ana nante", item ENTREGADO
--     Stock art. 121: Furriol 46.760 → 43.880 · Artigas queda 0
--
--  B. ANULAR EL PEDIDO #49 (lo hizo alechiesa.subatir hoy 14:53)
--     Pallet 47 PLT-MSHILCZS-664F · 4.320 u. del mismo art. 121.
--     Está EN_PREPARACION y el pallet nunca se escaneó: sigue
--     ESTACIONADO en Estantería 4 (fila 1, col 6). No hay movimientos
--     ni stock que deshacer, sólo la reserva. Se cancela igual que el
--     botón "Cancelar pedido" de Solicitar (imp_solicitud_cancelar):
--     pallet.destino → null, item CANCELADO, pedido CANCELADA.
--
--  Si algo no está como se espera, aborta y no toca nada.
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

begin;

do $$
declare
  p46 record; p47 record; s47 record; s49 record;
begin
  -- ── Guardas ────────────────────────────────────────────────
  select * into p46 from public.imp_pallets where id = 46 and codigo = 'PLT-MSGKH5ON-6332';
  select * into s47 from public.imp_solicitudes where id = 47;
  select * into p47 from public.imp_pallets where id = 47 and codigo = 'PLT-MSHILCZS-664F';
  select * into s49 from public.imp_solicitudes where id = 49;

  if p46.estado = 'CONSUMIDO' and s49.estado = 'CANCELADA' then
    raise notice 'Ya estaba aplicado: no se hace nada.'; return;
  end if;
  if p46.estado is distinct from 'ESTACIONADO' or p46.deposito <> 'Furriol' then
    raise exception 'El pallet 46 está % en % (esperaba ESTACIONADO en Furriol). No se toca nada.', p46.estado, p46.deposito;
  end if;
  if s47.estado is distinct from 'PENDIENTE' then
    raise exception 'El pedido #47 está % (esperaba PENDIENTE). No se toca nada.', s47.estado;
  end if;
  if exists(select 1 from public.imp_movimientos where id in (317,318,319)) then
    raise exception 'Ya existen movimientos 317–319. No se toca nada.';
  end if;
  if s49.estado is distinct from 'EN_PREPARACION' then
    raise exception 'El pedido #49 está % (esperaba EN_PREPARACION). No se toca nada.', s49.estado;
  end if;
  if p47.estado is distinct from 'ESTACIONADO' then
    raise exception 'El pallet 47 está % (esperaba ESTACIONADO): si ya salió, se recibe, no se cancela.', p47.estado;
  end if;

  -- ══ A. Restaurar #47 ════════════════════════════════════════
  -- Stock, con el mismo signo que aplicó cada movimiento original
  perform public.imp_stock_add(121, 'Furriol', -2880);   -- SALIDA
  perform public.imp_stock_add(121, 'Artigas',  2880);   -- ENTRADA
  perform public.imp_stock_add(121, 'Artigas', -2880);   -- CONSUMO

  insert into public.imp_movimientos
    (id, pallet_id, articulo_id, tipo, origen, destino, deposito, unidades, usuario, created_at, ubicacion_de, nota)
  overriding system value values
    (317, 46, 121, 'SALIDA',  'Furriol', 'Artigas', 'Furriol', 2880, 'alechiesa.subatir',
     '2026-10-07 16:59:41.126298+00', 'Estantería 4 · D4', null),
    (318, 46, 121, 'ENTRADA', 'Furriol', 'Artigas', 'Artigas', 2880, 'alechiesa.subatir',
     '2026-10-07 17:34:09.937714+00', null,
     'Recepción cargada por SQL 07/10/2026: el pallet lo despachó la misma persona'),
    (319, 46, 121, 'CONSUMO', null, null, 'Artigas', 2880, 'alechiesa.subatir',
     '2026-10-07 17:34:09.937714+00', null,
     'Recepción cargada por SQL 07/10/2026: el pallet lo despachó la misma persona');

  -- El pedido primero: así el trigger imp_sol_sync no encuentra items
  -- PEDIDO/ENVIADO cuando cambia el estado del pallet y no toca nada
  update public.imp_solicitud_items set estado = 'ENTREGADO'
   where solicitud_id = 47 and pallet_id = 46;
  update public.imp_solicitudes
     set estado = 'ENTREGADA', operario = 'Ana nante',
         iniciada_at  = '2026-10-07 16:21:53.795692+00',
         entregada_at = '2026-10-07 17:34:09.937714+00'
   where id = 47;

  update public.imp_pallets
     set estado = 'CONSUMIDO', deposito = 'Artigas', destino = 'Artigas',
         estanteria_id = null, fila = null, columna = null, subdeposito_id = null,
         ult_estanteria_id = 3, ult_fila = 1, ult_columna = 4,
         salida_at    = '2026-10-07 16:59:41.126298+00', salida_by = 'alechiesa.subatir',
         salida_uid   = '2583725e-d188-421d-ac3a-678a4f42bff9',
         llegada_at   = '2026-10-07 17:34:09.937714+00', llegada_by = 'alechiesa.subatir',
         llegada_uid  = null,
         consumido_at = '2026-10-07 17:34:09.937714+00', consumido_by = 'alechiesa.subatir'
   where id = 46;

  -- ══ B. Anular #49 ═══════════════════════════════════════════
  update public.imp_pallets p
     set destino = null
    from public.imp_solicitud_items i
   where i.solicitud_id = 49 and p.id = i.pallet_id and p.estado = 'ESTACIONADO';

  update public.imp_solicitud_items set estado = 'CANCELADO'
   where solicitud_id = 49 and estado in ('PEDIDO','ENVIADO');

  update public.imp_solicitudes
     set estado = 'CANCELADA', cerrada_by = 'alechiesa.subatir', entregada_at = now()
   where id = 49;

  raise notice 'Listo: #47 restaurado (ENTREGADA, pallet 46 CONSUMIDO) y #49 CANCELADA (pallet 47 libre en Furriol).';
end $$;

commit;

-- ── Comprobar ────────────────────────────────────────────────
--  Esperado:
--    pedido #47 ENTREGADA · item ENTREGADO · pallet 46 CONSUMIDO en Artigas
--    movs pallet 46: 87 ARMADO, 317 SALIDA, 318 ENTRADA, 319 CONSUMO
--    stock art. 121: Furriol 43.880 · Artigas 0
--    pedido #49 CANCELADA · item CANCELADO · pallet 47 ESTACIONADO, destino —
select 'pedido #'||id as que, estado as detalle, operario as extra
  from public.imp_solicitudes where id in (47,49)
union all
select 'item #'||solicitud_id, estado, 'pallet '||pallet_id
  from public.imp_solicitud_items where solicitud_id in (47,49)
union all
select 'pallet '||id, estado, deposito||' · destino '||coalesce(destino,'—')
  from public.imp_pallets where id in (46,47)
union all
select 'mov '||id, tipo, deposito
  from public.imp_movimientos where pallet_id = 46
union all
select 'stock', deposito, cantidad::text
  from public.imp_stock where articulo_id = 121;
