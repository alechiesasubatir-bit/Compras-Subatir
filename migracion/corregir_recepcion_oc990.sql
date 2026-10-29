-- ============================================================
--  OC 990 - Green Oil S.A. (28/09/2026)
--  Botella C/ Serigrafia A. Eucaliptado PET 1L: se pidieron 6.496,
--  llegaron 1.624 (1 pallet). Quedan 4.872 pendientes.
--
--  QUE PASO (reconstruido de la base, 29/10/2026)
--    · Linea #789, 6.496 Unid., ficha de inventario #23 (cod. 220171).
--    · Hoy 17:40 VALENTINA GONZALEZ registro la entrega #387 por las
--      6.496: el trigger marco la linea COMPLETA (f_recepcion 29/10) y
--      inventario_sumar le sumo 6.496 a la ficha 23, que paso de
--      3.248 a 9.744.
--
--  QUE HACE ESTE ARCHIVO
--    1) Corrige la entrega #387 a 1.624. El trigger trg_entregas_sync
--       corre tambien en UPDATE: ve 1.624 < 6.496 y pone
--       f_recepcion = NULL -> la linea vuelve a PARCIAL, saldo 4.872.
--    2) Baja el stock de la ficha 23 de 9.744 a 3.248 + 1.624 = 4.872.
--
--  ANTES DE CORRER: en Stock la botella tiene que decir 9.744. Si dice
--  otra cosa, PARAR: el guard del UPDATE no va a aplicar.
--
--  Idempotente: los dos UPDATE tienen guarda sobre el valor actual.
--  Correr en Supabase -> SQL Editor.
-- ============================================================

begin;

-- ── 1 · La entrega real: 1.624 de 6.496 ─────────────────────────────
update public.entregas
   set cantidad = 1624,
       observaciones = 'Entrega parcial: llegaron 1.624 de 6.496 (1 pallet), quedan 4.872 pendientes. '
                    || 'Corregida por SQL el 29/10/2026: se habia registrado por las 6.496.'
 where id = 387
   and pedido_id = 789
   and cantidad = 6496;

-- ── 2 · Stock ficha 23 · habian entrado 6.496, llegaron 1.624 ──────
--  9.744 - 4.872 = 4.872. UPDATE directo y no inventario_sumar():
--  en el SQL Editor auth.uid() es NULO y la funcion no haria nada.
update public.inventario
   set inventario = 4872
 where id = 23
   and inventario = 9744;

commit;

-- ── Verificacion ───────────────────────────────────────────────────
select 'pedido' as que, p.id::text as id, p.descripcion,
       p.cantidad::text as pedida,
       coalesce((select sum(e.cantidad) from public.entregas e where e.pedido_id = p.id), 0)::text as recibida,
       coalesce(p.f_recepcion::text, '(parcial / pendiente)') as f_recepcion
  from public.pedidos p
 where p.id = 789
union all
select 'stock', i.id::text, i.descripcion, i.unidad,
       i.inventario::text, '-'
  from public.inventario i
 where i.id = 23;

-- Esperado:
--   pedido 789 -> pedida 6496, recibida 1624, f_recepcion (parcial / pendiente)
--   stock  23  -> inventario 4872
