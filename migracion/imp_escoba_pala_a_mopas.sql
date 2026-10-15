-- ============================================================
--  DEPÓSITOS · 490159 Kit Escoba Y Pala Plegable → Mopas
--
--  Pedido del usuario (15/10): pasa del proveedor Subatir a Mopas,
--  igual que los kits de mopa (imp_proveedor_mopas.sql).
--  Verificado antes de escribir esto (id 145):
--    · Subatir · Venta, stock 0 en Furriol y en Artigas
--    · sin pallets y sin ítems en solicitudes
--    · dos movimientos (AJUSTE del 14/10) que siguen colgados del
--      mismo artículo: cambia el proveedor, no el id
--    · Mopas no tiene ni el código 490159 ni esa descripción, así
--      que no choca con los índices únicos
--  La descripción conserva "(Subatir)", como el resto de los kits
--  que ya se movieron a Mopas.
--
--  Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

update public.imp_articulos
   set proveedor  = 'Mopas',
       updated_at = now()
 where proveedor = 'Subatir'
   and codigo    = '490159';

-- ── Control ─────────────────────────────────────────────────
-- Esperado: una sola fila, Mopas · Venta.
select id, proveedor, codigo, descripcion, tipo from public.imp_articulos
 where codigo = '490159';
