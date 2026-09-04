-- ============================================================
--  FUSION DE PROVEEDOR
--  "Diamaler S.A." (ficha id 42) es la misma empresa que
--  "MULTIPACK" (ficha id 57, titular).
--
--  Todo lo que hoy figura a nombre de "Diamaler S.A." pasa a
--  "MULTIPACK" y la ficha duplicada se elimina.
--
--  Estado leido de la base el 2026-09-04 (antes de correr):
--    proveedores    : 2 fichas (id 42 Diamaler S.A., id 57 MULTIPACK)
--                     Diamaler aporta calidad='BUENA' y
--                     condicion_pago='30 DIAS'; MULTIPACK esta vacia.
--    precios        : 4 filas de "Diamaler S.A." -> ids 89,90,91,92
--                     (codigos 221955, 221954, 221953, 221963)
--                     MULTIPACK no tiene ninguna -> queda con 4
--    inventario     : 6 filas, TODAS ya con proveedor = "MULTIPACK"
--                     (ids 63..68, codigos 221953..221955 y 221963..221965)
--                     0 filas con proveedor_sugerido de cualquiera de los dos
--    pedidos        : 4 filas de "Diamaler S.A." -> ids 299,300,301,302
--                     (todas de la OC 704) -> MULTIPACK queda con 4
--    pedidos_varios : 0 filas
--    art_proveedor  : 6 filas -> ids 33,35 ya en "MULTIPACK";
--                     ids 34,36,37,38 en "Diamaler S.A."
--    Sin menciones en contingencia, entregas, pedidos_varios_items,
--    mp_proveedores, mp_articulos ni imp_articulos.
--    Sin menciones en descripciones/observaciones de ninguna tabla.
--
--  NOTA 1: no hay articulos repetidos que fusionar. Los 4 precios de
--  Diamaler son de codigos que MULTIPACK no tiene, asi que se conservan
--  las 4 filas.
--
--  NOTA 2: esto ademas arregla una inconsistencia que hoy existe. Las 6
--  filas de inventario dicen "MULTIPACK", pero 4 de sus configuraciones
--  de reposicion (art_proveedor 34,36,37,38) estaban guardadas contra
--  "Diamaler S.A.", asi que la demora de 90 dias no coincidia con el
--  proveedor del articulo. Despues de la fusion los 6 quedan alineados.
--  No hay riesgo de chocar con el unique (inventario_id, proveedor):
--  las 6 filas apuntan a inventario_id distintos (63..68).
--
--  Idempotente: se puede correr mas de una vez sin efecto extra.
--  Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- ============================================================

begin;

-- ── 1) Precios ──────────────────────────────────────────────
update public.precios
   set proveedor = 'MULTIPACK'
 where proveedor ilike '%diamaler%';

-- ── 2) Inventario (proveedor y proveedor sugerido) ──────────
--     Hoy dan 0 filas; van igual por si se cargo algo en el medio.
update public.inventario
   set proveedor = 'MULTIPACK'
 where proveedor ilike '%diamaler%';

update public.inventario
   set proveedor_sugerido = 'MULTIPACK'
 where proveedor_sugerido ilike '%diamaler%';

-- ── 3) Pedidos y pedidos varios ─────────────────────────────
update public.pedidos
   set proveedor = 'MULTIPACK'
 where proveedor ilike '%diamaler%';

update public.pedidos_varios
   set proveedor = 'MULTIPACK'
 where proveedor ilike '%diamaler%';

-- ── 4) Reposicion por articulo ──────────────────────────────
--     Primero se borra cualquier fila de Diamaler que chocaria con una
--     de MULTIPACK del mismo articulo (hoy no hay ninguna, pero el
--     unique (inventario_id, proveedor) abortaria el update entero).
delete from public.art_proveedor d
 where d.proveedor ilike '%diamaler%'
   and exists (
     select 1 from public.art_proveedor m
      where m.inventario_id = d.inventario_id
        and m.proveedor = 'MULTIPACK'
   );

