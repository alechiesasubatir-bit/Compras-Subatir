-- ============================================================
--  Unificar el nombre de la botella verde de 1 L
--
--  El mismo producto tenía dos nombres:
--    inventario  → "Botella Pet x 1 L Petiza VERDE"   (id 32)
--    precios/OC  → "Botella Pet x 1 L Verde"          (OC 675, 686,
--                                                      743, 800, 841, 917)
--
--  Como el módulo de Stock cruza las OC con el inventario POR NOMBRE,
--  esa ficha nunca se enganchó con ninguna compra: se quedaba sin
--  historial de proveedor y las 3.000 unidades pedidas en la OC 917
--  no le sumaban en tránsito.
--
--  Gana el nombre de la lista de precios, que es el que ya usan todas
--  las OC. Con el rename, la ficha se lleva su tránsito y todo el
--  historial de compras de una.
--
--  El código y la categoría no se tocan: viajan con la misma fila.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── Antes: para tenerlo a la vista ───────────────────────────
select id, codigo, descripcion, inventario, stock_minimo, consumo_mensual
  from public.inventario
 where descripcion ilike '%petiza%' or descripcion ilike '%1 l verde%'
 order by id;

-- ── El rename ────────────────────────────────────────────────
--  Con la guarda de que no exista ya otra ficha con el nombre nuevo:
--  si existiera, esto no hace nada y hay que fusionarlas a mano.
update public.inventario
   set descripcion = 'Botella Pet x 1 L Verde'
 where descripcion = 'Botella Pet x 1 L Petiza VERDE'
   and not exists (
     select 1 from public.inventario i2
      where i2.descripcion = 'Botella Pet x 1 L Verde'
   );

-- ── Comprobar ────────────────────────────────────────────────
--  Tiene que quedar UNA sola fila "Botella Pet x 1 L Verde" y
--  seguir estando la "Botella Pet x 1 L Petiza" (la natural).
select id, codigo, descripcion, inventario, stock_minimo, consumo_mensual
  from public.inventario
 where descripcion ilike '%botella pet x 1 l%'
 order by descripcion;

-- Y estas son las OC que la ficha se va a llevar (917 es la pendiente):
select n_orden, fecha, cantidad, f_recepcion
  from public.pedidos
 where descripcion ilike 'botella pet x 1 l%verde'
 order by fecha desc;
