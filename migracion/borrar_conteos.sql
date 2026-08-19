-- ============================================================
--  Borrar el registro de conteos
--
--  El módulo de Stock ya no tiene la pantalla de historial ni escribe
--  en estas tablas (version 2026-08-19.0000), así que quedaban ahí sin
--  que nada las lea. Se borran.
--
--  OJO: ESTO NO SE PUEDE DESHACER. Se van 6 recorridos con 60 líneas
--  (los del 18/08 entre las 12:47 y las 13:08). Antes de correrlo hay
--  una copia en:
--      migracion/backup/backup-conteos-2026-08-19.csv
--  con conteo, fecha, responsable, hora, artículo, stock anterior,
--  contado, diferencia y estado. Si algún día hace falta el dato, está
--  ahí; lo que no vuelve es la tabla.
--
--  Se borra también la función del trigger, que no la usa nadie más:
--  cada tabla del proyecto tiene la suya (touch_updated_at para las
--  originales, pvarios_touch para pedidos varios).
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── Qué se está por borrar ───────────────────────────────────
--  Correr este select SOLO para mirar, antes de seguir.
select (select count(*) from public.conteos)       as cabeceras,
       (select count(*) from public.conteo_lineas) as lineas;

-- ── Borrar ───────────────────────────────────────────────────
--  conteo_lineas primero por la foreign key; igual el cascade del
--  drop de conteos la arrastraría, pero explícito se lee mejor.
drop table if exists public.conteo_lineas;
drop table if exists public.conteos;

drop function if exists public.conteos_touch();

-- ── Comprobar ────────────────────────────────────────────────
--  No tiene que devolver ninguna fila.
select tablename
  from pg_tables
 where schemaname = 'public'
   and tablename in ('conteos','conteo_lineas');
