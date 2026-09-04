-- ============================================================
--  UN PROVEEDOR, UNA SOLA FICHA
--
--  El maestro de proveedores no tenia ninguna restriccion de unicidad:
--  nada impedia dos fichas con el nombre identico. Asi aparecieron las
--  dos de "Wurth Uruguay S.A" el 2026-09-03, con 56 segundos de
--  diferencia y los mismos datos.
--
--  La causa estaba en varios.html (ya corregida): al guardar un pedido
--  vario, el INSERT de la ficha salia en paralelo con el SELECT que
--  recarga el maestro en memoria, y el SELECT ganaba la carrera. El
--  siguiente guardado no veia la ficha recien creada y la insertaba
--  otra vez.
--
--  Ese arreglo cierra el caso real, pero es una defensa en el navegador:
--  con dos pestanias abiertas, o dos personas guardando a la vez, la
--  ventana sigue existiendo. La unicidad solo la puede garantizar la
--  base. Este indice la garantiza.
--
--  Estado leido de la base el 2026-09-04 (antes de correr):
--    65 fichas, CERO nombres repetidos al normalizar.
--    (Diamaler ya fusionada con MULTIPACK, Wurth ya deduplicada.)
--    El indice entra limpio.
--
--  Idempotente: se puede correr mas de una vez sin efecto extra.
--  Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- ============================================================

-- ── 1) Freno de mano ────────────────────────────────────────
--    Si quedara algun nombre repetido, el create index de abajo
--    fallaria con un error dificil de leer. Mejor cortar antes y
--    decir exactamente cuales son.
do $$
declare repetidos text;
begin
  select string_agg(nombre || ' (' || veces || ' fichas)', ', ')
    into repetidos
    from (
      select upper(regexp_replace(btrim(empresa), '\s+', ' ', 'g')) as nombre,
             count(*) as veces
        from public.proveedores
       where empresa is not null
       group by 1
      having count(*) > 1
    ) d;

  if repetidos is not null then
    raise exception
      'Hay nombres repetidos en proveedores, hay que fusionarlos antes: %',
      repetidos;
  end if;
end $$;

-- ── 2) El indice ────────────────────────────────────────────
--    Normaliza igual que normProv() en varios.html: recorta los
--    extremos, colapsa los espacios internos y compara en mayusculas.
--    Asi "MULTIPACK", "Multipack" y " Multipack  S.A " distinta de
--    "MULTIPACK S.A" no pueden convivir como fichas separadas.
--
--    NOTA: a diferencia de normProv(), NO saca acentos. unaccent() no
--    es IMMUTABLE y no se puede usar dentro de un indice sin envolverla
--    en una funcion propia. En la practica alcanza: los duplicados que
--    aparecieron fueron por mayusculas y espacios, no por tildes.
--
--    Las filas con empresa en null quedan afuera (un indice unico
--    admite varios null), que es lo correcto: una ficha sin nombre es
--    un problema distinto.
create unique index if not exists proveedores_empresa_norm_uidx
  on public.proveedores (upper(regexp_replace(btrim(empresa), '\s+', ' ', 'g')));

-- ============================================================
--  VERIFICACION
-- ============================================================
select 'indice creado (esperado 1)' as chequeo, count(*) as filas
  from pg_indexes
 where schemaname = 'public'
   and indexname  = 'proveedores_empresa_norm_uidx';

select 'fichas en el maestro' as chequeo, count(*) as filas from public.proveedores;

-- Prueba de que el freno funciona (deberia dar error de clave duplicada
-- y NO insertar nada). Descomentar solo si se quiere comprobar:
-- insert into public.proveedores (empresa) values ('multipack');

-- ============================================================
--  ROLLBACK (solo si hay que volver atras — descomentar y correr)
-- ============================================================
-- drop index if exists public.proveedores_empresa_norm_uidx;
