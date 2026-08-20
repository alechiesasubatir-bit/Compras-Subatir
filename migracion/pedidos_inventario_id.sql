-- ============================================================
--  PEDIDOS — vínculo real con la ficha de inventario
--
--  Hasta ahora la línea de una OC guardaba el NOMBRE del artículo
--  como texto, y todo lo que viene después —el tránsito en Stock,
--  la suma al stock al recibir— se resolvía cruzando ese texto
--  contra inventario.descripcion.
--
--  Eso funciona mientras los nombres coincidan, y se rompe solo con
--  que alguien renombre un artículo después de emitir la orden: la
--  mercadería en tránsito cambia de dueño sin que nadie la toque.
--  Pasó dos veces con las botellas verdes.
--
--  Con esta columna la orden sabe a qué ficha pertenece, y deja de
--  importar cómo se llame después.
--
--  Las órdenes viejas se siguen resolviendo por nombre, igual que
--  hoy: acá sólo se rellenan las que no dejan lugar a dudas.
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente.
-- ============================================================

alter table public.pedidos add column if not exists inventario_id bigint;

comment on column public.pedidos.inventario_id is
  'Ficha de inventario del artículo. Lo escribe el alta de OC. Sin esto, Recepción y Stock cruzan por nombre.';

create index if not exists idx_pedidos_inventario on public.pedidos(inventario_id);

-- ── Relleno de lo que no admite duda ─────────────────────────
--  Criterio: la descripción de la línea, normalizada, coincide
--  EXACTA con UNA sola ficha. Si empata con dos, se deja vacío: es
--  preferible el cruce por nombre a apuntar a la ficha equivocada
--  para siempre.
--
--  txt_clave() ya existe (la creó pedidos_codigo.sql) y es la misma
--  normalización que se usó para rellenar el código: sin tildes, sin
--  signos, mayúsculas. Se reusa para que las dos columnas no se
--  llenen con criterios distintos.
create or replace function public.txt_clave(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           upper(translate(coalesce(p,''),
                 'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛ',
                 'aeiouunAEIOUUNaeiouAEIOUaeiouAEIOU')),
           '[^A-Z0-9]+', ' ', 'g'))
$$;

with unicas as (
  select public.txt_clave(descripcion) as k, min(id) as inv_id
    from public.inventario
   where coalesce(btrim(descripcion),'') <> ''
   group by 1
  having count(*) = 1
)
update public.pedidos p
   set inventario_id = u.inv_id
  from unicas u
 where p.inventario_id is null
   and public.txt_clave(p.descripcion) = u.k;

-- ── Comprobar ────────────────────────────────────────────────
select count(*) filter (where inventario_id is not null) as con_ficha,
       count(*) filter (where inventario_id is null)     as por_nombre,
       count(*)                                          as total
  from public.pedidos;
