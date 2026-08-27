-- ============================================================
--  MP IMPORTACIÓN · configuración del módulo
--
--  Cuatro cosas que hasta ahora no estaban en ningún lado:
--
--   1) PRÓXIMA REVISIÓN — la fecha en que hay que volver a mirar
--      esto. El dashboard de Compras avisa desde el día anterior.
--      Sin esto, que se revise a tiempo depende de que alguien se
--      acuerde.
--
--   2) CATEGORÍA DE CADA ESENCIA — no todas pesan igual:
--        primaria    exclusiva de importación, no se consigue en
--                    plaza. Si falta, no hay con qué reemplazarla.
--        secundaria  importante por volumen.
--        (sin categoría) el resto.
--      No cambia el cálculo: cambia a qué mirar primero.
--
--   3) TEMPORADA ALTA — un % extra sobre el consumo proyectado,
--      para las épocas en que se consume más. Se prende y se apaga,
--      así queda registrado en la corrida con qué supuesto se pidió.
--
--   4) Las OFERTAS DEL MES quedan para más adelante: todavía no
--      está definido cómo se vinculan los productos en promoción
--      con las esencias que llevan. No se crea tabla para eso hasta
--      saber la forma; inventarla ahora sería adivinar.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Parámetros nuevos ────────────────────────────────────
alter table public.mp_parametros
  add column if not exists proxima_revision   date,
  add column if not exists temporada_alta     boolean not null default false,
  -- % extra que se suma al proyectado cuando la temporada está activa
  add column if not exists temporada_alta_pct numeric not null default 25;

-- ── 2. Categoría del artículo ───────────────────────────────
alter table public.mp_articulos
  add column if not exists categoria text;

-- Sólo tres valores posibles (o ninguno). Se valida en la base y no
-- sólo en la pantalla: un valor raro rompería el color y el filtro.
do $$ begin
  alter table public.mp_articulos
    add constraint mp_articulos_categoria_check
    check (categoria is null or categoria in ('primaria','secundaria'));
exception when duplicate_object then null; end $$;

create index if not exists idx_mp_art_cat on public.mp_articulos(categoria);

-- ── Control ─────────────────────────────────────────────────
select p.proxima_revision, p.temporada_alta, p.temporada_alta_pct
  from public.mp_parametros p
  join public.mp_proveedores v on v.id = p.proveedor_id
 where v.nombre = 'MERO AR';

select coalesce(categoria,'(sin categoría)') as categoria, count(*)
  from public.mp_articulos group by 1 order by 1;
