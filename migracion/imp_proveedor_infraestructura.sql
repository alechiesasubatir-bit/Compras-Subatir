-- ============================================================
--  DEPÓSITOS · proveedor nuevo "Infraestructura"
--
--  Pedido del usuario (14/10): los 3 artículos de tipo
--  Infraestructura que estaban bajo Subatir pasan al proveedor
--  Infraestructura. Son las piezas de la estantería de picking:
--    128  490079  Chapa Estante 2m x 60cm      564 u en Furriol
--    129  490078  Parante 2m                   394 u en Furriol
--    130  490002  Pata Lateral (Pórtico)        59 u en Furriol
--
--  Cambia sólo el proveedor: el id, el stock, los movimientos y los
--  pedidos quedan como están. Las reglas de Infraestructura (la pide
--  sólo un admin, viaja por cantidad y sin pallet) miran el TIPO, no
--  el proveedor, así que siguen igual. No hay todavía ningún artículo
--  de Infraestructura como proveedor: no choca con los únicos.
--
--  Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

update public.imp_articulos
   set proveedor  = 'Infraestructura',
       updated_at = now()
 where proveedor = 'Subatir'
   and tipo = 'Infraestructura';

-- ── Control ─────────────────────────────────────────────────
-- Esperado: Infraestructura · Infraestructura · 3, y Subatir sin
-- ningún artículo de tipo Infraestructura.
select proveedor, tipo, count(*)
  from public.imp_articulos
 where tipo = 'Infraestructura' or proveedor = 'Infraestructura'
 group by proveedor, tipo;
