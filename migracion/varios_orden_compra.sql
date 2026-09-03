-- ============================================================
--  Pedidos Varios: poder emitir una orden de compra formal.
--
--  Algunos proveedores piden el papel. Hasta ahora un pedido vario no
--  tenia forma de generarlo: habia que cargarlo como OC normal, que es
--  justo lo que Pedidos Varios existe para evitar (ensucia stock,
--  precios y reportes con compras que no tienen articulo en el maestro).
--
--  La orden queda DENTRO del pedido vario. No toca la tabla pedidos ni
--  aparece en la pantalla de Pedidos.
--
--  Correr en Supabase -> SQL Editor.
-- ============================================================

-- 1 . Los dos datos de la orden, vacios mientras no se emita
alter table public.pedidos_varios
  add column if not exists orden_nro   text,
  add column if not exists orden_fecha date;

-- Un numero no puede repartirse dos veces
create unique index if not exists pedidos_varios_orden_nro_uk
  on public.pedidos_varios (orden_nro) where orden_nro is not null;

-- 2 . Serie propia: V-001, V-002...
--  Va con secuencia y no con max(orden_nro)+1 a proposito: si dos
--  personas emiten al mismo tiempo, el max() les da el MISMO numero a
--  las dos y una de las dos ordenes sale con el numero de la otra.
--  La secuencia es atomica y no se puede repetir.
create sequence if not exists public.pedidos_varios_orden_seq as bigint start 1;

-- 3 . Emitir: asigna numero y fecha, y devuelve la fila ya actualizada.
--  Si el pedido YA tiene orden, no la reemplaza: devuelve la que tiene.
--  Emitir dos veces el mismo pedido tiene que dar el mismo papel, no un
--  numero nuevo cada vez que alguien toca el boton.
create or replace function public.varios_emitir_orden(p_id bigint)
returns public.pedidos_varios
language plpgsql
security invoker            -- respeta la RLS de quien llama, a proposito
as $$
declare
  fila public.pedidos_varios;
begin
  select * into fila from public.pedidos_varios where id = p_id;
  if not found then
    raise exception 'No existe el pedido vario %', p_id;
  end if;

  if fila.orden_nro is not null then
    return fila;                                  -- ya emitida
  end if;

  update public.pedidos_varios
     set orden_nro   = 'V-' || lpad(nextval('public.pedidos_varios_orden_seq')::text, 3, '0'),
         orden_fecha = current_date
   where id = p_id
   returning * into fila;

  return fila;
end $$;

-- Que la app pueda llamarla
grant execute on function public.varios_emitir_orden(bigint) to authenticated;
grant usage on sequence public.pedidos_varios_orden_seq to authenticated;

-- ── Verificacion ───────────────────────────────────────────────────
select 'columnas nuevas (debe ser 2)' as que, count(*)::text as valor
  from information_schema.columns
 where table_schema = 'public' and table_name = 'pedidos_varios'
   and column_name in ('orden_nro','orden_fecha')
union all
select 'indice unico (debe ser 1)', count(*)::text
  from pg_indexes
 where schemaname = 'public' and indexname = 'pedidos_varios_orden_nro_uk'
union all
select 'secuencia (debe ser 1)', count(*)::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'S' and n.nspname = 'public'
   and c.relname = 'pedidos_varios_orden_seq'
union all
select 'funcion varios_emitir_orden (debe ser 1)', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'varios_emitir_orden'
union all
select 'pedidos varios con orden emitida', count(*)::text
  from public.pedidos_varios where orden_nro is not null;

-- Esperado:
--   columnas nuevas                    2
--   indice unico                       1
--   secuencia                          1
--   funcion varios_emitir_orden        1
--   pedidos varios con orden emitida   0   (todavia no se emitio ninguna)
