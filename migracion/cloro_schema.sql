-- ============================================================
--  PREVISIÓN CLORO  ·  envasado y compra de MP de la línea de piscinas
--
--  La línea de piscinas es estacional y corta: se vende de agosto a
--  marzo y el resto del año no existe. El cloro se compra importado,
--  así que la decisión de comprar se toma meses antes de la venta que
--  la justifica. Hoy eso se decide mirando planillas sueltas del ERP,
--  una por producto y por temporada, sin ningún lugar donde estén
--  juntas ni donde se vea qué se envasó contra qué se vendió.
--
--  LO QUE SE INGRESA:
--    · las ventas, importadas del ERP (agregadas por semana)
--    · las órdenes de envasado, semana a semana
--    · el stock de cada producto al abrir la temporada, una vez
--  TODO LO DEMÁS SE CALCULA, y se calcula en la pantalla —no acá—
--  para que al mover un parámetro se vea moverse todo. Las fórmulas
--  están en cloro-calc.js, con sus tests en test/cloro-calc.test.js.
--
--  LA SEMANA ES PROPIA DE LA TEMPORADA, NO ISO. Semana 1 = el lunes de
--  la semana que contiene fecha_ini. Las semanas ISO se reinician el 1
--  de enero, justo en la mitad del pico, y corren respecto de la
--  temporada según dónde caiga el 1/8: la semana 23 de temporada fue
--  ISO 2026-W01 en 2025-26 y va a ser ISO 2026-W53 en 2026-27.
--
--  Correr en Supabase → SQL Editor. Después: cloro_seed.sql
-- ============================================================

-- ── 1. Temporadas ───────────────────────────────────────────
create table if not exists public.cl_temporadas (
  id         bigint generated always as identity primary key,
  nombre     text not null unique,          -- '2026-2027'
  fecha_ini  date not null,                 -- 1/8
  fecha_fin  date not null,                 -- 31/3
  activa     boolean not null default false,
  nota       text,
  created_at timestamptz not null default now()
);

-- ── 2. Materias primas ──────────────────────────────────────
create table if not exists public.cl_materias (
  id     bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true,
  nota   text
);

-- ── 3. Productos de la línea ────────────────────────────────
--  `materia_id` arranca en null a propósito: ver el comentario del
--  bloque de semilla, más abajo.
create table if not exists public.cl_productos (
  id               bigint generated always as identity primary key,
  codigo           text not null unique,     -- el Cod. Art. del ERP
  nombre           text not null,
  materia_id       bigint references public.cl_materias(id) on delete set null,
  kg_mp_por_unidad numeric not null default 0,
  lote_unidades    numeric not null default 1,
  orden            int not null default 0,
  activo           boolean not null default true
);

-- ── 4. Ventas, AGREGADAS POR SEMANA ─────────────────────────
--  El detalle factura por factura vive en el ERP; acá serían ~35.000
--  filas para dibujar exactamente el mismo gráfico. La semana es el
--  grano en el que el módulo piensa.
create table if not exists public.cl_ventas (
  id           bigint generated always as identity primary key,
  temporada_id bigint not null references public.cl_temporadas(id) on delete cascade,
  producto_id  bigint not null references public.cl_productos(id) on delete cascade,
  semana       int not null,
  unidades     numeric not null default 0,
  origen       text,                        -- nombre del archivo importado
  importado_at timestamptz not null default now(),
  unique (temporada_id, producto_id, semana)
);
create index if not exists idx_cl_ventas_temp on public.cl_ventas(temporada_id);

-- ── 5. Órdenes de envasado ──────────────────────────────────
--  Una fila por ORDEN, no por semana: si en una semana se envasa dos
--  veces son dos órdenes, y borrar una no debe borrar la otra. La
--  pantalla las suma por semana.
create table if not exists public.cl_envasado (
  id           bigint generated always as identity primary key,
  temporada_id bigint not null references public.cl_temporadas(id) on delete cascade,
  producto_id  bigint not null references public.cl_productos(id) on delete cascade,
  fecha        date not null,
  cantidad     numeric not null,
  orden        text,
  nota         text,
  created_at   timestamptz not null default now(),
  created_by   text
);
create index if not exists idx_cl_env_temp on public.cl_envasado(temporada_id);

