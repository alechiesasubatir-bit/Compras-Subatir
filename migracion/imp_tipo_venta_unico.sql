-- ============================================================
--  DEPÓSITOS · "Venta Piscina" se unifica con "Venta"
--
--  Pedido del usuario (14/10): en el stock por depósito, Venta y
--  Venta Piscina son lo mismo. Quedan tres tipos: Consumo, Venta e
--  Infraestructura. Lo que distingue a Intex y Enjoy sigue siendo
--  el PROVEEDOR, no el tipo.
--
--  Es sólo un cambio de dato: ninguna función de la base trata a
--  Venta Piscina distinto de Venta (las reglas miran Consumo e
--  Infraestructura). El mensaje de imp_solicitar que todavía dice
--  "Venta, Venta Piscina e Infraestructura los pide un administrador"
--  es texto y queda como está.
--
--  Esto deshace imp_v9.sql, que había creado el tipo.
--  Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

update public.imp_articulos
   set tipo = 'Venta',
       updated_at = now()
 where tipo = 'Venta Piscina';

-- ── Control ─────────────────────────────────────────────────
-- Esperado: ninguna fila "Venta Piscina"; Intex y Enjoy en Venta.
select proveedor, coalesce(tipo,'(sin tipo)') as tipo, count(*)
  from public.imp_articulos
 group by proveedor, tipo
 order by proveedor, tipo;
