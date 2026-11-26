-- ============================================================
--  TAPAS ALCOA ROSCA 28 CORTA: DOS FICHAS CON EL MISMO NOMBRE  ·  26/11/2026
--
--  EL PROBLEMA
--  El inventario tenía dos fichas llamadas igual:
--    132  Impofra S.A.S   código 220132  caja 5.500  stock 43.000
--    133  Green Oil S.A.  sin código     caja 6.300  stock 21.000
--  Las OC 926 (01/09) y 958 (23/09), 22.000 tapas cada una, no tenían la
--  ficha anotada. Al recibirlas, la suma al stock buscó por nombre,
--  encontró DOS fichas iguales y no sumó a ninguna ("Cargalo a mano en
--  Stock"). Nadie lo cargó: ninguna de las dos fichas cambió desde el
--  21/08. Las 44.000 tapas recibidas nunca entraron al stock.
--
--  QUÉ HACE  (decidido el 26/11: es el mismo producto)
--  1. Ata las OC 926 y 958 a la ficha 132, para que el historial y el
--     tránsito no dependan del nombre.
--  2. Borra la ficha 133. Nada la referencia (ni OC, ni reposición,
--     ni Calidad MP, ni cloro), verificado el 26/11.
--
--  EL STOCK NO SE TOCA: la 132 queda con 43.000 hasta que se cuenten las
--  tapas con el Control de Stock. Ese conteo es el número real.
--
--  Correr en Supabase → SQL Editor, de una sola vez.
-- ============================================================

begin;

-- Antes
select id, codigo, descripcion, proveedor, presentacion, inventario
  from public.inventario where id in (132, 133) order by id;

-- 1. Las dos OC, atadas a la ficha que queda
update public.pedidos set inventario_id = 132
 where id in (665, 725) and inventario_id is null
   and descripcion ilike 'Tapas Alcoa Rosca 28 corta';

-- 2. La ficha repetida, sólo si sigue sin nada que la use
delete from public.inventario i
 where i.id = 133
   and i.descripcion = 'Tapas Alcoa rosca 28 CORTA'
   and not exists (select 1 from public.pedidos       where inventario_id = 133)
   and not exists (select 1 from public.art_proveedor where inventario_id = 133)
   and not exists (select 1 from public.cl_materias   where inventario_id = 133)
   and not exists (select 1 from public.mp_documentos where inventario_id = 133);

-- Después: tiene que quedar UNA ficha y las dos OC con inventario_id = 132
select 'ficha' as que, id::text, descripcion, inventario::text as dato
  from public.inventario where descripcion ilike 'Tapas Alcoa rosca 28 CORTA'
union all
select 'OC ' || n_orden, id::text, descripcion, coalesce(inventario_id::text, '(sin ficha)')
  from public.pedidos where id in (665, 725);

commit;
