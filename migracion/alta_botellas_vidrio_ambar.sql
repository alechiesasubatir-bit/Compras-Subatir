-- ============================================================
--  Alta de las 2 botellas de VIDRIO ámbar en precios e inventario
--
--    Botella VIDRIO Ambar 500 mL  ·  Acril Ltda  ·  $ 29,30
--    Botella VIDRIO Ambar 1 L     ·  Penfer SAS  ·  U$S 0,696
--
--  Se compraron (OC 779 y 856 de Acril, OC 857 de Penfer) pero
--  nunca se cargaron ni en la lista de precios ni en el inventario.
--  Las botellas ámbar que sí están son las de PET (Green Oil,
--  Midarma, Pack), que son otro producto.
--
--  Nombre, proveedor y precio salen de las últimas OC (sin IVA).
--  El nombre es el mismo de las OC para que se crucen solas; la
--  OC 779 dice "Ámbar" con tilde, pero el cruce ignora los acentos.
--
--  Lo que no se sabe se deja vacío, no se inventa:
--    · código del sistema, presentación, consumo y mínimo
--    · stock = 0 → cargar el conteo real desde Stock
--    · condición de pago (ninguno de los dos la tiene en el maestro)
--
--  La categoría (Envases) sale de ext_id = 'ENV'.
--  Se puede correr dos veces: no duplica.
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── 1) Lista de precios ──────────────────────────────────────
insert into public.precios (articulo, proveedor, precio_usd, precio_pesos, fecha_actualizado)
select v.articulo, v.proveedor, v.usd, v.pesos, current_date
  from (values
    ('Botella VIDRIO Ambar 500 mL', 'Acril Ltda', null::numeric, 29.30::numeric),
    ('Botella VIDRIO Ambar 1 L',    'Penfer SAS', 0.696,         null)
  ) as v(articulo, proveedor, usd, pesos)
 where not exists (
   select 1 from public.precios p
    where p.articulo = v.articulo and p.proveedor = v.proveedor
 );

-- ── 2) Inventario ────────────────────────────────────────────
insert into public.inventario (descripcion, unidad, inventario, proveedor, proveedor_sugerido, ext_id)
select v.descripcion, 'Unid.', 0, v.proveedor, v.proveedor, 'ENV'
  from (values
    ('Botella VIDRIO Ambar 500 mL', 'Acril Ltda'),
    ('Botella VIDRIO Ambar 1 L',    'Penfer SAS')
  ) as v(descripcion, proveedor)
 where not exists (
   select 1 from public.inventario i where i.descripcion = v.descripcion
 );

-- ── Comprobar ────────────────────────────────────────────────
--  Tienen que salir 2 filas en cada tabla.
select 'precios' as tabla, id, articulo as nombre, proveedor,
       coalesce('U$S ' || precio_usd, '$ ' || precio_pesos) as dato
  from public.precios where articulo ilike 'Botella VIDRIO Ambar%'
union all
select 'inventario', id, descripcion, proveedor, 'stock ' || inventario
  from public.inventario where descripcion ilike 'Botella VIDRIO Ambar%';
