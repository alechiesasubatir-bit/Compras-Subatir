-- ============================================================
--  ENTREGAS REGISTRADAS DOS Y TRES VECES  ·  26/11/2026
--
--  EL PROBLEMA
--  Recepción dejaba el formulario abierto y el botón "Registrar"
--  habilitado mientras sumaba al stock. Parecía que no se había
--  guardado y se volvía a tocar: la misma entrega quedó cargada
--  2 y 3 veces, con 1 a 7 segundos de diferencia, misma persona,
--  misma cantidad y mismo lote:
--
--    OC 1006  Alcohol Isopropilico   800 L     entregas 287 y 288
--    OC 1021  EDTA Tetrasodico       100 Kg    entregas 315, 316 y 317
--    OC 1023  Metabisulfito         2000 Kg    entregas 322 y 323
--    OC 1046  Botella Pet 500 mL    2992 un.   entregas 385 y 386
--
--  Esas líneas figuran recibidas al doble / triple (Recepción,
--  Pedidos, Informes). El código ya está corregido (recepcion-calc.js):
--  esto limpia lo que quedó.
--
--  QUÉ HACE
--  Borra las copias (288, 316, 317, 323, 386) y deja la primera de
--  cada una. Sólo si siguen siendo copias exactas de la primera: si
--  alguien las tocó desde que se escribió esto, no borra nada.
--  El trigger trg_entregas_sync recalcula la línea solo; las cuatro
--  siguen completas (lo que queda = lo pedido).
--
--  EL STOCK NO SE TOCA. Hoy esas fichas muestran 2.992 botellas,
--  1.000 L de alcohol, 1.000 Kg de metabisulfito y 150 Kg de EDTA:
--  no se ve el doble sumado, así que algo (consumo, conteo) ya lo
--  corrigió. Si un conteo dice otra cosa, se ajusta desde Stock.
--
--  Correr en Supabase → SQL Editor, de una sola vez.
-- ============================================================

begin;

-- Antes: cuánto figura recibido en cada línea
select p.n_orden, p.cantidad as pedida, sum(e.cantidad) as recibida, count(*) as entregas
  from public.pedidos p join public.entregas e on e.pedido_id = p.id
 where p.id in (836, 870, 872, 924)
 group by p.n_orden, p.cantidad order by p.n_orden;

with copia(dup, original) as (
  values (288, 287), (316, 315), (317, 315), (323, 322), (386, 385)
)
delete from public.entregas d
 using copia c, public.entregas o
 where d.id = c.dup and o.id = c.original
   and d.pedido_id = o.pedido_id
   and d.cantidad  = o.cantidad
   and coalesce(d.lote, '')  = coalesce(o.lote, '')
   and d.fecha     = o.fecha
   and d.created_at - o.created_at between interval '0 seconds' and interval '1 minute';

-- Después: tiene que dar recibida = pedida y 1 entrega en las cuatro
select p.n_orden, p.cantidad as pedida, sum(e.cantidad) as recibida, count(*) as entregas,
       coalesce(p.f_recepcion::text, '(sin fecha)') as f_recepcion
  from public.pedidos p join public.entregas e on e.pedido_id = p.id
 where p.id in (836, 870, 872, 924)
 group by p.n_orden, p.cantidad, p.f_recepcion order by p.n_orden;

commit;
