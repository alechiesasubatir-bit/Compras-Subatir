-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v11
--
--  "Config Depósito": la planta se dibuja, no se imagina.
--
--  Hasta ahora un depósito era sólo un nombre y las estanterías
--  tenían una posición ABSTRACTA (plano_fila = hilera, plano_orden
--  = lugar en la hilera). El 3D las acomodaba solo, con un pasillo
--  fijo, así que el dibujo nunca podía parecerse al galpón real.
--
--  Con esta etapa el depósito pasa a tener medidas, se subdivide en
--  SUB-DEPÓSITOS dibujados (rectángulos con su tamaño y su lugar) y
--  cada estantería tiene coordenadas reales dentro de uno de ellos.
--  El 3D se levanta a partir de eso.
--
--  Lo que NO cambia (a propósito):
--   · El stock sigue siendo por DEPÓSITO (imp_stock es unique por
--     articulo+deposito). Los sub-depósitos dicen DÓNDE están las
--     cosas, no cuánto hay. Así el ingreso, el armado de pallets,
--     imp_disponible y las transferencias quedan intactos.
--   · plano_fila / plano_orden NO se borran. Quedan como respaldo y
--     como fuente del auto-acomodado para las estanterías que
--     todavía no tengan coordenadas.
--   · imp_zonas sigue donde está. Es legacy (3 zonas de Artigas que
--     eran una semilla inventada) y un pallet viejo todavía apunta a
--     una: su bitácora tiene que seguir siendo legible.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v10.sql
--  Es idempotente.
-- ============================================================

-- ── 1. La nave: medidas del depósito ─────────────────────────
--  Acotan el plano del editor. En null = todavía no se midió, y el
--  editor arranca con un tamaño por defecto hasta que se cargue.
alter table public.imp_depositos add column if not exists ancho_m numeric;  -- eje X
alter table public.imp_depositos add column if not exists largo_m numeric;  -- eje Y (profundidad)

alter table public.imp_depositos drop constraint if exists imp_depositos_medidas_check;
alter table public.imp_depositos add constraint imp_depositos_medidas_check
  check ((ancho_m is null or ancho_m > 0) and (largo_m is null or largo_m > 0));

-- ── 2. Sub-depósitos: los rectángulos dibujados ──────────────
--  tipo ESTANTERIAS = lleva racks adentro.
--  tipo PISO        = área sin racks (playa de descarga, mercadería
--                     suelta, armado). Ahí van los pallets que hoy
--                     figuran sólo como "sin ubicar".
--  x_m/y_m = esquina superior izquierda, medida desde la esquina
--  del depósito. Se guarda la esquina y no el centro porque es lo
--  que se arrastra en el editor y lo que se mide con la cinta.
create table if not exists public.imp_subdepositos (
  id          bigint generated always as identity primary key,
  deposito    text    not null references public.imp_depositos(nombre) on update cascade,
  nombre      text    not null,
  tipo        text    not null default 'ESTANTERIAS',
  x_m         numeric not null default 0,
  y_m         numeric not null default 0,
  ancho_m     numeric not null,
  largo_m     numeric not null,
  color       text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (deposito, nombre)
);

alter table public.imp_subdepositos drop constraint if exists imp_subdepositos_tipo_check;
alter table public.imp_subdepositos add constraint imp_subdepositos_tipo_check
  check (tipo in ('ESTANTERIAS','PISO'));

alter table public.imp_subdepositos drop constraint if exists imp_subdepositos_medidas_check;
alter table public.imp_subdepositos add constraint imp_subdepositos_medidas_check
  check (ancho_m > 0 and largo_m > 0 and x_m >= 0 and y_m >= 0);

create index if not exists imp_subdepositos_dep_idx on public.imp_subdepositos(deposito);

