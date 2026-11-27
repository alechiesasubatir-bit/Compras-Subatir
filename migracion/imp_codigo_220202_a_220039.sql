-- ============================================================
--  IMPORTACIONES / DEPÓSITOS · Subatir Consumo
--  "Botella PET 60 ml con spray Blanco" (imp_articulos id 246):
--  el código 220202 está mal, es 220039.
--
--  Pedido del usuario 27/11/2026. Importa porque los listados de
--  consumo de Importaciones se cruzan por código (columna A): con
--  220202 la botella tomaba el renglón de otro artículo.
--
--  Sólo cambia imp_articulos.codigo. Corridas, pallets y movimientos
--  apuntan al artículo por id, así que lo siguen viendo igual. NO toca
--  Compras (inventario/precios), donde 220202 y 220039 son dos
--  artículos distintos de Impofra.
--
--  Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

update public.imp_articulos
set codigo = '220039'
where id = 246
  and codigo = '220202'
  and proveedor = 'Subatir'
  and tipo = 'Consumo'
  and not exists (select 1 from public.imp_articulos o where o.codigo = '220039' and o.id <> 246);

-- Control: tiene que devolver un solo renglón, id 246 con 220039
select id, codigo, descripcion, proveedor, tipo
from public.imp_articulos
where codigo in ('220202','220039') or id = 246;
