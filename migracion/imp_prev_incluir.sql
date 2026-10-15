-- ============================================================
--  IMPORTACIONES · tilde por artículo (Intex, Enjoy y Mopas)
--
--  Pedido del usuario (15/10): al lado de cada artículo un tilde;
--  tildado entra en la cuenta, sin tildar no se pide ni suma en
--  totales y KPIs. Subatir no lo usa.
--
--  Se guarda por corrida, no por artículo: una corrida cerrada tiene
--  que seguir mostrando lo que se pidió aunque después se destilde
--  algo. Una corrida nueva copia los tildes de la que se estaba viendo.
--
--  Default true: todo lo que ya estaba cargado sigue contando igual.
--  Las políticas RLS de imp_prev_datos ya cubren la columna nueva.
--
--  Idempotente. Correr en Supabase → SQL Editor ANTES de publicar
--  la versión que la usa (si no, en Mopas no se guarda nada).
-- ============================================================

alter table public.imp_prev_datos
  add column if not exists incluir boolean not null default true;

-- ── Control ─────────────────────────────────────────────────
-- Esperado: todas las filas con incluir = true.
select c.linea, d.incluir, count(*)
  from public.imp_prev_datos d
  join public.imp_prev_corridas c on c.id = d.corrida_id
 group by c.linea, d.incluir
 order by c.linea;
