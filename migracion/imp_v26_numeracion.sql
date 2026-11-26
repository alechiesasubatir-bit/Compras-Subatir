-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v26 · Numeración nueva de lugares
--
--  Desde el 26/11/2026:
--   · Las estanterías van con LETRA, por depósito, en el orden del
--     número que tenían: Estantería 1 → A, 2 → B…
--       Furriol: 1→A 2→B 3→C 4→D 5→E 6→F (la F está en el Sub-depósito 2)
--       Artigas: 1→A 2→B
--   · Cada lugar de pallet lleva un NÚMERO CORRIDO que arranca ABAJO A
--     LA IZQUIERDA, sigue hacia la derecha y sube nivel por nivel. En un
--     rack de 4 niveles × 5 bahías (10 lugares por nivel): abajo 1–10,
--     arriba 31–40. Se lee "A-12".
--
--  ESTO RENOMBRA, NO MUEVE:
--   · imp_pallets.fila / columna NO se tocan. Ningún pallet cambia de
--     lugar: el número sale de la fila, la columna y el tamaño del rack.
--   · Los QR no cambian: codifican sólo el código del pallet (PLT-…).
--   · fila sigue contándose desde arriba (fila 1 = nivel de arriba),
--     por eso la cuenta es (filas - fila) * lugares_por_nivel + columna.
--     La misma cuenta está en deposito/index.html (posNum) y en
--     deposito/recorrido.html. Si se cambia una, se cambian las tres.
--
--  BITÁCORA: imp_movimientos.ubicacion_de / ubicacion_a guardan texto ya
--  compuesto y NO se reescriben (mismo criterio que imp_v12). La app los
--  muestra marcados como "numeración vieja". Lo nuevo sale como "A-12".
--
--  Lo que lee lo nuevo apenas se corre esto (todo pasa por las dos
--  funciones de texto): imp_pallets_disponibles.ubicacion (pantalla
--  Solicitar), imp_pallet_ult_ranura.ubicacion y los movimientos que
--  registran imp_pallet_ubicar / cerrar / consumir / scan.
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente.
-- ============================================================

-- ── 1. Renombrar las estanterías ─────────────────────────────
--  Por id + depósito + nombre viejo: si se corre dos veces, la segunda
--  no encuentra el nombre viejo y no hace nada.
update public.imp_estanterias e
   set nombre = v.nuevo
  from (values
    (1, 'Furriol', 'Estantería 1', 'Estantería A'),
    (5, 'Furriol', 'Estantería 2', 'Estantería B'),
    (8, 'Furriol', 'Estantería 3', 'Estantería C'),
    (3, 'Furriol', 'Estantería 4', 'Estantería D'),
    (9, 'Furriol', 'Estantería 5', 'Estantería E'),
    (7, 'Furriol', 'Estantería 6', 'Estantería F'),
    (2, 'Artigas', 'Estantería 1', 'Estantería A'),
    (6, 'Artigas', 'Estantería 2', 'Estantería B')
  ) as v(id, dep, viejo, nuevo)
 where e.id = v.id and e.deposito = v.dep and e.nombre = v.viejo;

-- ── 2. Número de lugar ───────────────────────────────────────
--  2 lugares de pallet por bahía (POS_PER_BAY en la app).
create or replace function public.imp_pos_num(p_est bigint, p_fila int, p_col int)
returns int language sql stable set search_path = public as $$
  select case
    when p_est is null or p_fila is null or p_col is null then null
    else (select (e.filas - p_fila) * e.columnas * 2 + p_col
            from public.imp_estanterias e where e.id = p_est)
  end;
$$;

-- Nombre corto de la estantería: "Estantería A" → "A"
create or replace function public.imp_est_corto(p_est bigint)
returns text language sql stable set search_path = public as $$
  select coalesce(
    (select regexp_replace(e.nombre, '^\s*estanter[ií]a\s+', '', 'i')
       from public.imp_estanterias e where e.id = p_est),
    'Est?');
$$;

grant execute on function public.imp_pos_num(bigint, int, int) to authenticated;
grant execute on function public.imp_est_corto(bigint)         to authenticated;

-- ── 3. Las dos funciones que arman el texto de ubicación ─────
--  Antes: "Estantería 1 · D2". Ahora: "A-12".
create or replace function public.imp_ubic_txt(p_est bigint, p_fila int, p_col int)
returns text language sql stable set search_path = public as $$
  select case
    when p_est is null or p_fila is null or p_col is null then null
    else public.imp_est_corto(p_est) || '-' || coalesce(public.imp_pos_num(p_est, p_fila, p_col)::text, '?')
  end;
$$;

create or replace function public.imp_ubic_txt2(p_est bigint, p_fila int, p_col int, p_zona bigint)
returns text language sql stable set search_path = public as $$
  select case
    when p_zona is not null then
      coalesce((select z.nombre from public.imp_zonas z where z.id = p_zona), 'Zona?')
    when p_est is not null and p_fila is not null and p_col is not null then
      public.imp_est_corto(p_est) || '-' || coalesce(public.imp_pos_num(p_est, p_fila, p_col)::text, '?')
    else null
  end;
$$;

-- ── 4. Comprobación ──────────────────────────────────────────
--  Tiene que dar 8 estanterías con letra:
-- select deposito, nombre, filas, columnas, filas*columnas*2 as lugares
--   from public.imp_estanterias order by deposito, nombre;
--
--  Cada pallet ubicado con su lugar nuevo (fila 4 = abajo, col 1 → 1):
-- select p.codigo, e.deposito, e.nombre, p.fila, p.columna,
--        public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna) as lugar
--   from public.imp_pallets p join public.imp_estanterias e on e.id = p.estanteria_id
--  order by e.deposito, e.nombre, lugar;
--
--  Lo que ve quien pide (pantalla Solicitar):
-- select codigo, subdeposito, ubicacion from public.imp_pallets_disponibles
--  where estanteria_id is not null order by ubicacion;
