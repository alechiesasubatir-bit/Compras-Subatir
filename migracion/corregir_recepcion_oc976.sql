-- ============================================================
--  OC 976 - Viracross S.A.S (17/09/2026)
--  Percarbonato de Sodio: se pidieron 5.000 Kg, llegaron 3.000.
--  Quedan 2.000 pendientes.
--
--  QUE PASO (reconstruido de la base, 21/09/2026)
--    · Linea #764, 5.000 Kg, ficha de inventario #111.
--    · Hoy 12:13 se registro la entrega E210 por 5.000: el trigger
--      trg_entregas_sync le puso f_recepcion = 21/09 a la linea (con
--      lote 260423, COA SI, recibio NOELIA EROZA) y inventario_sumar
--      le sumo 5.000 a la ficha 111, que quedo en 7.000.
--    · 13:05 se corrigio esa entrega (no toca el stock).
--    · Despues se BORRO la entrega. Y ahi quedo el problema doble:
--        - borrar una entrega NO descuenta el inventario (delEntrega
--          solo borra la fila), asi que las 5.000 siguen en el stock;
--        - el trigger, cuando la linea se queda sin ninguna entrega,
--          no vuelve a abrirla: f_recepcion quedo en 21/09.
--      Resultado: la linea figura COMPLETA por 5.000 (Pedidos la lee
--      como "recibida al viejo estilo", sin historial) y no hay forma
--      de cargar la entrega real desde la pantalla, porque para una
--      linea completa el formulario de entrega no se muestra.
--
--  QUE HACE ESTE ARCHIVO
--    1) Carga la entrega real de 3.000. Al insertarla el trigger ve
--       3.000 < 5.000 y pone f_recepcion = NULL: la linea vuelve a
--       PARCIAL con saldo 2.000, que es lo que hay que esperar.
--    2) Baja el stock de la ficha 111 de 7.000 a 5.000 (habian entrado
--       5.000 y solo llegaron 3.000).
--
--  ANTES DE CORRER: en Stock, Percarbonato de Sodio tiene que decir
--  7.000 Kg. Si dice otra cosa, PARAR: el guard del UPDATE no va a
--  aplicar y hay que revisar de nuevo de donde salio la diferencia.
--
--  Idempotente: el INSERT va con NOT EXISTS y el UPDATE de stock con
--  guarda sobre el valor actual, asi correrlo dos veces no descuenta
--  de mas.
--
--  Correr en Supabase -> SQL Editor.
-- ============================================================

begin;

-- ── 1 · La entrega que realmente hubo: 3.000 de 5.000 ──────────────
--  Lote, COA y quien recibio son los que el trigger habia dejado en la
--  linea, que salieron de la entrega borrada.
--  Sin checklist: el PL-06 de la entrega original se fue con el borrado
--  y no se puede reconstruir desde aca. Percarbonato es Materia Prima,
--  asi que despues de correr esto hay que entrar a Recepcion -> OC 976
--  -> boton corregir sobre la entrega y cargar factura, remito y PL-06.
insert into public.entregas
       (pedido_id, n_orden, descripcion, cantidad, fecha, lote, coa, recibido_por, observaciones)
select 764, '976', p.descripcion, 3000, date '2026-09-21', '260423', 'SI', 'NOELIA EROZA',
       'Entrega parcial: llegaron 3.000 de 5.000 Kg pedidos, quedan 2.000 pendientes. '
       || 'Cargada por SQL el 21/09/2026: la entrega original se habia registrado por 5.000 y al borrarla '
       || 'la linea quedo marcada como recibida completa y el stock con 2.000 Kg que nunca llegaron. '
       || 'Falta cargarle el check list PL-06.'
  from public.pedidos p
 where p.id = 764
   and not exists (select 1 from public.entregas e where e.pedido_id = 764);

-- ── 2 · Stock ficha 111 · habian entrado 5.000, llegaron 3.000 ─────
--  7.000 - 2.000 = 5.000. Va UPDATE directo y no inventario_sumar():
--  esa funcion pregunta por el permiso con auth.uid(), que en el SQL
--  Editor es NULO, asi que devuelve "sin permiso" sin hacer nada.
update public.inventario
   set inventario = 5000
 where id = 111
   and inventario = 7000;

commit;

-- ── Verificacion ───────────────────────────────────────────────────
select 'pedido' as que, p.id::text as id, p.descripcion,
       p.cantidad::text as pedida,
       coalesce((select sum(e.cantidad) from public.entregas e where e.pedido_id = p.id), 0)::text as recibida,
       coalesce(p.f_recepcion::text, '(parcial / pendiente)') as f_recepcion
  from public.pedidos p
 where p.id = 764
union all
select 'stock', i.id::text, i.descripcion, i.unidad,
       i.inventario::text, coalesce(i.pendiente_entrega::text, '-')
  from public.inventario i
 where i.id = 111;

-- Esperado:
--   pedido 764 -> pedida 5000, recibida 3000, f_recepcion (parcial / pendiente)
--   stock  111 -> inventario 5000
