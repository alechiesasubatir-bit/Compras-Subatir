-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v7
--
--  Se borra imp_transfer, del modelo viejo.
--
--  Movía unidades sueltas de un depósito a otro sin pallet, sin
--  QR, sin tránsito y sin que nadie confirmara la llegada: restaba
--  de un lado y sumaba del otro en el mismo instante. Lo reemplazó
--  el circuito real — marcar pallets, escanear la salida, escanear
--  la llegada — donde lo que se mueve es un pallet entero.
--
--  Además era una puerta lateral: al ser security definer,
--  cualquiera con el módulo importacion podía llamarla desde la
--  consola del navegador y descuadrar el stock sin dejar rastro de
--  ningún pallet.
--
--  Sin riesgo: no la llama nadie en el código y no existe un solo
--  movimiento de tipo TRANSFER en la base.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v6.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Comprobar antes de borrar ─────────────────────────────
--    Si esto devuelve alguna fila, PARÁ: hubo transferencias
--    sueltas y hay que decidir qué hacer con ese historial antes
--    de seguir.
-- select count(*) as transferencias_viejas
--   from public.imp_movimientos where tipo = 'TRANSFER';

-- ── 2. Borrar ────────────────────────────────────────────────
drop function if exists public.imp_transfer(bigint, text, text, numeric, text);

-- ── 3. Comprobación ──────────────────────────────────────────
-- No tiene que devolver ninguna fila:
-- select p.proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'imp_transfer';

-- ── Nota sobre imp_schema.sql ────────────────────────────────
--    imp_schema.sql sigue teniendo el create de imp_transfer, y se
--    deja así a propósito: es el retrato de cómo nació el esquema.
--    Reconstruir la base desde cero sería correr schema → v2 → …
--    → v7, y esta etapa la vuelve a borrar. No lo edites para
--    "limpiarlo": romperías esa cadena.
