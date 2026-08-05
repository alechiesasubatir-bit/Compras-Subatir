-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — BORRAR LAS PRUEBAS
--
--  Deja la base como estaba el primer día: sólo el stock crudo
--  de cada artículo en su depósito, sin ningún pallet armado.
--
--  Qué borra (todo es de las pruebas de julio):
--    · 7 pallets (2 recibidos, 2 estacionados, 2 abiertos, 1 consumido)
--    · 29 movimientos de bitácora (armados, ubicaciones, salidas,
--      entradas, consumo, reaperturas)
--    · 4 solicitudes de mercadería con sus 4 renglones
--
--  Qué NO toca:
--    · Los 119 artículos y sus unidades por caja
--    · La configuración de la planta: depósitos, medidas, las 6
--      estanterías y los 6 sub-depósitos dibujados
--    · El resto del sistema (compras, precios, proveedores…)
--
--  Stock: se reescriben las 238 filas (119 artículos × 2 depósitos)
--  con los valores originales de imp_seed.sql. Hoy sólo 5 filas
--  están corridas por las pruebas; las otras 233 quedan igual.
--
--    220105 Gatillo Pulverizador rosca 28 · Furriol  58.900 → 49.900
--    220034 Botella PET 250 ml            · Furriol   7.157 → 12.160
--    220034 Botella PET 250 ml            · Artigas   5.400 → 0
--    220031 Botella PET 100 ml            · Furriol   6.280 → 11.220
--    220031 Botella PET 100 ml            · Artigas   4.940 → 0
--
--  IMPORTANTE: no hay ningún INGRESO cargado, así que no se pierde
--  mercadería recibida de verdad. Si entre medio cargaste un
--  ingreso real, avisá ANTES de correr esto.
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente:
--  correrlo dos veces deja el mismo resultado.
-- ============================================================

-- ── 1. Antes: mirar qué hay (opcional, sólo lee) ─────────────
-- select 'pallets' as que, count(*) from public.imp_pallets
-- union all select 'movimientos', count(*) from public.imp_movimientos
-- union all select 'solicitudes', count(*) from public.imp_solicitudes;

-- ── 2. Limpiar y restaurar ───────────────────────────────────
begin;

-- Los renglones cuelgan de los pallets, pero se borran explícito
-- para no depender del cascade.
delete from public.imp_solicitud_items;
delete from public.imp_solicitudes;
delete from public.imp_movimientos;
delete from public.imp_pallets;

-- Por si algún artículo quedó sin su fila de stock en algún depósito.
insert into public.imp_stock(articulo_id, deposito, cantidad)
select a.id, d.nombre, 0
  from public.imp_articulos a
  cross join public.imp_depositos d
on conflict (articulo_id, deposito) do nothing;

-- Todo a cero y después se pisan los que tenían stock inicial.
update public.imp_stock set cantidad = 0;

with base(codigo, artigas, furriol) as (values
  ('220034',0,12160),
  ('220031',0,11220),
  ('220210',0,9767),
  ('220028',0,9830),
  ('220106',0,36400),
  ('220105',0,49900),
  ('490187',1331,0),
  ('490159',40,135),
  ('490200',0,280),
  ('490157',24,0),
  ('490203',28,0),
  ('490206',79,0),
  ('490163',95,0),
  ('490201',60,0),
  ('220132',0,47660),
  ('220209',0,1650),
  ('220040',0,16200),
  ('490084',0,78),
  ('490087',0,65),
  ('490088',0,7),
  ('490089',0,100),
  ('490091',0,174),
  ('490101',0,1),
  ('490172',0,3),
  ('490177',24,288),
  ('490178',24,264),
  ('490179',24,264),
  ('490181',24,336),
  ('490041',0,6),
  ('490042',0,12),
  ('490043',0,5),
  ('490054',0,15),
  ('490059',0,6),
  ('490062',0,24),
  ('490072',0,36)
)
update public.imp_stock s
   set cantidad = case s.deposito
                    when 'Artigas' then b.artigas
                    when 'Furriol' then b.furriol
                    else 0
                  end
  from base b
  join public.imp_articulos a on a.codigo = b.codigo
 where s.articulo_id = a.id;

commit;

-- ── 3. Después: comprobar cómo quedó ─────────────────────────
select 'pallets'     as que, count(*) as cantidad from public.imp_pallets
union all select 'movimientos', count(*) from public.imp_movimientos
union all select 'solicitudes', count(*) from public.imp_solicitudes
union all select 'items solicitud', count(*) from public.imp_solicitud_items
union all select 'filas de stock', count(*) from public.imp_stock
union all select 'artículos con stock', count(distinct articulo_id)
            from public.imp_stock where cantidad > 0;
-- Esperado: 0 pallets, 0 movimientos, 0 solicitudes, 0 items,
--           238 filas de stock y 35 artículos con stock.

-- Las cinco filas que se corrigen, para verlas ya derechas:
-- select a.codigo, a.descripcion, s.deposito, s.cantidad
--   from public.imp_stock s
--   join public.imp_articulos a on a.id = s.articulo_id
--  where a.codigo in ('220105','220034','220031')
--  order by a.codigo, s.deposito;
