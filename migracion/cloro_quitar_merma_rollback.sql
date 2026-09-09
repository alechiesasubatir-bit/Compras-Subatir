-- Vuelve a poner cl_productos.merma_pct, en 0 para todos.
--
-- Los valores que hubiera antes del drop NO vuelven: la columna se
-- recrea vacía. Recrearla sola tampoco alcanza para que la merma
-- funcione de nuevo — hay que revertir además el commit que la sacó de
-- cloro.html y cloro-calc.js, o la columna queda ahí sin que nadie la
-- lea ni la escriba.
alter table public.cl_productos
  add column if not exists merma_pct numeric not null default 0;

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'cl_productos'
 order by ordinal_position;
