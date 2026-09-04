-- ============================================================
--  FICHA DUPLICADA: "Wurth Uruguay S.A"
--
--  Las fichas id 68 y id 69 son la misma empresa, con el MISMO
--  nombre exacto ("Wurth Uruguay S.A", 17 caracteres, sin espacios
--  de sobra ni diferencias de mayusculas) y los mismos datos:
--    rut     = 212053400018
--    celular = 099 310 338
--    todo el resto en null en las dos.
--
--  Comparadas campo por campo el 2026-09-04: no hay UNA sola
--  diferencia fuera de id/created_at/updated_at. Nada que fusionar:
--  sobra una fila y se borra.
--
--  Como todas las tablas referencian al proveedor POR NOMBRE y las dos
--  fichas tienen el mismo nombre, no hay que migrar ningun dato:
--    pedidos_varios : 1 fila (#13) que sigue diciendo lo mismo
--    precios / inventario / pedidos / art_proveedor / contingencia /
--    entregas : 0 filas
--
--  Se conserva la id 68 (la primera, creada 19:03:48) y se borra la
--  id 69 (creada 56 segundos despues por el bug de varios.html).
--
--  Idempotente: si ya quedo una sola ficha, no hace nada.
--  Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- ============================================================

begin;

-- Borra las fichas repetidas de Wurth dejando SOLO la de id mas bajo.
-- Escrito asi (y no "delete where id = 69") para que sea idempotente y
-- para que no borre nada si alguien ya arreglo la ficha a mano.
delete from public.proveedores d
 where d.empresa ilike '%wurth%'
   and exists (
     select 1 from public.proveedores m
      where m.empresa = d.empresa
        and m.id < d.id
   );

commit;

-- ============================================================
--  VERIFICACION
-- ============================================================
select 'fichas de Wurth (esperado 1)' as chequeo, count(*) as filas
  from public.proveedores where empresa ilike '%wurth%';

select id, empresa, rut, celular from public.proveedores where empresa ilike '%wurth%';

-- ============================================================
--  ROLLBACK (solo si hay que volver atras — descomentar y correr)
-- ============================================================
-- insert into public.proveedores (empresa, rut, celular)
--   values ('Wurth Uruguay S.A', '212053400018', '099 310 338');
