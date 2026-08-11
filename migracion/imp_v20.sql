-- ============================================================
--  imp_v20 · Qué artículo trae cada pedido
--
--  "Mis pedidos y su avance" mostraba cuántos pallets y cuántas
--  unidades, pero no QUÉ. El solicitante pidió un artículo, no un
--  pallet: eso es lo que quiere ver primero al mirar el avance.
--
--  Se agrega la columna `articulos` al resumen: un array jsonb con
--  una entrada por artículo del pedido, de mayor a menor cantidad:
--    [{"art":"BOTELLA VERDE 500 ML","cod":"BV500","un":2880,"pal":2}, ...]
--  Así la pantalla lo resuelve en la misma consulta que ya hacía,
--  sin una vuelta más por cada pedido.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

create or replace view public.imp_solicitud_resumen
with (security_invoker = true) as
select s.*,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as items,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado = 'ENTREGADO') as entregados,
       (select coalesce(sum(p.unidades),0) from public.imp_solicitud_items i
         join public.imp_pallets p on p.id = i.pallet_id
        where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as unidades,
       -- Un pedido puede mezclar artículos: se agrupan y se ordenan por
       -- cantidad, para que la pantalla muestre grande el que pesa más.
       (select coalesce(jsonb_agg(to_jsonb(x) order by x.un desc), '[]'::jsonb)
          from (
            select coalesce(a.descripcion, '(sin artículo)') as art,
                   a.codigo                                  as cod,
                   sum(p.unidades)                           as un,
                   count(*)                                  as pal
              from public.imp_solicitud_items i
              join public.imp_pallets p        on p.id = i.pallet_id
              left join public.imp_articulos a on a.id = p.articulo_id
             where i.solicitud_id = s.id and i.estado <> 'CANCELADO'
             group by a.descripcion, a.codigo
          ) x
       ) as articulos
  from public.imp_solicitudes s;

-- Verificación: los últimos pedidos con su detalle de artículos.
select id, estado, origen, destino, items, unidades, articulos
  from public.imp_solicitud_resumen
 order by created_at desc
 limit 5;
