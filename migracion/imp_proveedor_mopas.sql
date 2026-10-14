-- ============================================================
--  DEPÓSITOS · proveedor nuevo "Mopas"
--
--  Pedido del usuario (14/10): los artículos de Subatir que tienen
--  "Mopa" en la descripción pasan al proveedor Mopas, tipo Venta.
--  Son 18 (kits, cajas y repuestos de mopa). Verificado antes de
--  escribir esto:
--    · todos son Subatir · Venta, con stock 0 en los dos depósitos
--    · ninguno tiene pallets ni está en una solicitud
--    · sólo dos tienen movimientos (un AJUSTE cada uno), que siguen
--      colgados del mismo artículo: cambia el proveedor, no el id
--    · no existe todavía ningún artículo de Mopas, así que no choca
--      con los únicos (proveedor, descripción) ni (proveedor, código)
--
--  El proveedor en Depósitos es el texto de imp_articulos.proveedor:
--  no hay tabla de proveedores que dar de alta. El ingreso de stock
--  ya deja elegir Furriol o Artigas para cualquier artículo.
--
--  Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Lo que se va a mover (opcional, para mirar antes) ────
-- select id, codigo, descripcion, tipo from public.imp_articulos
--  where proveedor = 'Subatir' and descripcion ilike '%mopa%' order by descripcion;

-- ── 2. El cambio ────────────────────────────────────────────
update public.imp_articulos
   set proveedor  = 'Mopas',
       tipo       = 'Venta',
       updated_at = now()
 where proveedor = 'Subatir'
   and descripcion ilike '%mopa%';

-- ── Control ─────────────────────────────────────────────────
-- Esperado: Mopas · Venta · 18 ; y 0 artículos de Subatir con "mopa".
select proveedor, tipo, count(*) from public.imp_articulos
 where descripcion ilike '%mopa%' group by proveedor, tipo;
