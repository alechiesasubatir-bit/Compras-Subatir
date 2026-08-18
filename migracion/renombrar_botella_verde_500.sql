-- ============================================================
--  Unificar el nombre de la botella verde de 500 mL
--
--  Mismo caso que la de 1 L (ver renombrar_botella_verde.sql):
--    inventario  → "Botella Pet x 500 mL Cilindrica  VERDE"  (id 34)
--    precios/OC  → "Botella Pet x 500 mL Verde"              (OC 906)
--
--  La ficha figura sin proveedor porque nunca se le pudo asociar una
--  compra: todas se cargaron con el nombre de la lista de precios.
--  Hoy no hay ninguna OC pendiente de esta botella, así que no hay
--  nada invisible en tránsito; lo que se gana es enganchar el
--  historial y que la próxima que pidan caiga en su ficha.
--
--  OJO: el nombre viejo tiene DOS espacios antes de "VERDE", por eso
--  el update va por id y no por texto.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── Antes ────────────────────────────────────────────────────
select id, codigo, descripcion, inventario, stock_minimo, consumo_mensual
  from public.inventario
 where descripcion ilike '%500 mL%Cilindrica%' or descripcion ilike '%500 mL Verde%'
 order by id;

-- ── El rename ────────────────────────────────────────────────
--  Va por id para no depender del doble espacio, y con la guarda de
--  que no exista ya otra ficha con el nombre nuevo.
update public.inventario
   set descripcion = 'Botella Pet x 500 mL Verde'
 where id = 34
   and descripcion ilike 'Botella Pet x 500 mL Cilindrica%VERDE'
   and not exists (
     select 1 from public.inventario i2
      where i2.descripcion = 'Botella Pet x 500 mL Verde'
   );

-- ── Comprobar ────────────────────────────────────────────────
--  Tienen que quedar DOS fichas distintas: la cilíndrica natural
--  (220038) y la verde, ahora con el nombre de la lista de precios.
select id, codigo, descripcion, inventario, stock_minimo, consumo_mensual
  from public.inventario
 where descripcion ilike '%botella pet x 500 ml%'
 order by descripcion;

-- Y estas son las compras que la ficha se va a llevar:
select n_orden, fecha, cantidad, f_recepcion
  from public.pedidos
 where descripcion ilike 'botella pet x 500 ml verde'
 order by fecha desc;
