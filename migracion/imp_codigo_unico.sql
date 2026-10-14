-- ============================================================
--  DEPÓSITOS · un código no se repite dentro del mismo proveedor
--
--  El 12/10 se dio de alta "30ML PET bottle" con el código 220210,
--  que ya era del Envase Unicornio 30 mL. Quedaron dos fichas del
--  mismo artículo, cada una con su stock y sus pallets, y hubo que
--  fusionarlas a mano (imp_fusionar_30ml_pet.sql). La base sólo
--  impedía repetir la DESCRIPCIÓN, y el duplicado entró con otro
--  nombre.
--
--  Se compara sin espacios de los costados: " 220210" es 220210.
--  Los artículos sin código (hoy 3) siguen permitidos.
--
--  Correr DESPUÉS de imp_fusionar_30ml_pet.sql. Si todavía hubiera
--  un código repetido, el índice no se crea: la consulta de abajo
--  dice cuál.
--  Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Repetidos (tiene que dar 0 filas) ────────────────────
select proveedor, btrim(codigo) as codigo, count(*), string_agg(id || ': ' || descripcion, ' | ')
  from public.imp_articulos
 where nullif(btrim(codigo), '') is not null
 group by proveedor, btrim(codigo)
having count(*) > 1;

-- ── 2. El índice ────────────────────────────────────────────
create unique index if not exists imp_articulos_prov_codigo_uq
  on public.imp_articulos (proveedor, btrim(codigo))
  where nullif(btrim(codigo), '') is not null;

-- ── Control: tiene que aparecer el índice ───────────────────
select indexname from pg_indexes
 where tablename = 'imp_articulos' and indexname = 'imp_articulos_prov_codigo_uq';
