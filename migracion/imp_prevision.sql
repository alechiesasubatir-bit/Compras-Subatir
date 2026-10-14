-- ============================================================
--  IMPORTACIONES · previsión de los artículos de Depósitos
--
--  El módulo "MP Importación" pasa a llamarse "Importaciones" y
--  tiene submódulos:
--    · MERO AR            sigue en sus tablas mp_* (no se toca)
--    · Subatir (Consumo)  ESTE archivo
--    · Intex / Enjoy / Mopas   mismo criterio, se habilitan después
--
--  Los artículos NO se duplican: son los de imp_articulos (la app de
--  Depósitos). Una "línea" es un filtro sobre esa tabla:
--    Subatir → proveedor='Subatir' y tipo='Consumo'
--    Intex / Enjoy / Mopas → proveedor = ese nombre
--
--  Lo que se carga por corrida (una por importación, 3 al año):
--    consumo_3m      unidades consumidas en los últimos 3 meses
--    consumo_anual   unidades del último año (llevado a 12 meses)
--    stock_actual    foto del stock de Depósitos al armar la corrida
--    en_transito     lo ya pedido que todavía no llegó
--    compra_confirmada  la decisión humana
--  La cuenta vive en importaciones-calc.js.
--
--  Escritura: quien tenga el módulo mp_importacion (el mismo de
--  MERO AR). Lectura: cualquier usuario logueado.
--
--  Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Parámetros por línea ─────────────────────────────────
create table if not exists public.imp_prev_parametros (
  linea              text primary key,
  crecimiento_pct    numeric not null default 10,
  meses_cobertura    numeric not null default 4,    -- 3 importaciones por año
  semanas_seguridad  numeric not null default 4,
  semanas_leadtime   numeric not null default 12,
  updated_at         timestamptz not null default now()
);

insert into public.imp_prev_parametros (linea)
select l from unnest(array['Subatir','Intex','Enjoy','Mopas']) as l
on conflict (linea) do nothing;

-- ── 2. Corridas: una foto por importación ───────────────────
create table if not exists public.imp_prev_corridas (
  id            bigint generated always as identity primary key,
  linea         text not null references public.imp_prev_parametros(linea),
  nombre        text not null,
  fecha         date not null default current_date,
  nota          text,
  cerrada       boolean not null default false,
  -- De qué listados salió el consumo (nombre de archivo + período)
  origen_3m     text,
  origen_anual  text,
  -- Al cerrar se guardan los parámetros con que se pidió: los de la
  -- tabla 1 son de la línea y se van a seguir moviendo.
  parametros    jsonb,
  created_at    timestamptz not null default now(),
  created_by    text
);
create index if not exists idx_imp_prev_corr on public.imp_prev_corridas(linea, fecha desc);

-- ── 3. Datos de cada artículo en cada corrida ───────────────
create table if not exists public.imp_prev_datos (
  id                bigint generated always as identity primary key,
  corrida_id        bigint not null references public.imp_prev_corridas(id) on delete cascade,
  articulo_id       bigint not null references public.imp_articulos(id) on delete cascade,
  consumo_3m        numeric not null default 0,
  consumo_anual     numeric not null default 0,
  stock_actual      numeric not null default 0,
  en_transito       numeric not null default 0,
  compra_confirmada numeric,
  nota              text,
  unique (corrida_id, articulo_id)
);
create index if not exists idx_imp_prev_datos on public.imp_prev_datos(corrida_id);

-- ── 4. RLS ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['imp_prev_parametros','imp_prev_corridas','imp_prev_datos'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_%I_read on public.%I;', t, t);
    execute format('create policy p_%I_read on public.%I for select using (auth.role()=''authenticated'');', t, t);
    execute format('drop policy if exists p_%I_write on public.%I;', t, t);
    execute format('create policy p_%I_write on public.%I for all using (public.has_module(''mp_importacion'')) with check (public.has_module(''mp_importacion''));', t, t);
  end loop;
end $$;

-- ── Control ─────────────────────────────────────────────────
-- Esperado: 4 líneas con sus defaults; Subatir con 15 artículos de Consumo.
select p.linea, p.crecimiento_pct, p.meses_cobertura, p.semanas_seguridad, p.semanas_leadtime,
       (select count(*) from public.imp_articulos a
         where a.activo and a.proveedor = p.linea
           and (p.linea <> 'Subatir' or a.tipo = 'Consumo')) as articulos
  from public.imp_prev_parametros p
 order by p.linea;
