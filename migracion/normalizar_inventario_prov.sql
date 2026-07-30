-- ============================================================================
--  Normalización de nombres de proveedor en la tabla INVENTARIO
--  Fecha: 2026-07-29
--
--  YA APLICADO el 2026-07-29 desde la app como admin (139/139 celdas). Este
--  archivo queda como registro y es idempotente: correrlo de nuevo no cambia
--  nada, sirve para reproducir la migración en otro entorno.
--
--  Contexto: los nombres de proveedor quedaron sucios SOLO en inventario
--  (columnas proveedor y proveedor_sugerido). Las tablas proveedores, precios
--  y pedidos ya estaban normalizadas — este script no las toca porque no
--  necesitan ningún cambio (verificado: 0 celdas a corregir en las tres).
--
--  Afecta 139 celdas de 148 filas. El nombre destino lo define el maestro
--  public.proveedores; cuando el proveedor no está en el maestro se usa la
--  grafía de precios/pedidos, y si tampoco está, la más frecuente.
--
--  Decisiones del usuario:
--   · Quimica S.A. y Quimica Oriental S.A. son proveedores DISTINTOS.
--   · Irmari LTDA y Midarma son proveedores DISTINTOS.
--   · El valor "IRMARI/MIDARMA" (1 fila, artículo "Envase PET x 250 mL
--     (textiles)") no corresponde a ningún proveedor real: se vacía. Ese
--     artículo lo cotizan Irmari LTDA, Midarma y Nicolás Ojeda en la lista de
--     precios, y su proveedor_sugerido queda en Midarma, así que no se pierde
--     información.
--
--  NOTA DE IMPLEMENTACIÓN: el mapeo va en un CTE, no en una tabla temporal.
--  El editor SQL de Supabase confirma cada sentencia por separado, así que un
--  "create temporary table ... on commit drop" se dropea antes de la sentencia
--  siguiente y falla con: relation "_prov_map" does not exist.
--  Las dos columnas se arreglan en UNA sola sentencia, así que es atómica sin
--  necesidad de begin/commit explícito.
--
--  Para revertir: normalizar_inventario_prov_rollback.sql
-- ============================================================================

with m(viejo, nuevo) as (
  values
    -- Alias reales confirmados por el usuario (nombre corto → nombre de la empresa)
    ('CARRETO',          'Carretto Rodriguez'),
    ('OJEDA NICOLAS',    'Nicolás Ojeda'),
    ('FLAX',             'Flax Uruguay SRL'),
    ('PACK IMPORT.',     'PACK IMPORTACIONES SRL'),
    ('DAXILAN (GUCA)',   'Guca Trading Ltda (DAXILAN)'),
    ('RYMEL',            'LEONARDO SALVO - RYMEL'),
    ('WILLIAMS',         'Williams y Cia Productos Quimicos S.A'),
    ('VENTAS URUGUAY',   'GASTON BRITES - VENTAS URUGUAY'),
    -- Nombre pelado o abreviado → grafía del maestro de proveedores
    ('ENZUR',            'Enzur S.A.'),
    ('NORTESUR',         'Nortesur S.A.'),
    ('Norte Sur',        'Nortesur S.A.'),
    ('GREEN OIL',        'Green Oil S.A.'),
    ('VERNOL',           'Vernol S.A.'),
    ('VIRACROSS',        'Viracross S.A.S'),
    ('LARIALES',         'Lariales S.A.'),
    ('QUIMICA SA',       'Quimica S.A.'),
    ('QUIMICA ORIENTAL', 'Quimica Oriental S.A.'),
    ('IRMARI',           'Irmari LTDA'),
    ('MIDARMA',          'Midarma'),
    ('SOLSIRE',          'Solsire S.A.'),
    ('POLIN',            'Polin S.A.'),
    ('PERRIN',           'Perrin S.A.'),
    ('ROYDEL',           'Roydel S.A.'),
    ('LIDERQUIM',        'Liderquim S.A.S'),
    ('IMPOFRA',          'Impofra S.A.S'),
    ('RIVERFILCO',       'Riverfilco S.A.'),
    ('ERESUR',           'Eresur'),
    -- Variantes de un proveedor que no está en el maestro: gana la más frecuente
    ('TORREVIEJA',       'TORRE VIEJA'),
    ('Moizo',            'MOIZO')
)
update public.inventario i
   set proveedor          = coalesce((select nuevo from m where m.viejo = i.proveedor),          i.proveedor),
       proveedor_sugerido = coalesce((select nuevo from m where m.viejo = i.proveedor_sugerido), i.proveedor_sugerido)
 where i.proveedor          in (select viejo from m)
    or i.proveedor_sugerido in (select viejo from m);

-- No es un proveedor: quien lo escribió quiso decir "cualquiera de los dos"
update public.inventario
   set proveedor = null
 where proveedor = 'IRMARI/MIDARMA';

-- Control: no debería quedar ningún valor de inventario que no exista en el
-- maestro, en precios o en pedidos. Con el maestro ya completo
-- (completar_maestro_proveedores.sql) esto tiene que devolver 0 filas.
-- select distinct proveedor from public.inventario i
--  where proveedor is not null
--    and not exists (select 1 from public.proveedores p where p.empresa = i.proveedor);
