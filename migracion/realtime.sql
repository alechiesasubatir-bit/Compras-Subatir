-- ============================================================
--  Habilitar Supabase Realtime en las tablas de la app
--  Correr UNA vez en Supabase → SQL Editor.
--  Después de esto, los módulos se actualizan solos cuando
--  cambian los datos (sin apretar "Actualizar").
-- ============================================================

-- Agregar las tablas a la publicación de Realtime
alter publication supabase_realtime add table public.pedidos;
alter publication supabase_realtime add table public.precios;
alter publication supabase_realtime add table public.inventario;
alter publication supabase_realtime add table public.contingencia;
alter publication supabase_realtime add table public.proveedores;
alter publication supabase_realtime add table public.profiles;

-- (Opcional) Para que los UPDATE/DELETE envíen la fila completa por Realtime.
-- Con RLS activo, mejora la propagación de cambios de filas existentes.
alter table public.pedidos      replica identity full;
alter table public.precios      replica identity full;
alter table public.inventario   replica identity full;
alter table public.contingencia replica identity full;
alter table public.proveedores  replica identity full;
alter table public.profiles     replica identity full;

-- Nota: si alguna tabla ya estaba en la publicación, ese ALTER puede dar
-- error "already member of publication" — es inofensivo, seguí con el resto.
