-- ============================================================
--  PREVISION CLORO  ·  ajustes de stock
--
--  CAMBIO DE CRITERIO: el stock deja de contarse todas las semanas. Se
--  arrastra solo -conteo inicial + envasado - ventas- y el conteo del
--  8/9 queda como ancla de la temporada.
--
--  Lo que la aritmetica no puede saber va aca: devoluciones, roturas,
--  mercaderia que se movio de deposito, y los recuentos.
--
--  TODO AJUSTE LLEVA MOTIVO, y es obligatorio a nivel base. Un ajuste
--  sin motivo es un numero que aparece y nadie puede auditar: dentro de
--  seis meses, "faltan 40 unidades" sin explicacion no se distingue de
--  un error de carga.
--
--  `cantidad` es la DIFERENCIA, con signo: -12 son doce unidades que ya
--  no estan, +30 una devolucion que volvio al deposito.
--
--  Los recuentos entran por el mismo lugar con tipo='recuento': la
--  pantalla pide lo CONTADO y guarda la diferencia contra lo que el
--  sistema creia. Asi el stock queda en lo contado y ademas queda
--  registrado cuanto se habia desviado la cadena, que es el unico dato
--  que dice si esto esta sano.
-- ============================================================

create table if not exists public.cl_ajustes (
  id           bigint generated always as identity primary key,
  temporada_id bigint not null references public.cl_temporadas(id) on delete cascade,
  producto_id  bigint not null references public.cl_productos(id) on delete cascade,
  fecha        date not null,
  cantidad     numeric not null,                  -- con signo
  motivo       text   not null check (btrim(motivo) <> ''),
  tipo         text   not null default 'ajuste'
                 check (tipo in ('ajuste','recuento')),
  -- Sólo para los recuentos: qué se contó y qué esperaba el sistema.
  -- Guardarlo evita tener que reconstruirlo despues, cuando el stock ya
  -- se movio y la cuenta ya no da.
  contado      numeric,
  esperado     numeric,
  created_at   timestamptz not null default now(),
  created_by   text
);
create index if not exists idx_cl_aj_temp on public.cl_ajustes(temporada_id);

alter table public.cl_ajustes enable row level security;
drop policy if exists p_cl_ajustes_read on public.cl_ajustes;
create policy p_cl_ajustes_read on public.cl_ajustes
  for select using (auth.role() = 'authenticated');
drop policy if exists p_cl_ajustes_write on public.cl_ajustes;
create policy p_cl_ajustes_write on public.cl_ajustes
  for all using (public.has_module('cloro')) with check (public.has_module('cloro'));

-- Realtime, como el resto del modulo.
alter publication supabase_realtime add table public.cl_ajustes;
alter table public.cl_ajustes replica identity full;

select count(*) as ajustes from public.cl_ajustes;
