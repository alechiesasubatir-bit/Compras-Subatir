-- ============================================================
--  IMPORTACIONES · Subatir · corrida "Importacion Noviembre 2026"
--  (25/11/2026): se suman los 12 artículos de Venta (hornitos,
--  humidifer y mechas) con su consumo.
--
--  Pedido del usuario 27/11/2026. Fuente: «Ranking por Articulo»,
--  ventas (Cantidad):
--    · Hornitos humidifer mecha 1 año.xlsx    25/11/2025 → 25/11/2026
--    · Hornitos humidifer mecha 3 meses.xlsx  25/08/2026 → 25/11/2026
--  Stock: el de Depósitos al 27/11/2026 (0 en los 12). Remanente,
--  tránsito y confirmada en 0/vacío, como un renglón nuevo de la app.
--
--  No toca los 15 artículos de Consumo ni el estado de la corrida
--  (está reabierta; se cierra después desde la app con 🔒 Cerrar).
--  Busca la corrida por nombre+fecha+línea y los artículos por
--  código. Idempotente: si se corre dos veces, deja los mismos
--  números. Correr en Supabase → SQL Editor.
-- ============================================================

with corr as (
  select id from public.imp_prev_corridas
  where linea = 'Subatir' and nombre = 'Importacion Noviembre 2026' and fecha = '2026-11-25'
),
v(codigo, consumo_3m, consumo_anual) as (values
  ('490187', 308.5 , 1234),  -- Humidifer Modelo 1 220 mL SD05
  ('490188', 275.25, 1101),  -- Humidifer Modelo 2 330 mL SD07
  ('490189', 320   , 1280),  -- Mecha Repuesto Humidifer 8.5 mm
  ('490198', 299.25, 1197),  -- Mecha Repuesto Humidifer 11mm
  ('490190',  34   ,  136),  -- Hornito Mediano C/ Soporte
  ('490191',  20   ,   80),  -- Hornito Madera - Ceramica
  ('490192',   0   ,    0),  -- Hornito Chico ROSA
  ('490193',  14   ,   56),  -- Hornito Grande C/ Soporte GRIS
  ('490207',  68.75,  275),  -- Hornito Grande C/ Soporte NEGRO
  ('490208', 115.5 ,  462),  -- Hornito Chico CELESTE
  ('490209', 119.75,  479),  -- Hornito Chico VERDE
  ('490210', 111.75,  447)   -- Hornito Chico VERDE OSCURO
)
insert into public.imp_prev_datos
  (corrida_id, articulo_id, consumo_3m, consumo_anual, stock_actual, remanente_fabrica, en_transito, compra_confirmada, incluir)
select corr.id, a.id, v.consumo_3m, v.consumo_anual,
       coalesce((select sum(s.cantidad) from public.imp_stock s where s.articulo_id = a.id), 0),
       0, 0, null, true
from v
join public.imp_articulos a on a.codigo = v.codigo and a.proveedor = 'Subatir' and a.tipo = 'Venta'
cross join corr
on conflict (corrida_id, articulo_id) do update
  set consumo_3m = excluded.consumo_3m,
      consumo_anual = excluded.consumo_anual;

-- Control: tiene que dar 27 renglones (15 Consumo + 12 Venta)
select a.tipo, count(*) renglones, sum(d.consumo_anual) consumo_anual
from public.imp_prev_datos d
join public.imp_prev_corridas c on c.id = d.corrida_id
join public.imp_articulos a on a.id = d.articulo_id
where c.nombre = 'Importacion Noviembre 2026' and c.fecha = '2026-11-25' and c.linea = 'Subatir'
group by a.tipo order by a.tipo;
