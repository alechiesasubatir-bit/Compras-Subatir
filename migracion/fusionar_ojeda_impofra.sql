-- ============================================================
--  FUSION DE PROVEEDOR
--  "Nicolás Ojeda" (ficha id 14) es la misma empresa que
--  "Impofra S.A.S" (ficha id 51, titular). Mismo contacto
--  (Nicolás Ojeda) y mismo celular (099 656 323).
--
--  Todo lo que hoy figura a nombre de "Nicolás Ojeda" pasa a
--  "Impofra S.A.S" y la ficha duplicada se elimina.
--
--  Estado leido de la base el 2026-08-21 (antes de correr):
--    proveedores  : 2 fichas (id 14 Nicolás Ojeda, id 51 Impofra S.A.S)
--    precios      : 11 filas de "Nicolás Ojeda"
--                   ids 33,96,98,100,124,184,185,186,187,188,198
--                   (Impofra ya tenia 1 fila -> queda con 12)
--    inventario   : 10 filas con proveedor = "Nicolás Ojeda"
--                   ids 20,71,95,96,130,131,132,134,135,142
--                   (131 y 135 ya tenian proveedor_sugerido = Impofra)
--    pedidos      : 0 filas
--    pedidos_varios: 0 filas
--    Sin menciones en descripciones/observaciones de ninguna tabla.
--
--  NOTA: no hay articulos repetidos que fusionar. Los codigos que
--  comparten Ojeda e Impofra (220135, 220132) son variantes distintas
--  ("Valvula Crema rosca 28" vs ".../400 corta", "Tapas Alcoa rosca 28"
--  vs "... corta"), asi que se conservan todas las filas de precios.
--
--  Idempotente: se puede correr mas de una vez sin efecto extra.
--  Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- ============================================================

begin;

-- ── 1) Precios ──────────────────────────────────────────────
update public.precios
   set proveedor = 'Impofra S.A.S'
 where proveedor in ('Nicolás Ojeda', 'Nicolas Ojeda', 'NICOLAS OJEDA');

-- ── 2) Inventario (proveedor y proveedor sugerido) ──────────
update public.inventario
   set proveedor = 'Impofra S.A.S'
 where proveedor in ('Nicolás Ojeda', 'Nicolas Ojeda', 'NICOLAS OJEDA');

update public.inventario
   set proveedor_sugerido = 'Impofra S.A.S'
 where proveedor_sugerido in ('Nicolás Ojeda', 'Nicolas Ojeda', 'NICOLAS OJEDA');

-- ── 3) Pedidos y pedidos varios ─────────────────────────────
--     Hoy dan 0 filas; van igual por si se cargo algo en el medio.
update public.pedidos
   set proveedor = 'Impofra S.A.S'
 where proveedor in ('Nicolás Ojeda', 'Nicolas Ojeda', 'NICOLAS OJEDA');

update public.pedidos_varios
   set proveedor = 'Impofra S.A.S'
 where proveedor in ('Nicolás Ojeda', 'Nicolas Ojeda', 'NICOLAS OJEDA');

-- ── 4) Maestro: la ficha titular se queda con los datos que le faltan ──
--     (la ficha vieja aportaba el puesto "Director")
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
 where t.empresa = 'Impofra S.A.S'
   and v.empresa in ('Nicolás Ojeda', 'Nicolas Ojeda', 'NICOLAS OJEDA');

-- Deja constancia de la fusion en la ficha titular
update public.proveedores
   set observaciones = case
         when coalesce(observaciones, '') = ''
           then 'Antes figuraba tambien como "Nicolás Ojeda" (misma empresa, titular Impofra).'
         else observaciones || ' | Antes figuraba tambien como "Nicolás Ojeda" (misma empresa, titular Impofra).'
       end
 where empresa = 'Impofra S.A.S'
   and coalesce(observaciones, '') not like '%Ojeda%';

-- ── 5) Baja de la ficha duplicada ───────────────────────────
delete from public.proveedores
 where empresa in ('Nicolás Ojeda', 'Nicolas Ojeda', 'NICOLAS OJEDA');

commit;

-- ============================================================
--  VERIFICACION (deberia quedar todo en 0 salvo los de Impofra)
-- ============================================================
select 'proveedores con Ojeda   (esperado 0)'  as chequeo, count(*) as filas from public.proveedores where empresa ilike '%ojeda%'
union all
select 'precios con Ojeda       (esperado 0)',  count(*) from public.precios     where proveedor ilike '%ojeda%'
union all
select 'inventario con Ojeda    (esperado 0)',  count(*) from public.inventario  where proveedor ilike '%ojeda%' or proveedor_sugerido ilike '%ojeda%'
union all
select 'pedidos con Ojeda       (esperado 0)',  count(*) from public.pedidos     where proveedor ilike '%ojeda%'
union all
select 'precios de Impofra     (esperado 12)',  count(*) from public.precios     where proveedor = 'Impofra S.A.S'
union all
select 'inventario de Impofra  (esperado 10)',  count(*) from public.inventario  where proveedor = 'Impofra S.A.S'
union all
select 'fichas de Impofra       (esperado 1)',  count(*) from public.proveedores where empresa = 'Impofra S.A.S';

-- ============================================================
--  ROLLBACK (solo si hay que volver atras — descomentar y correr)
-- ============================================================
-- begin;
-- update public.precios    set proveedor = 'Nicolás Ojeda' where id in (33,96,98,100,124,184,185,186,187,188,198);
-- update public.inventario set proveedor = 'Nicolás Ojeda' where id in (20,71,95,96,130,131,132,134,135,142);
-- update public.proveedores set puesto = null, observaciones = null where empresa = 'Impofra S.A.S';
-- insert into public.proveedores (empresa, nombre_contacto, puesto, celular)
--   values ('Nicolás Ojeda', 'Nicolas Ojeda', 'Director', '099 656 323');
-- commit;
