-- ============================================================
--  Borra los DOS movimientos de prueba del ajuste de stock
--  (verificación del 15/09/2026, ids 238 y 239).
--
--  Fueron una ida y vuelta sobre "Boya Dispensador Chico 12.6 Cm"
--  (artículo 189, Furriol): 1 → 3 → 1. El stock ya volvió solo a su
--  valor original, así que esto NO toca imp_stock: sólo saca los dos
--  renglones de la bitácora. Correrlo o no correrlo no cambia ningún
--  número, sólo el ruido en el historial.
--
--  OPCIONAL. Correr en Supabase → SQL Editor.
-- ============================================================

-- Mirar antes de borrar:
select id, created_at, articulo_id, deposito, unidades, stock_antes, stock_despues, nota, usuario
  from public.imp_movimientos
 where tipo = 'AJUSTE' and usuario = 'prueba' and nota like 'prueba ajuste%';

-- Borrar:
-- delete from public.imp_movimientos
--  where tipo = 'AJUSTE' and usuario = 'prueba' and nota like 'prueba ajuste%';

-- Comprobar que no queda ninguno de prueba y que el 189 sigue en 1:
-- select count(*) as ajustes_de_prueba from public.imp_movimientos
--  where tipo = 'AJUSTE' and usuario = 'prueba';
-- select cantidad from public.imp_stock where articulo_id = 189 and deposito = 'Furriol';
