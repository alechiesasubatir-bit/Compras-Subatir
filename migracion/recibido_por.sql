-- ============================================================
--  Módulo Recepción de Mercadería: registrar quién recibió
--  Agrega la columna recibido_por a pedidos.
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================
alter table public.pedidos
  add column if not exists recibido_por text;
