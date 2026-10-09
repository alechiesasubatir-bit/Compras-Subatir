-- Pastilla Triple Accion (218851) no aparecia en el selector de productos de
-- Solsire al hacer una OC: el selector sale de la tabla `precios` y el
-- articulo nunca tuvo fila ahi. La OC 975 (16/09/2026) se cargo escribiendo
-- el producto a mano.
--
-- Precio: el de la OC 975, U$S 2,56 s/IVA. Pago: el mismo que la otra
-- pastilla de Solsire en U$S (30 DIAS). Se puede corregir despues en Precios.
-- Nombre: el del inventario (fila id 107, la que tiene stock).

insert into public.precios
  (fecha_actualizado, codigo, articulo, proveedor, precio_usd, modalidad_pago)
select current_date, '218851', 'Pastilla Triple Accion', 'Solsire S.A.', 2.56, '30 DIAS'
where not exists (
  select 1 from public.precios
  where codigo = '218851' and proveedor = 'Solsire S.A.'
);

-- Verificacion: tiene que devolver una fila
select id, codigo, articulo, proveedor, precio_usd, modalidad_pago
from public.precios
where codigo = '218851';
