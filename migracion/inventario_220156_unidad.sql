-- La fila 220156 "Pastillas Cloro JACUZZI 50 Grs" tiene unidad 'g' y son
-- 132 KG, no 132 gramos. Lo confirmo el usuario: la descripcion habla del
-- tamano de la pastilla, la materia prima entra en kilos.
--
-- En el modulo Stock `unidad` es solo una etiqueta que se concatena al
-- numero formateado -se verifico leyendo stock.html: no entra en ninguna
-- cuenta-, asi que corregirla es inocuo alla y necesario en Prevision
-- Cloro, donde todo se suma en kg.
update public.inventario set unidad = 'Kg'
 where codigo = '220156' and unidad = 'g';

select codigo, descripcion, unidad, inventario
  from public.inventario where codigo = '220156';
