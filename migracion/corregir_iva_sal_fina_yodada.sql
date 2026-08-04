-- ============================================================
--  Sal Fina Yodada: pasar el IVA guardado del 22% al 10%
--  + corregir la moneda de la OC 773
--  ------------------------------------------------------------
--  La Sal Fina Yodada va a la tasa minima (10%), no a la basica.
--  El modulo tenia el 1.22 escrito a mano, asi que toda OC de este
--  articulo que se cargo o se reedito desde la app quedo con el
--  c/iva inflado. El codigo ya se corrigio (ver SubatirApp.ivaTasa);
--  esto arregla lo que quedo mal guardado.
--
--  Estado antes de correr esto (6 filas del articulo):
--    OC 641  id 184  $     s/10404  c/12692.88  = 22%   <- corregir
--    OC 684  id 266  $     s/13005  c/15866.10  = 22%   <- corregir
--    OC 773  id 404  U$S   s/13005  c/15866.10  = 22%   <- corregir + moneda
--    OC 811  id 455  $     s/26010  c/28611.00  = 10%   ok, no se toca
--    OC 873  id 552  $     s/13005  c/15866.10  = 22%   <- corregir
--    OC 893  id 598  $     s/13005  c/15866.10  = 22%   <- corregir
--
--  Ojo con la 873: en el backup del 16-07 estaba bien (14305.50).
--  Se reedito desde la app despues de esa fecha y el x1.22 le piso
--  el valor correcto. Es el mismo caso que las demas.
--
--  Total c/iva del articulo: 104.768,28 -> 97.277,40
--
--  Es idempotente: las filas que ya esten al 10% no se tocan.
-- ============================================================

-- 1) IVA al 10% -----------------------------------------------
update public.pedidos
set    c_iva = round(s_iva * 1.10, 2)
where  descripcion ilike '%sal fina yodada%'
  and  s_iva > 0
  and  abs(c_iva - round(s_iva * 1.10, 2)) > 0.01;

-- 2) Moneda de la OC 773 --------------------------------------
--  Esta cargada en U$S con precio 26,01, el mismo valor que las
--  otras compras del articulo, que son en pesos. A 26 dolares el
--  kilo la sal no cierra: es la moneda mal cargada, no el precio.
update public.pedidos
set    moneda = '$'
where  n_orden = '773'
  and  descripcion ilike '%sal fina yodada%'
  and  moneda <> '$';

-- Verificacion: las 6 filas tienen que quedar en 10% y en $
select id, n_orden, fecha, moneda, cantidad, precio_un, s_iva, c_iva,
       round(((c_iva / nullif(s_iva, 0)) - 1) * 100) as tasa_pct
from   public.pedidos
where  descripcion ilike '%sal fina yodada%'
order  by n_orden;
