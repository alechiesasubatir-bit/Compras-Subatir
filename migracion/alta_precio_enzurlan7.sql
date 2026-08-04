-- ============================================================
--  Alta en `precios`: Enzurlan 7 moles (proveedor Enzur S.A.)
--  ------------------------------------------------------------
--  El artículo existe en `inventario` (código 220155, proveedor
--  ENZUR → normalizado a Enzur S.A.) y se compró varias veces
--  (OC 681 y 818 a U$S 4,10 ; OC 828 del 10-06-2026 a U$S 4,40),
--  pero nunca estuvo en la lista de precios: la planilla original
--  migrada el 16-07 traía 211 filas y ninguna era este artículo.
--  Por eso no aparece en el módulo Precios.
--
--  Criterios usados:
--   · articulo  = 'Enzurlan 7 moles' → igual que inventario.descripcion,
--     que es de donde el módulo saca la categoría (ext_id = MP →
--     "Materias Primas"). Con el nombre de la OC ("ENZURLAN 7 MOLES
--     MP X KG") la fila quedaría sin categoría.
--   · proveedor = 'Enzur S.A.' → forma canónica que dejó
--     normalizar_proveedores.sql; así entra en el filtro por proveedor.
--   · cod_prov / atención / calidad / demora / pago = los mismos que
--     el resto de las filas de Enzur.
--   · precio  = U$S 4,40, el último efectivamente pagado (OC 828).
--
--  Es idempotente: si la fila ya existe, no inserta nada.
--
--  Corrido el 04-08-2026 → quedó como precios.id = 216, pero con
--  fecha_actualizado = 2026-08-04 (el día del alta) en vez del
--  10-06-2026 de abajo. El precio es el mismo; solo figura como
--  actualizado ese día.
-- ============================================================

insert into public.precios
  (fecha_actualizado, codigo, articulo, cod_prov, proveedor,
   precio_usd, precio_pesos, atencion, calidad, demora, modalidad_pago)
select
  date '2026-06-10', '220155', 'Enzurlan 7 moles', '000000000040-02', 'Enzur S.A.',
  4.40, null, 'BUENA', 'BUENA', 'BUENA', '90 DIAS'
where not exists (
  select 1 from public.precios
  where upper(trim(articulo)) like 'ENZURLAN 7 MOLES%'
    and upper(trim(proveedor)) like 'ENZUR%'
);

-- Verificación
select id, fecha_actualizado, codigo, articulo, proveedor, precio_usd
from public.precios
where upper(trim(articulo)) like 'ENZURLAN%';
