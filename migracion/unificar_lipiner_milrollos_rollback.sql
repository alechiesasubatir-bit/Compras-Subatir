-- ============================================================
--  Rollback de unificar_lipiner_milrollos.sql
--
--  OJO: la union es de muchos a uno, asi que NO se puede revertir por
--  valor. Se revierte por los ids EXACTOS que tenian MIL ROLLOS antes
--  de correr el script, anotados aca a mano el 02/09/2026:
--    inventario.proveedor = 'MIL ROLLOS' en: 82, 83, 85, 86, 87, 88, 121, 123
--
--  El articulo 84 NO esta en esa lista a proposito: su proveedor ya lo
--  habia corregido solo el modulo de reposicion (MIL ROLLOS -> Lipiner
--  segun la OC 905) antes de esta unificacion. Devolverlo aca lo dejaria
--  peor que antes.
--
--  Si el script ya se corrio y despues alguien edito a mano el proveedor
--  de alguno de esos articulos, este rollback se lo pisa igual. Revisar
--  antes de correrlo.
-- ============================================================

begin;

-- Volver a crear la ficha del maestro tal como estaba
insert into public.proveedores (empresa, nombre_contacto, puesto, email, celular)
select 'MIL ROLLOS', 'Maximiliano Sosa', 'Vendedor', 'msosa@dmr.com.uy', '097 351 962'
 where not exists (select 1 from public.proveedores where empresa = 'MIL ROLLOS');

-- Sacarle a Lipiner lo que se le copio, y la nota del nombre comercial
update public.proveedores
   set nombre_contacto = null,
       puesto          = null,
       email           = null,
       celular         = null,
       observaciones   = nullif(replace(coalesce(observaciones,''),
                          'Tambien conocido como MIL ROLLOS (nombre comercial). Fichas unificadas el 02/09/2026.', ''), '')
 where empresa = 'Lipiner S.A.'
   and nombre_contacto = 'Maximiliano Sosa';

-- Devolver los 8 articulos a MIL ROLLOS, por id exacto
update public.inventario
   set proveedor = 'MIL ROLLOS'
 where id in (82, 83, 85, 86, 87, 88, 121, 123)
   and proveedor = 'Lipiner S.A.';

-- Las fichas de reposicion que se hayan renombrado NO se revierten:
-- no queda registro de cual venia de MIL ROLLOS. Al 02/09/2026 la unica
-- ficha existente (articulo 84) ya era de Lipiner, asi que no hay nada
-- que devolver.

commit;

select 'inventario con MIL ROLLOS (debe ser 8)' as que, count(*)::text as valor
  from public.inventario where proveedor = 'MIL ROLLOS'
union all
select 'maestro MIL ROLLOS (debe ser 1)', count(*)::text
  from public.proveedores where empresa = 'MIL ROLLOS';
