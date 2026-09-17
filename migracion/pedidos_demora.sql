-- ============================================================
--  Pedidos: demora estimada de arribo
--
--  Se guarda la DEMORA EN DÍAS, no la fecha de llegada: es lo que
--  dice el proveedor al cerrar la compra ("te llega en 15 días").
--  La fecha estimada se calcula siempre como fecha de la OC + demora
--  (SubatirApp.llegada.estimar), así que si mañana se corrige la
--  fecha de la orden la estimación acompaña sola y no quedan dos
--  fechas guardadas diciendo cosas distintas.
--
--  No toca la orden de compra impresa: es un dato interno.
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================
alter table public.pedidos
  add column if not exists demora_dias smallint;

-- Una demora de 0 o negativa no significa nada; si no se sabe, va NULL.
alter table public.pedidos
  drop constraint if exists pedidos_demora_dias_ck;
alter table public.pedidos
  add constraint pedidos_demora_dias_ck
  check (demora_dias is null or demora_dias > 0);

comment on column public.pedidos.demora_dias is
  'Demora estimada de arribo en días desde la fecha de la OC. NULL = sin estimación.';

-- ── Verificación ────────────────────────────────────────────
select 'columna', count(*)::text
  from information_schema.columns
 where table_schema = 'public' and table_name = 'pedidos' and column_name = 'demora_dias'
union all
select 'check', count(*)::text
  from pg_constraint
 where conname = 'pedidos_demora_dias_ck';
-- Esperado: columna 1 | check 1
