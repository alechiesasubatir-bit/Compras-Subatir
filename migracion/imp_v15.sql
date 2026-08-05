-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v15
--
--  Las estanterías pasan a tener CUATRO orientaciones: 0, 90,
--  180 y 270 grados.
--
--  Por qué: con sólo 0 y 90, todas las estanterías numeraban sus
--  posiciones en el mismo sentido del mundo. La que se mira desde
--  el pasillo de enfrente quedaba, en el 3D, con la posición 1 del
--  lado contrario al que la ve el operario: el mapa 2D decía una
--  cosa y la vista 3D la opuesta. 180 y 270 son la misma
--  estantería dada vuelta —ocupan exactamente el mismo lugar en el
--  piso— y sirven para decir hacia qué pasillo da su frente.
--
--  No cambia ningún dato: las estanterías que hoy están en 0 y 90
--  se quedan como están. Sólo se amplía lo que la base acepta.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v14.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Cómo están hoy (opcional, sólo lee) ───────────────────
-- select deposito, nombre, x_m, y_m, rot_deg
--   from public.imp_estanterias order by deposito, nombre;

-- ── 2. Ampliar las orientaciones permitidas ──────────────────
alter table public.imp_estanterias drop constraint if exists imp_estanterias_rot_check;
alter table public.imp_estanterias add constraint imp_estanterias_rot_check
  check (rot_deg in (0,90,180,270));

comment on column public.imp_estanterias.rot_deg is
  'Orientación en grados: 0/180 = largo sobre el eje X, 90/270 = largo sobre el eje Y. '
  'La diferencia entre una y su opuesta es hacia qué lado crecen las posiciones (dónde cae la 1).';

-- ── 3. Comprobación ──────────────────────────────────────────
select pg_get_constraintdef(oid) as orientaciones_permitidas
  from pg_constraint where conname = 'imp_estanterias_rot_check';
-- Esperado: CHECK (rot_deg = ANY (ARRAY[0, 90, 180, 270]))
