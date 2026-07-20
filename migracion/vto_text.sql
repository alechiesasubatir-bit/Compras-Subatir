-- ============================================================
--  Pasar f_vto (fecha de vencimiento) de DATE a TEXT
--  Necesario para poder guardar "NO APLICA" además de una fecha.
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================
alter table public.pedidos
  alter column f_vto type text using f_vto::text;

-- (Las fechas existentes quedan como texto 'AAAA-MM-DD'; el frontend las
--  muestra formateadas y acepta también el valor "NO APLICA".)
