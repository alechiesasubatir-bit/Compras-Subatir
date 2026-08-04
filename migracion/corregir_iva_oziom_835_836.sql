-- ============================================================
--  OC 835 y 836 (Oziom S.A.S): pasar el IVA del 10% al 22%
--  ------------------------------------------------------------
--  Aparecieron al barrer las 603 filas de pedidos buscando tasas
--  raras despues de arreglar la Sal Fina Yodada. Son productos
--  terminados de limpieza: van a la tasa basica del 22%, no a la
--  minima. Estan cargadas al 10%, mal.
--
--  Las dos son del mismo proveedor, la misma fecha y con ids
--  consecutivos (491 y 492): misma tanda de carga, mismo error.
--
--    OC 836  id 491  $     s/268400  c/295240 -> c/327448
--    OC 835  id 492  U$S   s/  3470  c/  3817 -> c/  4233,40
--
--  Ojo que estas dos estaban del lado contrario al caso sal: la app
--  ya calcula 22% para ellas, asi que si alguien las reeditaba se
--  "corregian" solas sin que nadie se enterara. Esto lo hace
--  explicito.
--
--  Despues de correr esto, las unicas filas al 10% de toda la tabla
--  tienen que ser las 6 de Sal Fina Yodada.
--
--  Es idempotente: si ya estan al 22%, no toca nada.
-- ============================================================

update public.pedidos
set    c_iva = round(s_iva * 1.22, 2)
where  n_orden in ('835', '836')
  and  proveedor ilike 'oziom%'
  and  s_iva > 0
  and  abs(c_iva - round(s_iva * 1.22, 2)) > 0.01;

-- Verificacion 1: las dos filas quedaron al 22%
select id, n_orden, fecha, proveedor, descripcion, moneda, s_iva, c_iva,
       round(((c_iva / nullif(s_iva, 0)) - 1) * 100) as tasa_pct
from   public.pedidos
where  n_orden in ('835', '836')
order  by n_orden;

-- Verificacion 2: al 10% solo puede quedar la Sal Fina Yodada
select n_orden, descripcion, s_iva, c_iva
from   public.pedidos
where  s_iva > 0
  and  abs((c_iva / s_iva) - 1.10) < 0.002
order  by n_orden;
