-- ============================================================================
--  Completar el maestro public.proveedores
--  Fecha: 2026-07-29
--
--  El maestro tenía 30 fichas, pero entre precios, pedidos e inventario se
--  usan 65 proveedores: faltaban 35. Este script los agrega.
--
--  Se corre DESPUÉS de normalizar_inventario_prov.sql: si se corre antes, los
--  nombres sucios de inventario (CARRETO, GREEN OIL, OJEDA NICOLAS…) generan
--  fichas duplicadas de proveedores que ya existen.
--
--  condicion_pago y calidad salen de public.precios (columnas modalidad_pago y
--  calidad) — son datos reales, no inventados, y solo 17 de los 35 los tienen.
--  El resto entra solo con el nombre: los contactos se completan a mano desde
--  el módulo Proveedores. Tampoco se rellena rubro: deducirlo de las categorías
--  de los artículos sería adivinar.
--
--  Idempotente: filtra por nombre exacto contra lo que ya está en la tabla.
--  Para revertir: completar_maestro_proveedores_rollback.sql
-- ============================================================================

insert into public.proveedores (empresa, condicion_pago, calidad)
select v.empresa, v.condicion_pago, v.calidad
  from (values
    ('Acril Ltda',                            null,       null),
    ('Adesur SRL',                            null,       null),
    ('ANGEL REVETRIA',                        'CONTADO',  'BUENA'),
    ('APICOLA INTEGRAL',                      null,       null),
    ('Aryes Ltda.',                           null,       null),
    ('CICSSA',                                null,       null),
    ('COLTRAY',                               '90 DIAS',  'BUENA'),
    ('DAPAMA',                                null,       null),
    ('Dastec Uruguay SRL',                    null,       null),
    ('Dematte y Asociados SRL',               null,       null),
    ('DIAGONAL',                              null,       null),
    ('Diamaler S.A.',                         '30 DIAS',  'BUENA'),
    ('DIMENA',                                '60 DIAS',  'BUENA'),
    ('DIU',                                   null,       null),
    ('ELCOR',                                 '30 DIAS',  'BUENA'),
    ('Emilio Benzo S.A.',                     '30 DIAS',  'BUENA'),
    ('Eresur',                                '30 DIAS',  'BUENA'),
    ('Fixory SA',                             null,       null),
    ('Fradec LTDA',                           '30 DIAS',  'BUENA'),
    ('GASTON BRITES - VENTAS URUGUAY',        '30 DIAS',  'REGULAR'),
    ('Impofra S.A.S',                         null,       null),
    ('LEONARDO SALVO - RYMEL',                '30 DIAS',  'BUENA'),
    ('LG PACKAGING',                          null,       null),
    ('Liderquim S.A.S',                       '30 DIAS',  'BUENA'),
    ('Lipiner S.A.',                          '60 DIAS',  'BUENA'),
    ('MOIZO',                                 null,       null),
    ('MULTIPACK',                             null,       null),
    ('Neosul SA',                             null,       null),
    ('Nesta LTDA',                            'CONTADO',  'BUENA'),
    ('PACK IMPORTACIONES SRL',                '45 DIAS',  'BUENA'),
    ('Penfer SAS',                            null,       null),
    ('Polin S.A.',                            null,       null),
    ('Riverfilco S.A.',                       '30 DIAS',  'BUENA'),
    ('Roydel S.A.',                           '90 DIAS',  'BUENA'),
    ('Solsire S.A.',                          '30 DIAS',  'BUENA')
  ) as v(empresa, condicion_pago, calidad)
 where not exists (
   select 1 from public.proveedores p where p.empresa = v.empresa
 );

-- Control: debería devolver 0 filas (todo proveedor en uso tiene ficha).
-- with usados as (
--   select proveedor as empresa from public.precios    where proveedor is not null
--   union select proveedor      from public.pedidos     where proveedor is not null
--   union select proveedor      from public.inventario  where proveedor is not null
--   union select proveedor_sugerido from public.inventario where proveedor_sugerido is not null
-- )
-- select u.empresa from usados u
--  where not exists (select 1 from public.proveedores p where p.empresa = u.empresa);
