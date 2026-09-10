-- ============================================================
--  PREVISION CLORO  ·  que la pantalla se entere sola de los cambios
--
--  Prevision Cloro era el unico modulo sin suscripcion a Realtime: con
--  la pantalla abierta, un conteo cargado desde Stock o una venta
--  importada por otro no aparecian hasta recargar. Para un modulo donde
--  dos personas miran mientras una tercera cuenta, eso no alcanza.
--
--  `inventario` ya estaba en la publicacion (ver realtime.sql); esto
--  agrega las tablas propias del modulo.
--
--  Si alguna ya estaba, el ALTER da "already member of publication".
--  Es inofensivo: segui con el resto.
-- ============================================================

alter publication supabase_realtime add table public.cl_ventas;
alter publication supabase_realtime add table public.cl_envasado;
alter publication supabase_realtime add table public.cl_stock_inicial;
alter publication supabase_realtime add table public.cl_parametros;

-- Para que los UPDATE/DELETE manden la fila completa. Con RLS activo
-- mejora la propagacion de cambios sobre filas que ya existian.
alter table public.cl_ventas        replica identity full;
alter table public.cl_envasado      replica identity full;
alter table public.cl_stock_inicial replica identity full;
alter table public.cl_parametros    replica identity full;

-- Control: las tablas del modulo que quedaron publicadas.
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename like 'cl\_%'
 order by tablename;
