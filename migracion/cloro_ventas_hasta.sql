-- ============================================================
--  PREVISION CLORO  ·  hasta que dia estan cargadas las ventas
--
--  `cl_ventas` guarda las ventas AGREGADAS POR SEMANA, asi que la fecha
--  de la ultima factura se pierde al importar: de la semana 7 no se sabe
--  si el .xls llegaba hasta el lunes o hasta el domingo.
--
--  Y ese dato hace falta para lo mas practico del ciclo: saber DESDE QUE
--  FECHA pedirle el proximo listado al sistema. Sin el hay que adivinar,
--  y adivinar de menos duplica ventas o de mas las pierde.
--
--  Se guarda por temporada porque es una propiedad de la carga, no de
--  cada producto: el .xls se exporta con un corte y ese corte vale para
--  todos.
-- ============================================================

alter table public.cl_temporadas
  add column if not exists ventas_hasta date;

-- Sembrar con lo que ya se sabe: el usuario confirmo que la importacion
-- de 2026-2027 llega hasta el 8/9, el mismo dia del conteo.
update public.cl_temporadas
   set ventas_hasta = date '2026-09-08'
 where nombre = '2026-2027' and ventas_hasta is null;

-- Las dos historicas estan completas hasta el fin de temporada.
update public.cl_temporadas
   set ventas_hasta = fecha_fin
 where nombre in ('2024-2025','2025-2026') and ventas_hasta is null;

select nombre, fecha_ini, fecha_fin, ventas_hasta, activa
  from public.cl_temporadas order by fecha_ini;
