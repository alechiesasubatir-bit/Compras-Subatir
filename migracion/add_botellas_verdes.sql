-- ============================================================
--  Alta de 2 productos al listado de PRECIOS de Green Oil.
--  Precios en PESOS ($) sin IVA. El proveedor se toma del mismo
--  string que ya usan las otras filas de Green Oil (subquery),
--  así aparecen agrupados en su listado.
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================
insert into public.precios
  (fecha_actualizado, articulo, proveedor, precio_usd, precio_pesos, atencion, calidad, demora, modalidad_pago)
values
  (current_date, 'Botella Pet x 1 L Verde',
     (select proveedor from public.precios where proveedor ilike 'green oil%' limit 1),
     null, 7.20, 'BUENA', 'BUENA', 'BUENA', '90 DIAS'),
  (current_date, 'Botella Pet x 500 mL Verde',
     (select proveedor from public.precios where proveedor ilike 'green oil%' limit 1),
     null, 6.64, 'BUENA', 'BUENA', 'BUENA', '90 DIAS');
