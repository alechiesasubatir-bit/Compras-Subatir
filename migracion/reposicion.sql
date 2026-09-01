-- ============================================================
--  Configuracion de reposicion por articulo y proveedor.
--  Idempotente: correrlo dos veces no hace dano.
--  Correr en Supabase -> SQL Editor.
-- ============================================================

-- 1 . Lo del articulo, en la tabla que ya lo describe
alter table public.inventario
  add column if not exists seguimiento        boolean not null default false,
  add column if not exists revisar_cada_meses smallint,
  add column if not exists proxima_revision   date,
  add column if not exists prov_auto_at       timestamptz,
  add column if not exists prov_auto_oc       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventario_revisar_meses_ck' and conrelid = 'public.inventario'::regclass) then
    alter table public.inventario
      add constraint inventario_revisar_meses_ck
      check (revisar_cada_meses is null or revisar_cada_meses between 1 and 60);
  end if;
end $$;

-- 2 . Lo del proveedor
create table if not exists public.art_proveedor (
  id             bigint generated always as identity primary key,
  inventario_id  bigint not null references public.inventario(id) on delete cascade,
  proveedor      text   not null,

  demora_dias    smallint,
  usar_demora    boolean not null default false,

  lote_minimo    numeric,
  multiplo       numeric,
  usar_lote      boolean not null default false,

  pact_cantidad  numeric,
  pact_entregado numeric not null default 0,
  pact_vence     date,
  usar_pactada   boolean not null default false,

  notas          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (inventario_id, proveedor),

  -- Un bloque tildado sin su dato cargado seria una alerta que no puede
  -- calcularse. Se impide en la base, no solo en la pantalla.
  constraint ap_demora_ck  check (not usar_demora  or (demora_dias is not null and demora_dias > 0)),
  constraint ap_lote_ck    check (not usar_lote    or (lote_minimo is not null and lote_minimo > 0)
                                                   or (multiplo    is not null and multiplo    > 0)),
  constraint ap_pactada_ck check (not usar_pactada or (pact_cantidad is not null and pact_cantidad > 0
                                                       and pact_vence is not null))
);

create index if not exists art_proveedor_inv_idx on public.art_proveedor(inventario_id);

-- 3 . RLS: lectura para autenticados, escritura para quien tenga el modulo
alter table public.art_proveedor enable row level security;

drop policy if exists ap_sel on public.art_proveedor;
drop policy if exists ap_ins on public.art_proveedor;
drop policy if exists ap_upd on public.art_proveedor;
drop policy if exists ap_del on public.art_proveedor;

create policy ap_sel on public.art_proveedor for select to authenticated using (true);
create policy ap_ins on public.art_proveedor for insert to authenticated
  with check (public.is_admin() or public.has_module('stock'));
create policy ap_upd on public.art_proveedor for update to authenticated
  using (public.is_admin() or public.has_module('stock'))
  with check (public.is_admin() or public.has_module('stock'));
create policy ap_del on public.art_proveedor for delete to authenticated
  using (public.is_admin() or public.has_module('stock'));

-- 4 . Realtime, para que Stock y la pantalla de configuracion se refresquen entre si
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'art_proveedor' and schemaname = 'public'
  ) then
    alter publication supabase_realtime add table public.art_proveedor;
  end if;
end $$;

select 'columnas' as que, count(*)::text as valor
  from information_schema.columns
 where table_name = 'inventario'
   and table_schema = 'public'
   and column_name in ('seguimiento','revisar_cada_meses','proxima_revision','prov_auto_at','prov_auto_oc')
union all
select 'tabla art_proveedor', count(*)::text from information_schema.tables where table_name = 'art_proveedor' and table_schema = 'public'
union all
select 'checks', count(*)::text from information_schema.table_constraints
 where table_name = 'art_proveedor' and table_schema = 'public' and constraint_type = 'CHECK'
   and constraint_name in ('ap_demora_ck','ap_lote_ck','ap_pactada_ck')
union all
select 'policies', count(*)::text from pg_policies where tablename = 'art_proveedor' and schemaname = 'public';

-- Esperado: columnas 5 | tabla art_proveedor 1 | checks 3 | policies 4