-- ── 3. Estanterías: a qué sub-depósito y en qué lugar ────────
--  x_m/y_m = CENTRO del rack (es lo que ya usa el 3D para armarlo).
--  rot_deg = 0 -> largo sobre el eje X · 90 -> largo sobre el eje Y.
--  En null = sin ubicar en el plano: el 3D cae al acomodado viejo
--  por hilera/orden, así nada se ve roto antes de dibujar.
alter table public.imp_estanterias add column if not exists subdeposito_id bigint;
alter table public.imp_estanterias add column if not exists x_m    numeric;
alter table public.imp_estanterias add column if not exists y_m    numeric;
alter table public.imp_estanterias add column if not exists rot_deg int not null default 0;

do $$ begin
  alter table public.imp_estanterias add constraint imp_estanterias_subdep_fk
    foreign key (subdeposito_id) references public.imp_subdepositos(id) on delete set null;
exception when duplicate_object then null; when others then null; end $$;

alter table public.imp_estanterias drop constraint if exists imp_estanterias_rot_check;
alter table public.imp_estanterias add constraint imp_estanterias_rot_check
  check (rot_deg in (0,90));

create index if not exists imp_estanterias_subdep_idx on public.imp_estanterias(subdeposito_id);

-- ── 4. Pallets sueltos: en qué área de piso están ────────────
--  Sólo aplica al pallet SIN estantería. Cuando un pallet se ubica
--  en un rack, el rack manda: el sub-depósito sale de la estantería
--  y la app limpia esta columna. No se pone un check que lo obligue
--  para no arriesgar los caminos del flujo que ya andan.
alter table public.imp_pallets add column if not exists subdeposito_id bigint;

do $$ begin
  alter table public.imp_pallets add constraint imp_pallets_subdep_fk
    foreign key (subdeposito_id) references public.imp_subdepositos(id) on delete set null;
exception when duplicate_object then null; when others then null; end $$;

create index if not exists imp_pallets_subdep_idx on public.imp_pallets(subdeposito_id);

-- ── 5. RLS y realtime de la tabla nueva ──────────────────────
alter table public.imp_subdepositos enable row level security;
drop policy if exists p_imp_subdepositos_read on public.imp_subdepositos;
create policy p_imp_subdepositos_read on public.imp_subdepositos for select
  using (auth.role()='authenticated');
drop policy if exists p_imp_subdepositos_write on public.imp_subdepositos;
create policy p_imp_subdepositos_write on public.imp_subdepositos for all
  using (public.has_module('importacion')) with check (public.has_module('importacion'));
do $$ begin
  execute 'alter publication supabase_realtime add table public.imp_subdepositos';
exception when duplicate_object then null; when others then null; end $$;

-- ── 6. Borrar un sub-depósito no puede perder pallets ────────
--  Los FK son ON DELETE SET NULL, así que borrarlo deja las
--  estanterías y los pallets sin ubicación en el plano, nunca los
--  borra. Igual el editor no deja borrar uno que tenga algo
--  adentro: perder la ubicación en silencio sería peor.
--  Cuántas cosas cuelgan de cada sub-depósito:
create or replace view public.imp_subdep_uso as
select s.id, s.deposito, s.nombre, s.tipo,
       (select count(*) from public.imp_estanterias e where e.subdeposito_id = s.id) as estanterias,
       (select count(*) from public.imp_pallets p
         where p.subdeposito_id = s.id
           and p.estado in ('ABIERTO','ESTACIONADO')) as pallets_sueltos,
       (select count(*) from public.imp_pallets p
         join public.imp_estanterias e on e.id = p.estanteria_id
        where e.subdeposito_id = s.id
          and p.estado in ('ABIERTO','ESTACIONADO')) as pallets_en_racks
  from public.imp_subdepositos s;

-- ── 7. Comprobación ──────────────────────────────────────────
-- select nombre, tipo, ancho_m, largo_m, x_m, y_m from public.imp_subdepositos order by deposito, nombre;
-- select nombre, subdeposito_id, x_m, y_m, rot_deg, plano_fila, plano_orden from public.imp_estanterias;
-- select * from public.imp_subdep_uso;
