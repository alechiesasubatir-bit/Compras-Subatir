-- ============================================================
--  PEDIDOS VARIOS: NETO E IVA DE UN TOTAL CARGADO AL RECIBIR  ·  26/11/2026
--
--  EL PROBLEMA
--  Al recibir un pedido vario se puede poner el "Total final". La pantalla
--  guardaba sólo el total y dejaba el neto (subtotal) y el IVA como
--  estaban: vacíos o viejos. Informes suma el neto, y cuando está vacío
--  usa el total, que es CON IVA: el pedido 1 ($ 6.652, IVA 22%) entraba
--  a los informes como $ 6.652 de neto en vez de $ 5.452,46.
--  Desde el 26/11 la pantalla rehace neto e IVA al recibir; esto arregla
--  el único pedido que ya había quedado así.
--
--  Correr en Supabase → SQL Editor, de una sola vez.
-- ============================================================

begin;

-- Antes
select id, moneda, iva_tasa, subtotal, iva_monto, total from public.pedidos_varios where id = 1;

update public.pedidos_varios
   set subtotal  = round(total / (1 + iva_tasa / 100.0), 2),
       iva_monto = total - round(total / (1 + iva_tasa / 100.0), 2)
 where id = 1 and subtotal is null and total = 6652 and iva_tasa = 22;

-- Después: subtotal 5452.46, iva_monto 1199.54
select id, moneda, iva_tasa, subtotal, iva_monto, total from public.pedidos_varios where id = 1;

commit;