update public.art_proveedor
   set proveedor = 'MULTIPACK'
 where proveedor ilike '%diamaler%';

-- ── 5) Maestro: la ficha titular se queda con los datos que le faltan ──
--     (la ficha vieja aportaba calidad 'BUENA' y condicion de pago '30 DIAS')
update public.proveedores t
   set nombre_contacto = coalesce(t.nombre_contacto, v.nombre_contacto),
       puesto          = coalesce(t.puesto,          v.puesto),
       email           = coalesce(t.email,           v.email),
       celular         = coalesce(t.celular,         v.celular),
       telefono        = coalesce(t.telefono,        v.telefono),
       rut             = coalesce(t.rut,             v.rut),
       condicion_pago  = coalesce(t.condicion_pago,  v.condicion_pago),
       rubro           = coalesce(t.rubro,           v.rubro),
       direccion       = coalesce(t.direccion,       v.direccion),
       calidad         = coalesce(t.calidad,         v.calidad)
  from public.proveedores v
 where t.empresa = 'MULTIPACK'
   and v.empresa ilike '%diamaler%';

-- Deja constancia de la fusion en la ficha titular
update public.proveedores
   set observaciones = case
         when coalesce(observaciones, '') = ''
           then 'Antes figuraba tambien como "Diamaler S.A." (misma empresa).'
         else observaciones || ' | Antes figuraba tambien como "Diamaler S.A." (misma empresa).'
       end
 where empresa = 'MULTIPACK'
   and coalesce(observaciones, '') not ilike '%diamaler%';

-- ── 6) Baja de la ficha duplicada ───────────────────────────
delete from public.proveedores
 where empresa ilike '%diamaler%';

commit;

-- ============================================================
--  VERIFICACION (los "esperado 0" tienen que dar 0)
-- ============================================================
select 'proveedores con Diamaler   (esperado 0)' as chequeo, count(*) as filas from public.proveedores  where empresa ilike '%diamaler%'
union all
select 'precios con Diamaler       (esperado 0)',  count(*) from public.precios       where proveedor ilike '%diamaler%'
union all
select 'inventario con Diamaler    (esperado 0)',  count(*) from public.inventario    where proveedor ilike '%diamaler%' or proveedor_sugerido ilike '%diamaler%'
union all
select 'pedidos con Diamaler       (esperado 0)',  count(*) from public.pedidos       where proveedor ilike '%diamaler%'
union all
select 'art_proveedor con Diamaler (esperado 0)',  count(*) from public.art_proveedor where proveedor ilike '%diamaler%'
union all
select 'precios de MULTIPACK       (esperado 4)',  count(*) from public.precios       where proveedor = 'MULTIPACK'
union all
select 'inventario de MULTIPACK    (esperado 6)',  count(*) from public.inventario    where proveedor = 'MULTIPACK'
union all
select 'pedidos de MULTIPACK       (esperado 4)',  count(*) from public.pedidos       where proveedor = 'MULTIPACK'
union all
select 'art_proveedor de MULTIPACK (esperado 6)',  count(*) from public.art_proveedor where proveedor = 'MULTIPACK'
union all
select 'fichas de MULTIPACK        (esperado 1)',  count(*) from public.proveedores   where empresa = 'MULTIPACK';

-- ============================================================
--  ROLLBACK (solo si hay que volver atras — descomentar y correr)
-- ============================================================
-- begin;
-- update public.precios       set proveedor = 'Diamaler S.A.' where id in (89,90,91,92);
-- update public.pedidos       set proveedor = 'Diamaler S.A.' where id in (299,300,301,302);
-- update public.art_proveedor set proveedor = 'Diamaler S.A.' where id in (34,36,37,38);
-- update public.proveedores   set calidad = null, condicion_pago = null, observaciones = null where empresa = 'MULTIPACK';
-- insert into public.proveedores (empresa, calidad, condicion_pago)
--   values ('Diamaler S.A.', 'BUENA', '30 DIAS');
-- commit;
