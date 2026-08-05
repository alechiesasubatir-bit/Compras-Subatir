-- ============================================================
--  PEDIDOS — columna "codigo" (código del artículo)
--
--  Los listados de Pedidos y Recepción tienen que mostrar el
--  código, pero la tabla `pedidos` nunca lo tuvo: sólo guarda la
--  descripción escrita a mano. Se agrega la columna y se rellena
--  lo que se pueda deducir sin inventar nada.
--
--  Criterio del relleno: la descripción del pedido, normalizada
--  (sin tildes, sin signos, mayúsculas), tiene que coincidir
--  EXACTA con un artículo del listado de precios o del inventario,
--  y ese nombre tiene que apuntar a UN SOLO código. Si dos códigos
--  comparten nombre, se deja vacío: es preferible el guión al
--  código equivocado en una orden de compra.
--
--  Cobertura esperada: ~81 de 605 renglones. El resto queda en
--  blanco y se completa a mano desde el botón Editar de Pedidos,
--  o con una tabla de equivalencias revisada (como se hizo con
--  los proveedores en normalizar_mapping.json).
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente:
--  sólo toca los renglones que están sin código.
-- ============================================================

-- ── 1. La columna ────────────────────────────────────────────
alter table public.pedidos add column if not exists codigo text;
comment on column public.pedidos.codigo is
  'Código del artículo. Se muestra en los listados de Pedidos y Recepción.';

-- ── 2. Clave de comparación: sin tildes, sin signos, mayúsculas ─
create or replace function public.txt_clave(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           upper(translate(coalesce(p,''),
                 'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛ',
                 'aeiouunAEIOUUNaeiouAEIOUaeiouAEIOU')),
           '[^A-Z0-9]+', ' ', 'g'))
$$;

-- ── 3. Relleno desde PRECIOS (nombres que apuntan a un solo código) ─
with cat as (
  select public.txt_clave(articulo) as k, min(codigo) as codigo
    from public.precios
   where coalesce(btrim(codigo),'') <> '' and coalesce(btrim(articulo),'') <> ''
   group by 1
  having count(distinct btrim(codigo)) = 1
)
update public.pedidos p
   set codigo = cat.codigo
  from cat
 where coalesce(btrim(p.codigo),'') = ''
   and public.txt_clave(p.descripcion) = cat.k;

-- ── 4. Segunda pasada desde INVENTARIO, para lo que quedó vacío ─
with cat as (
  select public.txt_clave(descripcion) as k, min(codigo) as codigo
    from public.inventario
   where coalesce(btrim(codigo),'') <> '' and coalesce(btrim(descripcion),'') <> ''
   group by 1
  having count(distinct btrim(codigo)) = 1
)
update public.pedidos p
   set codigo = cat.codigo
  from cat
 where coalesce(btrim(p.codigo),'') = ''
   and public.txt_clave(p.descripcion) = cat.k;

-- ── 5. Cómo quedó ────────────────────────────────────────────
select count(*)                                                as renglones,
       count(*) filter (where coalesce(btrim(codigo),'') <> '') as con_codigo,
       count(*) filter (where coalesce(btrim(codigo),'') =  '') as sin_codigo
  from public.pedidos;

-- Las descripciones que quedaron sin código, de la más repetida a
-- la menos, para atacar primero las que más rinden:
-- select descripcion, count(*) as renglones
--   from public.pedidos
--  where coalesce(btrim(codigo),'') = ''
--  group by 1 order by 2 desc, 1 limit 40;
