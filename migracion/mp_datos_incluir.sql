-- ============================================================
--  IMPORTACIONES · MERO AR · tilde por esencia
--
--  Pedido del usuario (25/11/2026): igual que en Subatir · Consumo,
--  al lado de cada esencia un tilde; tildada entra en la cuenta de la
--  corrida, sin tildar no se pide ni suma en KPIs, gráficos, OC ni
--  proforma.
--
--  Se guarda por corrida (mp_datos), no por artículo: una corrida
--  cerrada tiene que seguir mostrando lo que se pidió aunque después
--  se destilde algo. Una corrida nueva copia los tildes de la que se
--  estaba viendo.
--
--  Default true: todo lo que ya estaba cargado sigue contando igual.
--  Las políticas RLS de mp_datos ya cubren la columna nueva.
--
--  Idempotente. Correr en Supabase → SQL Editor ANTES de publicar la
--  versión que la usa.
-- ============================================================

alter table public.mp_datos
  add column if not exists incluir boolean not null default true;

-- ── Control ─────────────────────────────────────────────────
-- Esperado: todas las filas con incluir = true.
select d.incluir, count(*)
  from public.mp_datos d
 group by d.incluir;
