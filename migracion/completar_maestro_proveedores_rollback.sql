-- ============================================================================
--  ROLLBACK de completar_maestro_proveedores.sql
--  Borra las 35 fichas creadas el 2026-07-29 (ids 31..65, contiguos porque
--  entraron en un solo insert; el maestro tenía ids 1..30 antes).
--
--  OJO: si ya cargaste contactos, RUT o direcciones en alguna de estas fichas,
--  esto los borra. El filtro por nombre está para no llevarse por delante una
--  ficha distinta que hubiera reusado el id.
-- ============================================================================

delete from public.proveedores
 where id between 31 and 65
   and empresa in (
     'Acril Ltda',
     'Adesur SRL',
     'ANGEL REVETRIA',
     'APICOLA INTEGRAL',
     'Aryes Ltda.',
     'CICSSA',
     'COLTRAY',
     'DAPAMA',
     'Dastec Uruguay SRL',
     'Dematte y Asociados SRL',
     'DIAGONAL',
     'Diamaler S.A.',
     'DIMENA',
     'DIU',
     'ELCOR',
     'Emilio Benzo S.A.',
     'Eresur',
     'Fixory SA',
     'Fradec LTDA',
     'GASTON BRITES - VENTAS URUGUAY',
     'Impofra S.A.S',
     'LEONARDO SALVO - RYMEL',
     'LG PACKAGING',
     'Liderquim S.A.S',
     'Lipiner S.A.',
     'MOIZO',
     'MULTIPACK',
     'Neosul SA',
     'Nesta LTDA',
     'PACK IMPORTACIONES SRL',
     'Penfer SAS',
     'Polin S.A.',
     'Riverfilco S.A.',
     'Roydel S.A.',
     'Solsire S.A.'
   );
