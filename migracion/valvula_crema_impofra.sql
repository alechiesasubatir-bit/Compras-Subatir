-- ============================================================
--  Válvula Crema rosca 28/400: unificar nombre y darla de alta
--  en la lista de precios con Impofra
--
--  Qué pasaba:
--    inventario → "Valvula Crema  rosca 28 /400 corta"  (id 141, cod 220135)
--    OC 913     → "Valvula Crema  rosca 28 400"          (Impofra, 8.000 u,
--                                                         pendiente)
--
--  Son el mismo producto. La ficha nunca se enganchó con ninguna
--  compra porque el nombre no coincide, y encima NO está en la lista
--  de precios: por eso hubo que tipearla a mano en la OC, y por eso
--  salió con otra grafía. Impofra directamente no tiene ni un
--  artículo cargado en precios.
--
--  Ojo con la otra ficha: "Valvula Crema  rosca 28 /410" (id 142) es
--  OTRA válvula y NO se toca. Hasta hoy el módulo le atribuía a ella
--  las 8.000 de esta OC, porque el cruce ignoraba los números y en
--  palabras las dos son idénticas. Eso ya se corrigió en el código
--  (version 2026-08-18.1727).
--
--  Acá se hacen dos cosas:
--    1) alta en precios con Impofra, para poder pedirla desde el
--       módulo de Pedidos y que salga siempre con el nombre bueno
--    2) se corrige la descripción de la línea de la OC 913, que sigue
--       PENDIENTE, para que las 8.000 caigan en su ficha
--
--  Se conserva el nombre del inventario ("/400 corta"), que es el más
--  descriptivo, en vez de adoptar el "28 400" de la OC.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── Antes ────────────────────────────────────────────────────
select 'inventario' as origen, id::text, descripcion from public.inventario where id in (141,142)
union all
select 'OC 913',     id::text, descripcion from public.pedidos    where n_orden = '913'
union all
select 'precios',    id::text, articulo || ' — ' || proveedor from public.precios where articulo ilike '%valvula crema%';

-- ── 1) Alta en la lista de precios ───────────────────────────
--  Precio y moneda salen de la OC 913 (U$S 0,175). La condición de
--  pago es la que tiene Impofra en el maestro de proveedores.
insert into public.precios (articulo, codigo, proveedor, precio_usd, modalidad_pago, fecha_actualizado)
select 'Valvula Crema  rosca 28 /400 corta', '220135', 'Impofra S.A.S', 0.175, '60 días', current_date
 where not exists (
   select 1 from public.precios
    where articulo = 'Valvula Crema  rosca 28 /400 corta'
      and proveedor = 'Impofra S.A.S'
 );

-- ── 2) Corregir la línea de la OC 913 ────────────────────────
--  Es una OC todavía pendiente y el producto es el mismo: se le pone
--  el nombre de la ficha para que el tránsito le llegue.
update public.pedidos
   set descripcion = 'Valvula Crema  rosca 28 /400 corta'
 where n_orden = '913'
   and descripcion = 'Valvula Crema  rosca 28 400';

-- ── Comprobar ────────────────────────────────────────────────
--  La OC 913 tiene que quedar con el nombre de la ficha, y la /410
--  intacta.
select 'inventario' as origen, id::text, descripcion from public.inventario where id in (141,142)
union all
select 'OC 913',     id::text, descripcion from public.pedidos    where n_orden = '913'
union all
select 'precios',    id::text, articulo || ' — ' || proveedor from public.precios where articulo ilike '%valvula crema%';
