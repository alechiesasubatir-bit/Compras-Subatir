-- ============================================================
--  PREVISION CLORO  ·  materia prima y kg por unidad de los 13 productos
--
--  Sale de la planilla que aporto el usuario (Planilla.xlsx). TRES
--  valores NO son los que traia la planilla; se corrigieron con el antes
--  de cargarlos:
--
--   · 2150950 para el Cloro Shock 900 g. La planilla decia 215050, que
--     no existe. El nombre coincide exacto y el patron de los hermanos
--     lo confirma (2150250 = 240 g).
--   · 220156 para la Pastilla Jacuzzi. La planilla decia 220176, que no
--     esta en el inventario; el articulo real es "Pastillas Cloro
--     JACUZZI 50 Grs".
--   · 0,25 kg para la Pastilla Jacuzzi, no 0,125: son 5 pastillas de
--     50 g. Con 0,125 el modulo habria pedido la MITAD de la materia
--     prima necesaria.
--
--  Correr DESPUES de cloro_materia_inventario.sql.
-- ============================================================

update public.cl_productos p
   set kg_mp_por_unidad = v.kgu,
       materia_id       = m.id
  from (values
         ('21420',   4.0,   '334101'),
         ('21421',   25.0,  '334101'),
         ('2150250', 0.24,  '21550000'),
         ('2150950', 0.9,   '21550000'),
         ('2153500', 3.5,   '21550000'),
         ('218801',  1.0,   '218851'),
         ('218803',  0.6,   '218851'),
         ('218804',  4.0,   '218851'),
         ('218825',  25.0,  '218851'),
         ('218905',  0.25,  '220156'),
         ('219727',  2.0,   '220043'),
         ('219729',  4.0,   '220111'),
         ('230137',  25.0,  '21550000')
       ) as v(codigo, kgu, cod_mp)
  join public.inventario  i on i.codigo = v.cod_mp and i.ext_id = 'MP'
  join public.cl_materias m on m.inventario_id = i.id
 where p.codigo = v.codigo;

-- El join contra cl_materias.inventario_id es lo que desempata el 218851
-- duplicado: de sus dos filas de inventario, solo una tiene una materia
-- colgada, asi que la otra se cae sola.

do $$
declare n int;
begin
  select count(*) into n from public.cl_productos
   where activo and (materia_id is null or coalesce(kg_mp_por_unidad, 0) <= 0);
  if n > 0 then
    raise exception 'Quedaron % productos activos sin materia prima o sin kg por unidad', n;
  end if;
end $$;

select p.codigo, p.nombre, p.kg_mp_por_unidad, m.nombre as materia,
       i.codigo as cod_mp, i.inventario as stock_mp
  from public.cl_productos p
  left join public.cl_materias m on m.id = p.materia_id
  left join public.inventario  i on i.id = m.inventario_id
 order by p.codigo;
