-- ============================================================
--  Rollback de varios_orden_compra.sql
--
--  OJO: borrar las columnas se lleva los numeros de orden ya emitidos.
--  Si alguna orden ya salio impresa y esta en manos de un proveedor,
--  ese numero deja de existir en el sistema. Mirar el select de abajo
--  ANTES de correr esto.
-- ============================================================

-- Cuantas ordenes se perderian
select count(*) as ordenes_emitidas_que_se_pierden
  from public.pedidos_varios where orden_nro is not null;

drop function if exists public.varios_emitir_orden(bigint);
drop index if exists public.pedidos_varios_orden_nro_uk;
alter table public.pedidos_varios
  drop column if exists orden_nro,
  drop column if exists orden_fecha;
drop sequence if exists public.pedidos_varios_orden_seq;
