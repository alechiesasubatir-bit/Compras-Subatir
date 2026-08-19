-- ============================================================
--  Fusionar las dos fichas de Hipoclorito de Sodio
--
--  Quedaron dos fichas del MISMO insumo:
--    148 → "Hipoclorito de Sodio 100 grs/Lt (Materia Prima)"
--          sin código, sin categoría, pero con los datos reales:
--          stock 12.000 · mínimo 4.000 · consumo 50.000
--    151 → "Hipoclorito de Sodio 100grs/Lt"
--          código 221866 y categoría MP, pero vacía de datos
--
--  La 151 la creó de más la regla nueva de Precios (todo artículo del
--  catálogo tiene ficha), porque comparaba el nombre exacto y estos
--  dos difieren por un espacio y por el "(Materia Prima)" del final.
--  Ya se corrigió: ahora avisa cuando hay una ficha parecida.
--
--  Gana el nombre de la 151, que es el que usan las 5 OC del historial
--  y la lista de precios ("Hipoclorito de Sodio 100grs/Lt"), incluida
--  la OC 920 que está pendiente por 12.000. Con eso la ficha se lleva
--  el tránsito y el historial.
--
--  Entonces: se pasan los números de la 148 a la 151 y se borra la 148.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── Antes ────────────────────────────────────────────────────
select id, codigo, descripcion, inventario, stock_minimo, consumo_mensual, ext_id
  from public.inventario
 where descripcion ilike '%hipoclorito%'
 order by id;

-- ── Pasar los datos operativos a la ficha que se queda ───────
update public.inventario dest
   set inventario      = src.inventario,
       stock_minimo    = src.stock_minimo,
       consumo_mensual = src.consumo_mensual
  from public.inventario src
 where dest.id = 151
   and src.id  = 148
   and dest.descripcion = 'Hipoclorito de Sodio 100grs/Lt';

-- ── Borrar la ficha vieja ────────────────────────────────────
--  Se borra sólo si la otra ya quedó con el stock: así, si el update
--  de arriba no corrió, esto tampoco y no se pierde nada.
delete from public.inventario
 where id = 148
   and exists (
     select 1 from public.inventario
      where id = 151 and inventario is not null
   );

-- ── Comprobar ────────────────────────────────────────────────
--  Tiene que quedar UNA sola ficha, con código 221866, categoría MP,
--  stock 12.000, mínimo 4.000 y consumo 50.000.
select id, codigo, descripcion, inventario, stock_minimo, consumo_mensual, ext_id
  from public.inventario
 where descripcion ilike '%hipoclorito%'
 order by id;
