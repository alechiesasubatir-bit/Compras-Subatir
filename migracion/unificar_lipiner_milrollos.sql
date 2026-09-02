-- ============================================================
--  MIL ROLLOS y Lipiner S.A. son el MISMO proveedor.
--  Se unifica hacia "Lipiner S.A." (decision del usuario, 02/09/2026).
--
--  Por que hacia Lipiner y no al reves:
--    - Lipiner S.A. es lo que usa toda la operacion real:
--      47 ordenes de compra y las 8 filas de la lista de precios.
--    - "MIL ROLLOS" sobrevive solo en inventario.proveedor (8 celdas),
--      que es el campo que se carga a mano.
--    Unificar hacia Lipiner toca 8 celdas y no altera ningun historico.
--    Al reves habria que reescribir 47 pedidos y 8 precios.
--
--  Las dos fichas del maestro son COMPLEMENTARIAS, no contradictorias:
--    - MIL ROLLOS (id 13): contacto Maximiliano Sosa, Vendedor,
--      msosa@dmr.com.uy, 097 351 962.
--    - Lipiner S.A. (id 55): condicion de pago 60 DIAS, calidad BUENA.
--  Se copian los datos de contacto a la ficha 55 SOLO donde esta vacia
--  (coalesce), asi la union no pisa nada. Sin este paso se perderia el
--  unico telefono cargado de este proveedor.
--
--  "MIL ROLLOS" queda anotado como nombre comercial en observaciones:
--  es como lo conocen en la planta y no hay que perder el rastro.
--
--  Idempotente: cada UPDATE va con guarda sobre el valor actual, asi
--  correrlo dos veces no hace nada la segunda vez.
--
--  Correr en Supabase -> SQL Editor.
-- ============================================================

begin;

-- 1 . Pasar el contacto a la ficha que queda, sin pisar lo que ya tiene
update public.proveedores dst
   set nombre_contacto = coalesce(dst.nombre_contacto, src.nombre_contacto),
       puesto          = coalesce(dst.puesto,          src.puesto),
       email           = coalesce(dst.email,           src.email),
       celular         = coalesce(dst.celular,         src.celular),
       telefono        = coalesce(dst.telefono,        src.telefono),
       rut             = coalesce(dst.rut,             src.rut),
       condicion_pago  = coalesce(dst.condicion_pago,  src.condicion_pago),
       rubro           = coalesce(dst.rubro,           src.rubro),
       direccion       = coalesce(dst.direccion,       src.direccion),
       calidad         = coalesce(dst.calidad,         src.calidad),
       observaciones   = coalesce(dst.observaciones, '')
                         || case when coalesce(dst.observaciones,'') like '%MIL ROLLOS%'
                                 then '' else 'Tambien conocido como MIL ROLLOS (nombre comercial). Fichas unificadas el 02/09/2026.' end
  from public.proveedores src
 where dst.empresa = 'Lipiner S.A.'
   and src.empresa = 'MIL ROLLOS';

-- 2 . Los 8 articulos que tenian MIL ROLLOS en la ficha de stock
update public.inventario
   set proveedor = 'Lipiner S.A.'
 where proveedor = 'MIL ROLLOS';

-- Por las dudas, el mismo alias en el proveedor sugerido (hoy: 0 filas)
update public.inventario
   set proveedor_sugerido = 'Lipiner S.A.'
 where proveedor_sugerido = 'MIL ROLLOS';

-- 3 . Las fichas de reposicion (art_proveedor).
--  Si un articulo llegara a tener las DOS fichas, la de MIL ROLLOS se
--  descarta: el unique (inventario_id, proveedor) no deja tener las dos
--  con el mismo nombre, y la de Lipiner es la que venia mandando.
delete from public.art_proveedor mr
 where mr.proveedor = 'MIL ROLLOS'
   and exists (select 1 from public.art_proveedor lp
                where lp.inventario_id = mr.inventario_id
                  and lp.proveedor = 'Lipiner S.A.');

update public.art_proveedor
   set proveedor = 'Lipiner S.A.'
 where proveedor = 'MIL ROLLOS';

-- 4 . Retirar la ficha duplicada del maestro, ya vaciada de datos utiles
delete from public.proveedores
 where empresa = 'MIL ROLLOS';

commit;

-- Verificacion ------------------------------------------------------
select 'maestro MIL ROLLOS (debe ser 0)' as que,
       count(*)::text as valor
  from public.proveedores where empresa = 'MIL ROLLOS'
union all
select 'inventario con MIL ROLLOS (debe ser 0)',
       count(*)::text from public.inventario
 where proveedor = 'MIL ROLLOS' or proveedor_sugerido = 'MIL ROLLOS'
union all
select 'art_proveedor con MIL ROLLOS (debe ser 0)',
       count(*)::text from public.art_proveedor where proveedor = 'MIL ROLLOS'
union all
select 'inventario con Lipiner (era 1, debe ser 9)',
       count(*)::text from public.inventario where proveedor = 'Lipiner S.A.'
union all
select 'contacto en la ficha de Lipiner',
       coalesce(nombre_contacto,'(VACIO - MAL)') || ' / ' || coalesce(celular,'(sin tel)')
  from public.proveedores where empresa = 'Lipiner S.A.'
union all
select 'condicion de pago de Lipiner (no se debe haber perdido)',
       coalesce(condicion_pago,'(VACIO - MAL)')
  from public.proveedores where empresa = 'Lipiner S.A.';

-- Esperado:
--   maestro MIL ROLLOS                0
--   inventario con MIL ROLLOS         0
--   art_proveedor con MIL ROLLOS      0
--   inventario con Lipiner            9
--   contacto en la ficha de Lipiner   Maximiliano Sosa / 097 351 962
--   condicion de pago de Lipiner      60 DIAS
