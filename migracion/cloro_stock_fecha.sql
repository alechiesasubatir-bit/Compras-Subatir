-- ============================================================
--  PREVISION CLORO  ·  el stock inicial pasa a saber de que dia es
--
--  `cl_stock_inicial` se guardaba sin fecha y el modulo lo trataba como
--  el saldo de la SEMANA 1 de la temporada. El conteo real de 2026-2027
--  se hizo el 08/09/2026 -que es la semana 7-, con 1.458 unidades ya
--  vendidas en las semanas 1 a 6 e importadas del ERP.
--
--  Restar esas ventas de un conteo que YA las tiene descontadas las
--  cuenta dos veces. Verificado en la pantalla antes de escribir esto:
--  mostraba -272 unidades de Pastilla Triple Accion x 1 kg donde se
--  habian contado 500, y -121 de Cloro Shock 3,5 Kg donde se contaron
--  29. El sugerido arrastraba el mismo error y mandaba a envasar de
--  nuevo lo que ya se habia vendido.
--
--  La fecha va POR FILA y no por temporada: un reconteo de un solo
--  producto tiene que poder representarse sin mentir sobre los otros
--  doce. La pantalla las escribe todas juntas desde un unico campo.
-- ============================================================

alter table public.cl_stock_inicial
  add column if not exists fecha date;

-- El conteo que ya esta cargado, de la temporada activa.
update public.cl_stock_inicial
   set fecha = date '2026-09-08'
 where fecha is null
   and temporada_id = (select id from public.cl_temporadas where nombre = '2026-2027');

-- Control: no tiene que quedar ninguna fila de esa temporada sin fecha.
-- Una fila sin fecha vuelve al comportamiento viejo -se asume semana 1-
-- y ese es exactamente el error que esto viene a sacar.
do $$
declare n int;
begin
  select count(*) into n
    from public.cl_stock_inicial s
    join public.cl_temporadas t on t.id = s.temporada_id
   where t.nombre = '2026-2027' and s.fecha is null;
  if n > 0 then
    raise exception 'Quedaron % filas de stock inicial de 2026-2027 sin fecha', n;
  end if;
end $$;

select t.nombre, count(*) as filas, count(s.fecha) as con_fecha, min(s.fecha) as fecha
  from public.cl_stock_inicial s
  join public.cl_temporadas t on t.id = s.temporada_id
 group by t.nombre order by t.nombre;
