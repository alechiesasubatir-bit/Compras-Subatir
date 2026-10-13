-- ============================================================
--  Lipiner S.A. · códigos nuevos en el nombre de 8 artículos
--  (pedido del usuario, 13/10/2026)
--
--  Cambia SOLO el nombre. El stock, los mínimos y el consumo no se
--  tocan, y no se crea ninguna ficha: es un UPDATE por id sobre la
--  ficha que ya existe.
--
--  El nombre vive repetido en dos tablas vivas y se cambia en las dos
--  a la vez, para que Stock y Precios no queden contradiciéndose:
--    inventario.descripcion  (ficha de stock)
--    precios.articulo        (lista de precios → de ahí salen las OC nuevas)
--
--  Lo que NO se toca, a propósito:
--    pedidos.descripcion — las OC ya emitidas son el documento de lo que
--    se pidió ese día y tienen que seguir coincidiendo con el PDF que se
--    le mandó al proveedor. No se pierde el vínculo:
--      · las OC recientes (incluidas las 2 pendientes: 905 y 1005)
--        apuntan a la ficha por inventario_id, no por nombre;
--      · las viejas sin id se cruzan por nombre ignorando lo que está
--        entre paréntesis, que es justo donde va el código. Comprobado
--        contra la base: ninguna de las 255 descripciones sin id cambia
--        de ficha con los nombres nuevos.
--
--  Va por id + código interno (no por el nombre viejo), así correrlo
--  dos veces deja el mismo resultado.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

begin;

-- ── Ficha de stock ───────────────────────────────────────────
update public.inventario as i
   set descripcion = n.nuevo,
       updated_at  = now()
  from (values
    (82,  '220201', 'Etiq. Chicas ( COD.2.3.2.542.0 ) 100 x 55 mm'),
    (83,  '220098', 'Etiq. Logo (COD. 2.3.2.426.0 ) 76 mm (2000 x R.)'),
    (84,  '220115', 'Etiq. Medianas corto ( COD 2.3.2.543.0) 102 x 78 mm (1950 x R)'),
    (85,  '220120', 'Etiq. Medianas largo ( COD 2.3.2.544.0) 102 x 78 mm (5000 x R)'),
    (86,  '220160', 'Etiq. Mini ( COD. 2.20.1.014.0 ) 50 x 25 mm'),
    (87,  '220163', 'Etiqueta GRANDE BLANCA (100 x 100) ( COD 2.2.1.078.0) 1500 UNIDAD/rollo'),
    (88,  '220109', 'Etiqueta GRANDE NUEVA (100 x 117) ( COD 2.3.2.238.1 )'),
    (121, '220207', 'Ribon 110mm x 300 mm Cera (COD 3.5.3.070)')
  ) as n(id, codigo, nuevo)
 where i.id = n.id
   and i.codigo = n.codigo;

-- ── Lista de precios ─────────────────────────────────────────
update public.precios as p
   set articulo   = n.nuevo,
       updated_at = now()
  from (values
    (109, '220201', 'Etiq. Chicas ( COD.2.3.2.542.0 ) 100 x 55 mm'),
    (110, '220098', 'Etiq. Logo (COD. 2.3.2.426.0 ) 76 mm (2000 x R.)'),
    (111, '220115', 'Etiq. Medianas corto ( COD 2.3.2.543.0) 102 x 78 mm (1950 x R)'),
    (112, '220120', 'Etiq. Medianas largo ( COD 2.3.2.544.0) 102 x 78 mm (5000 x R)'),
    (113, '220160', 'Etiq. Mini ( COD. 2.20.1.014.0 ) 50 x 25 mm'),
    (114, '220163', 'Etiqueta GRANDE BLANCA (100 x 100) ( COD 2.2.1.078.0) 1500 UNIDAD/rollo'),
    (115, '220109', 'Etiqueta GRANDE NUEVA (100 x 117) ( COD 2.3.2.238.1 )'),
    (172, '220207', 'Ribon 110mm x 300 mm Cera (COD 3.5.3.070)')
  ) as n(id, codigo, nuevo)
 where p.id = n.id
   and p.codigo = n.codigo;

commit;

-- ── Comprobar ────────────────────────────────────────────────
--  Tienen que salir 8 filas, con el mismo nombre en las dos columnas
--  y el stock igual que antes:
--    220098 16000 · 220109 24000 · 220115 74100 · 220120 50000
--    220160 21960 · 220163 3000  · 220201 8000  · 220207 60
select i.codigo, i.inventario as stock,
       i.descripcion as en_stock, p.articulo as en_precios,
       i.descripcion = p.articulo as coinciden
  from public.inventario i
  left join public.precios p on p.codigo = i.codigo
 where i.id in (82, 83, 84, 85, 86, 87, 88, 121)
 order by i.codigo;
