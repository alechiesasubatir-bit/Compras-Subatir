-- ============================================================
--  Entregas parciales de recepción de mercadería
--  Cada fila = una entrega de un producto de una OC (con su
--  propio lote y vencimiento). El "recibido" de una línea es
--  la suma de sus entregas.
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================
create table if not exists public.entregas (
  id            bigint generated always as identity primary key,
  pedido_id     bigint references public.pedidos(id) on delete cascade,
  n_orden       text,
  descripcion   text,
  cantidad      numeric not null default 0,   -- recibido en ESTA entrega
  fecha         date,
  lote          text,
  f_vto         text,                          -- vencimiento de esta tanda (o "NO APLICA")
  coa           text,
  conforme      text,
  recibido_por  text,
  observaciones text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_entregas_pedido on public.entregas(pedido_id);

alter table public.entregas enable row level security;

drop policy if exists p_entregas_read on public.entregas;
create policy p_entregas_read on public.entregas
  for select using (auth.role() = 'authenticated');

drop policy if exists p_entregas_write on public.entregas;
create policy p_entregas_write on public.entregas
  for all
  using (public.has_module('recepcion') or public.has_module('pedidos'))
  with check (public.has_module('recepcion') or public.has_module('pedidos'));

-- (Opcional) tiempo real para que la lista se actualice sola:
-- alter table public.entregas replica identity full;
-- alter publication supabase_realtime add table public.entregas;
