-- Vuelve el modulo a su lista propia de materias primas.
--
-- Los kg por unidad de los productos NO se borran: son un dato bueno que
-- no depende del vinculo, y volver a ponerlos en cero seria perder
-- trabajo por nada. Los materia_id si se caen solos por el
-- `on delete set null` al borrar las materias nuevas.
delete from public.cl_materias
 where inventario_id is not null
   and nombre in ('Cloro Granulado', 'Cloro Shock', 'Pastilla Triple Accion',
                  'Pastillas Cloro JACUZZI 50 Grs');

update public.cl_materias set nombre = 'Carbonato de sodio (pH+)', inventario_id = null
 where nombre = 'Ceniza de soda (PH+)';
update public.cl_materias set nombre = 'Bisulfato de sodio (pH-)', inventario_id = null
 where nombre = 'Metabisulfito ( PH-)';
update public.cl_materias set activo = true
 where nombre in ('Dicloro', 'Tricloro', 'Hipoclorito de calcio');

drop index if exists public.ux_cl_materias_inventario;
alter table public.cl_materias drop column if exists inventario_id;

update public.inventario set unidad = 'g' where codigo = '220156' and unidad = 'Kg';

-- La fecha del conteo se va con la columna. OJO: sin ella el modulo
-- vuelve a suponer que el stock es de la semana 1, que es el bug que
-- motivo todo esto.
alter table public.cl_stock_inicial drop column if exists fecha;

select m.id, m.nombre, m.activo from public.cl_materias m order by m.id;