-- ── 6. Stock al abrir la temporada ──────────────────────────
--  De acá en adelante el stock lo lleva el módulo solo: envasado
--  menos ventas.
create table if not exists public.cl_stock_inicial (
  temporada_id bigint not null references public.cl_temporadas(id) on delete cascade,
  producto_id  bigint not null references public.cl_productos(id) on delete cascade,
  cantidad     numeric not null default 0,
  primary key (temporada_id, producto_id)
);

-- ── 7. Parámetros, uno por temporada ────────────────────────
create table if not exists public.cl_parametros (
  temporada_id         bigint primary key references public.cl_temporadas(id) on delete cascade,
  -- Ventana del suavizado del histórico. Semana contra semana las dos
  -- temporadas correlacionan 0,68; con ventana centrada de 5 sube a
  -- 0,84, y a 0,92 en los productos grandes. Sin esto la previsión
  -- repite el camión mayorista que el año pasado cayó en esa semana.
  suavizado_semanas    int     not null default 5,
  horizonte_semanas    int     not null default 8,
  semanas_seguridad    numeric not null default 2,
  crecimiento_pct      numeric,          -- null = automático
  -- Debajo de esto la previsión semanal es ruido y la pantalla muestra
  -- el producto por mes. Medido: cuatro productos promedian entre 0,9
  -- y 4,8 u/semana y el siguiente hacia arriba promedia 32.
  umbral_baja_rotacion numeric not null default 10,
  updated_at           timestamptz not null default now()
);

-- ── 8. RLS: mismo criterio que el resto de Compras ──────────
do $$
declare t text;
begin
  foreach t in array array['cl_temporadas','cl_materias','cl_productos','cl_ventas',
                           'cl_envasado','cl_stock_inicial','cl_parametros'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_%I_read on public.%I;', t, t);
    execute format('create policy p_%I_read on public.%I for select using (auth.role()=''authenticated'');', t, t);
    execute format('drop policy if exists p_%I_write on public.%I;', t, t);
    execute format('create policy p_%I_write on public.%I for all using (public.has_module(''cloro'')) with check (public.has_module(''cloro''));', t, t);
  end loop;
end $$;

-- ── 9. Semilla de materias primas ───────────────────────────
--  Sólo la LISTA. Ningún producto queda asignado a ninguna: nadie puede
--  deducir de las ventas si el Cloro Granulado es hipoclorito de calcio
--  o si el Cloro Shock es dicloro, y una suposición silenciosa acá se
--  convierte en una compra de toneladas equivocada. Se asignan a mano
--  desde Configuración, y hasta entonces el módulo se niega a calcular
--  los kg de esos productos y lo dice en pantalla.
insert into public.cl_materias (nombre)
select x from unnest(array['Dicloro','Tricloro','Hipoclorito de calcio',
                           'Carbonato de sodio (pH+)','Bisulfato de sodio (pH-)']) as x
where not exists (select 1 from public.cl_materias m where m.nombre = x);

-- ── Controles ───────────────────────────────────────────────
-- Tiene que dar 5 materias y 0 productos (los productos vienen en la
-- semilla, cloro_seed.sql).
select (select count(*) from public.cl_materias)  as materias,
       (select count(*) from public.cl_productos) as productos,
       (select count(*) from public.cl_temporadas) as temporadas;

-- Las 7 tablas tienen que aparecer con rls habilitada y 2 políticas.
select c.relname as tabla, c.relrowsecurity as rls, count(p.polname) as politicas
  from pg_class c
  left join pg_policy p on p.polrelid = c.oid
 where c.relname like 'cl\_%'
 group by c.relname, c.relrowsecurity
 order by c.relname;
