-- ============================================================
--  PREVISION CLORO  ·  colgar las materias primas del inventario real
--
--  Las materias primas del modulo eran una lista propia de cinco nombres
--  puestos a mano al crearlo, sin stock y sin cruce con nada. El stock
--  real ya vive en `inventario`, marcado con ext_id='MP' (79 filas).
--
--  EL VINCULO ES POR ID, NO POR CODIGO. El codigo 218851 tiene DOS filas
--  en inventario -"Pastilla Triple Accion", con 2.275 kg cargados, y
--  "Pastilla Triple Accion (3 unidades)", vacia-, asi que un join por
--  codigo devolveria dos y contaria el stock dos veces.
--
--  Correr DESPUES de cloro_stock_fecha.sql y ANTES de
--  cloro_carga_planilla.sql.
-- ============================================================

-- 1) La columna, con unico: dos materias colgadas del mismo articulo
--    contarian su stock dos veces y las dos dirian que estan cubiertas.
alter table public.cl_materias
  add column if not exists inventario_id bigint
  references public.inventario(id) on delete set null;

create unique index if not exists ux_cl_materias_inventario
  on public.cl_materias(inventario_id) where inventario_id is not null;

-- 2) Las dos materias inventadas que SI tienen contraparte real. Se
--    reutilizan en vez de crearse de nuevo: la fila del carbonato es la
--    unica que ya tenia un producto asignado (Regulador PH MAS x 2 Kg),
--    y borrarla lo dejaria huerfano.
update public.cl_materias
   set nombre = 'Ceniza de soda (PH+)',
       inventario_id = (select id from public.inventario
                         where codigo = '220043' and ext_id = 'MP')
 where nombre = 'Carbonato de sodio (pH+)';

update public.cl_materias
   set nombre = 'Metabisulfito ( PH-)',
       inventario_id = (select id from public.inventario
                         where codigo = '220111' and ext_id = 'MP')
 where nombre = 'Bisulfato de sodio (pH-)';

-- 3) Las tres que no existen en el inventario con ese nombre. Se
--    DESACTIVAN, no se borran: ningun producto las referencia, pero
--    desactivar es reversible y borrar no.
update public.cl_materias set activo = false
 where nombre in ('Dicloro', 'Tricloro', 'Hipoclorito de calcio');

-- 4) Las cuatro que faltan, ya vinculadas. Para la Pastilla Triple
--    Accion se desempata por descripcion exacta: es la fila que tiene el
--    stock cargado, no la de "(3 unidades)", que esta vacia.
insert into public.cl_materias (nombre, inventario_id)
select i.descripcion, i.id
  from public.inventario i
 where i.ext_id = 'MP'
   and (i.codigo, i.descripcion) in (
        ('334101',   'Cloro Granulado'),
        ('21550000', 'Cloro Shock'),
        ('218851',   'Pastilla Triple Accion'),
        ('220156',   'Pastillas Cloro JACUZZI 50 Grs'))
   and not exists (select 1 from public.cl_materias m where m.inventario_id = i.id);

-- 5) Control que FALLA si algo no resolvio. Un vinculo que quedo en null
--    sin que nadie se entere es una materia que dice "sin stock" para
--    siempre, y una compra de toneladas decidida sobre eso.
do $$
declare n int;
begin
  select count(*) into n from public.cl_materias where activo and inventario_id is null;
  if n > 0 then
    raise exception 'Quedaron % materias activas sin vincular al inventario', n;
  end if;
  select count(*) into n from public.cl_materias where activo;
  if n <> 6 then
    raise exception 'Se esperaban 6 materias activas y hay %', n;
  end if;
end $$;

-- 6) Como quedaron
select m.id, m.nombre, i.codigo, i.descripcion, i.unidad, i.inventario as stock
  from public.cl_materias m
  left join public.inventario i on i.id = m.inventario_id
 where m.activo
 order by m.nombre;
