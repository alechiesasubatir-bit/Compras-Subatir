-- ============================================================
--  OC 927 — Lipiner S.A. (21/08/2026)
--  Corrige las cantidades REALMENTE recibidas y ajusta el stock.
--
--  Estado antes de correr esto:
--    · Linea #666 "Etiq. Medianas largo (232247)" — pedidas 50.000.
--      Entrega E109 del 27/08 por 50.000 → ya sumo 50.000 a la ficha 85
--      (inventario quedo en 55.000). Pero llegaron 90.000.
--    · Linea #667 "Etiqueta GRANDE NUEVA (232238)" — pedidas 20.000.
--      Marcada f_recepcion = 27/08 pero SIN entrega y SIN sumar al stock
--      (ficha 88 sigue en 7.500, con pendiente_entrega = 20.000).
--      Llegaron 10.000: es una entrega PARCIAL, no una linea completa.
--
--  Por que va por SQL y no por la pantalla: borrar una entrega desde
--  Pedidos/Recepcion NO descuenta el inventario (delEntrega solo borra la
--  fila; la suma la hizo inventario_sumar y no se revierte). Borrar y
--  volver a registrar duplicaria las etiquetas medianas en el stock.
--
--  Idempotente: los UPDATE de inventario van con guarda sobre el valor
--  actual y el INSERT de la entrega con NOT EXISTS, asi correrlo dos
--  veces no suma de mas.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

begin;

-- ── 1 · Linea #666 · Medianas: la entrega era 50.000, fueron 90.000 ──
--  El trigger trg_entregas_sync recalcula pedidos.f_recepcion solo. Con
--  90.000 >= 50.000 la linea sigue COMPLETA y conserva el 27/08.
update public.entregas
   set cantidad      = 90000,
       observaciones = coalesce(observaciones || ' | ', '')
                       || 'Corregido 31/08/2026: llegaron 90.000 (se habian registrado 50.000).'
 where id = 109
   and pedido_id = 666
   and cantidad <> 90000;

-- Stock ficha 85: 55.000 + 40.000 de diferencia = 95.000
update public.inventario
   set inventario = 95000
 where id = 85
   and inventario = 55000;

-- ── 2 · Linea #667 · Grandes: no habia entrega, llegaron 10.000 ────
--  Fecha 27/08 = la que tenia la linea marcada como recibida.
--  Al insertarla, el trigger pone f_recepcion = NULL en el pedido #667
--  (10.000 < 20.000), y la linea pasa a PARCIAL con saldo 10.000.
insert into public.entregas
       (pedido_id, n_orden, descripcion, cantidad, fecha, coa, conforme, recibido_por, observaciones)
select 667, '927', p.descripcion, 10000, date '2026-08-27', 'NO APLICA', 'SI', 'VALENTINA GONZALEZ',
       'Entrega parcial: llegaron 10.000 de 20.000 pedidas. Cargada 31/08/2026 (la linea estaba marcada recibida sin entrega y sin sumar al stock).'
  from public.pedidos p
 where p.id = 667
   and not exists (select 1 from public.entregas e where e.pedido_id = 667);

-- Stock ficha 88: 7.500 + 10.000 = 17.500, y queda pendiente el saldo
update public.inventario
   set inventario = 17500,
       pendiente_entrega = 10000
 where id = 88
   and inventario = 7500;

-- ── 3 · OPCIONAL · datos COMERCIALES de la OC ──────────────────────
--  Lo de arriba corrige lo que LLEGO. La OC sigue diciendo 50.000 y
--  20.000, que es lo que se PIDIO, con sus importes originales.
--  Descomentar SOLO si el proveedor factura las cantidades reales:
--
--    · #666: 90.000 x U$S 0,02  = 1.800 s/IVA → 2.196 c/IVA
--    · #667: 10.000 x U$S 0,035 =   350 s/IVA →   427 c/IVA
--
--  OJO: si tocas pedidos.cantidad, la linea #667 pasa a COMPLETA
--  (10.000 recibidas de 10.000 pedidas) y se cierra el saldo pendiente.
--
-- update public.pedidos set cantidad = 90000, s_iva = 1800, c_iva = 2196 where id = 666;
-- update public.pedidos set cantidad = 10000, s_iva =  350, c_iva =  427 where id = 667;
-- update public.inventario set pendiente_entrega = null where id = 88;

commit;

-- ── Verificacion ───────────────────────────────────────────────────
select 'pedido' as que, p.id::text, p.descripcion,
       p.cantidad::text as pedida,
       coalesce((select sum(e.cantidad) from public.entregas e where e.pedido_id = p.id), 0)::text as recibida,
       coalesce(p.f_recepcion::text, '(parcial / pendiente)') as f_recepcion
  from public.pedidos p
 where p.n_orden = '927'
union all
select 'stock', i.id::text, i.descripcion,
       i.inventario::text, coalesce(i.pendiente_entrega::text, '—'), i.solicitar
  from public.inventario i
 where i.id in (85, 88)
 order by 1 desc, 2;

-- Esperado:
--   pedido 666 → pedida 50000, recibida 90000, f_recepcion 2026-08-27
--   pedido 667 → pedida 20000, recibida 10000, f_recepcion (parcial / pendiente)
--   stock  85  → inventario 95000, pendiente —
--   stock  88  → inventario 17500, pendiente 10000
