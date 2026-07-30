-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v12
--
--  Se invierten las letras de los niveles: A abajo, D arriba.
--
--  Hasta ahora la letra salía de chr(64 + fila), o sea que la fila 1
--  era "A" — y la fila 1 es el nivel de ARRIBA (en el 3D la altura es
--  BASE+(filas-fila)*LVL). Con 4 niveles quedaba A arriba de todo y D
--  a ras del piso, al revés de como se cuenta en el galpón.
--
--  Ahora la letra se cuenta desde abajo: en un rack de 4 niveles, la
--  fila 4 (la de abajo) es "A" y la fila 1 (la de arriba) es "D".
--
--  IMPORTANTE — esto RENOMBRA, no MUEVE:
--   · imp_pallets.fila NO se toca. Ningún pallet cambia de estante:
--     el que estaba abajo sigue abajo, sólo que ahora se llama A.
--   · La altura en el 3D tampoco cambia, por lo mismo.
--   · Como la letra depende de cuántos niveles tiene el rack, las
--     funciones ahora leen imp_estanterias.filas. Si el rack no
--     existe se cae al criterio viejo, que es lo único razonable
--     sin saber la altura.
--
--  OJO CON LA BITÁCORA: imp_movimientos.ubicacion_de / ubicacion_a
--  guardan TEXTO ya compuesto. Los movimientos anteriores a esta
--  migración quedan escritos con el criterio viejo (ahí "A" significa
--  arriba). No se reescriben: son el registro de lo que se dijo en su
--  momento, y cambiarlos seria falsear el historial. Los movimientos
--  nuevos ya salen con el criterio nuevo.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v11.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Letra de un nivel, contada desde abajo ────────────────
--  filas=4 → fila 4 = 'A', fila 3 = 'B', fila 2 = 'C', fila 1 = 'D'
create or replace function public.imp_nivel_letra(p_est bigint, p_fila int)
returns text language sql stable set search_path = public as $$
  select case
    when p_fila is null then null
    else chr(64 + coalesce(
      (select e.filas from public.imp_estanterias e where e.id = p_est) - p_fila + 1,
      p_fila))   -- sin rack conocido no hay altura: se deja como estaba
  end;
$$;

-- ── 2. Las dos funciones que arman el texto de ubicación ─────
create or replace function public.imp_ubic_txt(p_est bigint, p_fila int, p_col int)
returns text language sql stable set search_path = public as $$
  select case
    when p_est is null or p_fila is null or p_col is null then null
    else coalesce((select e.nombre from public.imp_estanterias e where e.id = p_est), 'Est?')
         || ' · ' || public.imp_nivel_letra(p_est, p_fila) || p_col::text
  end;
$$;

create or replace function public.imp_ubic_txt2(p_est bigint, p_fila int, p_col int, p_zona bigint)
returns text language sql stable set search_path = public as $$
  select case
    when p_zona is not null then
      coalesce((select z.nombre from public.imp_zonas z where z.id = p_zona), 'Zona?')
    when p_est is not null and p_fila is not null and p_col is not null then
      coalesce((select e.nombre from public.imp_estanterias e where e.id = p_est), 'Est?')
      || ' · ' || public.imp_nivel_letra(p_est, p_fila) || p_col::text
    else null
  end;
$$;

-- ── 3. Comprobación ──────────────────────────────────────────
--  En un rack de 4 niveles tiene que dar D, C, B, A de fila 1 a 4.
-- select e.nombre, e.filas, f.fila, public.imp_nivel_letra(e.id, f.fila) as letra
--   from public.imp_estanterias e
--   cross join generate_series(1,4) as f(fila)
--  where e.activo order by e.nombre, f.fila;
--
--  Y dónde quedó cada pallet ubicado:
-- select p.codigo, e.nombre, p.fila, p.columna,
--        public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna) as ubicacion
--   from public.imp_pallets p
--   join public.imp_estanterias e on e.id = p.estanteria_id
--  where p.estanteria_id is not null;
