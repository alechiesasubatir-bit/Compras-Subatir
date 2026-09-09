-- ============================================================
--  PREVISIÓN CLORO  ·  sacar la merma
--
--  `cl_productos.merma_pct` era el porcentaje de materia prima que se
--  compraba de más sobre el teórico, por lo que se pierde al envasar
--  (polvo en la tolva, sobrellenado, envases rechazados). Se saca porque
--  no se va a usar: un porcentaje que queda siempre en cero es una
--  perilla más que explicar en Configuración sin que cambie un número.
--
--  Los kg de MP pasan a ser el teórico puro, unidades × kg por unidad.
--  Con merma en 0 el factor ya era (1 + 0) = 1, así que ningún número de
--  la pantalla cambia por esto. El SELECT de control de acá abajo lo
--  confirma ANTES de tocar nada.
--
--  ORDEN: publicar cloro.html primero y correr esto después. Al revés,
--  la pantalla vieja sigue mandando merma_pct en el update de
--  Configuración y guardar tiraría error contra una columna que ya no
--  existe.
--
--  Es IRREVERSIBLE (el drop se lleva los valores). Para volver atrás
--  está cloro_quitar_merma_rollback.sql, que recrea la columna en 0.
-- ============================================================

-- 1) Control previo: tiene que devolver 0 filas. Si devuelve alguna,
--    ese producto tenía una merma cargada y sus kg de MP van a BAJAR
--    cuando se aplique esto. Frenar y avisar antes de seguir.
select id, codigo, nombre, kg_mp_por_unidad, merma_pct
  from public.cl_productos
 where coalesce(merma_pct, 0) <> 0
 order by codigo;

-- 2) El drop
alter table public.cl_productos drop column if exists merma_pct;

-- 3) Control: las columnas que quedan. No tiene que estar merma_pct.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'cl_productos'
 order by ordinal_position;
