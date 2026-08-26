-- ============================================================
--  BAJA DEL MÓDULO CONTINGENCIA  ·  agosto 2026
--
--  El módulo salió de la app: ya no hay contingencia.html, ni acceso
--  en el menú, ni permiso asignable desde Usuarios.
--
--  Este archivo limpia lo que queda del lado de la base. Va en DOS
--  partes a propósito:
--
--    PARTE 1 — se corre siempre. Saca el permiso de los usuarios y
--              baja la tabla del realtime. No borra un solo dato.
--
--    PARTE 2 — BORRA LA TABLA Y TODO LO QUE TIENE ADENTRO. Está
--              comentada. Descomentala sólo cuando estés seguro de
--              que no querés más esos datos: no hay vuelta atrás.
--              Antes de correrla conviene bajarse una copia (ver
--              la consulta del final).
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

-- ── PARTE 1 ─────────────────────────────────────────────────

-- 1a) Sacarle el permiso 'contingencia' a todos los perfiles.
--     array_remove deja el resto de los módulos intactos.
update public.profiles
   set modules = array_remove(modules, 'contingencia')
 where 'contingencia' = any(modules);

-- 1b) Sacar la tabla de la publicación de realtime. Si ya no está,
--     Postgres avisa con un error: por eso va envuelto.
do $$
begin
  alter publication supabase_realtime drop table public.contingencia;
exception when others then
  raise notice 'contingencia ya no estaba en supabase_realtime (%)', sqlerrm;
end $$;

-- 1c) El trigger de updated_at que le puso schema.sql.
drop trigger if exists trg_touch_contingencia on public.contingencia;

-- Control: acá no tiene que quedar ninguna fila.
select id, email, modules
  from public.profiles
 where 'contingencia' = any(modules);


-- ── PARTE 2 · IRREVERSIBLE ──────────────────────────────────
--  Descomentar sólo si ya no querés guardar los datos.
--
-- drop policy if exists p_contingencia_read  on public.contingencia;
-- drop policy if exists p_contingencia_write on public.contingencia;
-- drop table if exists public.contingencia;


-- ── Copia previa, por si querés guardarla ───────────────────
--  Corré esto ANTES de la Parte 2 y exportá el resultado a CSV
--  desde el botón de descarga del SQL Editor.
--
-- select * from public.contingencia order by id;
