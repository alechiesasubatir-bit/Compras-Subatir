-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — comprobación de migraciones
--
--  Sólo lee: no modifica nada. Corrélo en Supabase → SQL Editor
--  antes y después de aplicar cada etapa para ver qué versión
--  tiene la base. Cubre de v2 a v14.
--
--  Las etapas son idempotentes CONSIGO MISMAS pero NO entre sí
--  (v2 encima de v3 hace daño), así que conviene mirar esto antes
--  de correr cualquier cosa.
-- ============================================================
select v.etapa, v.que_aporta,
       case when v.ok then '✅ aplicado' else '❌ FALTA' end as estado
from (
  -- ── v2 ────────────────────────────────────────────────────
  select 1 as n, 'v2' as etapa, 'Pallets: columna un_x_caja' as que_aporta,
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_pallets'
                   and column_name='un_x_caja') as ok
  union all
  select 2, 'v2', 'Movimientos: ubicacion_de / ubicacion_a',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_movimientos'
                   and column_name='ubicacion_a')
  union all
  select 3, 'v2', 'Estanterías: plano_fila / plano_orden',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_estanterias'
                   and column_name='plano_orden')
  union all
  select 4, 'v2', 'Función imp_pallet_cerrar (cierre = recepción)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_pallet_cerrar')

  -- ── v3 ────────────────────────────────────────────────────
  union all
  select 5, 'v3', 'Depósitos: columna tipo (ALMACEN / FABRICA)',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_depositos'
                   and column_name='tipo')
  union all
  select 6, 'v3', 'Tabla imp_zonas (zonas de fábrica)',
         exists(select 1 from information_schema.tables
                 where table_schema='public' and table_name='imp_zonas')
  union all
  select 7, 'v3', 'Pallets: estado CONSUMIDO permitido',
         exists(select 1 from pg_constraint
                 where conname='imp_pallets_estado_check'
                   and pg_get_constraintdef(oid) like '%CONSUMIDO%')
  union all
  -- Acá había un chequeo de "imp_pallet_scan con 3 parámetros (zona)".
  -- Se quitó porque v6 la borra a propósito (drop function ... (text,
  -- text, bigint)) al sacar las zonas del flujo: con v6 aplicado ese
  -- chequeo da FALTA aunque la base esté perfecta. El estado bueno lo
  -- controla el punto 16. Lo que v3 aportó y sigue vigente es la
  -- columna zona_id, que mantiene legible la bitácora vieja.
  select 8, 'v3', 'Pallets: columna zona_id (bitácora vieja legible)',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_pallets'
                   and column_name='zona_id')
  union all
  select 9, 'v3', 'Vista imp_en_camino (aviso en Compras)',
         exists(select 1 from information_schema.views
                 where table_schema='public' and table_name='imp_en_camino')

  -- ── v4 ────────────────────────────────────────────────────
  union all
  select 10, 'v4', 'Pallets: columna remanente',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_pallets'
                   and column_name='remanente')
  union all
  select 11, 'v4', 'imp_pallet_contar acepta remanente (5 parámetros)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_pallet_contar'
                   and p.pronargs=5)
  union all
  select 12, 'v4', 'No quedó la versión vieja de imp_pallet_contar',
         not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='imp_pallet_contar'
                       and p.pronargs=4)

  -- ── v5 — el cambio grande: la mercadería entra suelta ──────
  union all
  select 13, 'v5', 'imp_ingreso (la puerta de entrada al stock)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_ingreso')
  union all
  select 14, 'v5', 'imp_pallet_armar (armar RESERVA, no suma stock)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_pallet_armar')
  union all
  select 15, 'v5', 'imp_disponible (stock menos lo ya reservado)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_disponible')

  -- ── v6 — al escanear ya no se pregunta la zona ─────────────
  union all
  select 16, 'v6', 'imp_pallet_scan sin zona (2 parámetros)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_pallet_scan'
                   and p.pronargs=2)

  -- ── v7 — se fue el modelo viejo de transferencia ───────────
  union all
  select 17, 'v7', 'imp_transfer ya no existe',
         not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname='imp_transfer')

  -- ── v8 — corregir sin romper la trazabilidad ───────────────
  union all
  select 18, 'v8', 'imp_pallet_reabrir + imp_pallet_desmarcar',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public'
             and p.proname in ('imp_pallet_reabrir','imp_pallet_desmarcar')) = 2

  -- ── v9 — tipo "Venta Piscina" ──────────────────────────────
  --  imp_articulos.tipo es texto libre: no hay constraint que
  --  mirar, así que se comprueba que existan los artículos.
  union all
  select 19, 'v9', 'Artículos con tipo "Venta Piscina"',
         exists(select 1 from public.imp_articulos where tipo = 'Venta Piscina')

  -- ── v10 — el ingreso guarda el antes y el después ──────────
  union all
  select 20, 'v10', 'Movimientos: stock_antes / stock_despues',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_movimientos'
                   and column_name='stock_despues')

  -- ── v11 — Config Depósito: la planta se dibuja ─────────────
  union all
  select 21, 'v11', 'Depósitos: medidas de la nave (ancho_m / largo_m)',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_depositos'
                   and column_name='ancho_m')
  union all
  select 22, 'v11', 'Tabla imp_subdepositos (rectángulos dibujados)',
         exists(select 1 from information_schema.tables
                 where table_schema='public' and table_name='imp_subdepositos')
  union all
  select 23, 'v11', 'Estanterías: coordenadas reales (x_m / y_m / rot_deg)',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_estanterias'
                   and column_name='rot_deg')
  union all
  select 24, 'v11', 'Pallets: subdeposito_id (los sueltos, en un área)',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='imp_pallets'
                   and column_name='subdeposito_id')
  union all
  select 25, 'v11', 'Vista imp_subdep_uso (qué cuelga de cada uno)',
         exists(select 1 from information_schema.views
                 where table_schema='public' and table_name='imp_subdep_uso')

  -- ── v12 — las letras de nivel se cuentan desde abajo ───────
  union all
  select 26, 'v12', 'imp_nivel_letra (A abajo, D arriba)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_nivel_letra')

  -- ── v13 — llegar a la fabrica ya no consume ────────────────
  union all
  select 27, 'v13', 'imp_pallet_consumir (el consumo es un paso aparte)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_pallet_consumir')

  -- ── v14 — solicitudes de mercaderia ────────────────────────
  union all
  select 28, 'v14', 'Tablas imp_solicitudes / imp_solicitud_items',
         (select count(*) from information_schema.tables
           where table_schema='public'
             and table_name in ('imp_solicitudes','imp_solicitud_items')) = 2
  union all
  select 29, 'v14', 'Vista imp_pallets_disponibles',
         exists(select 1 from information_schema.views
                 where table_schema='public' and table_name='imp_pallets_disponibles')
  union all
  select 30, 'v14', 'Reserva: indice unico de pallet por solicitud viva',
         exists(select 1 from pg_indexes where schemaname='public'
                 and indexname='imp_solicitud_items_pallet_vivo')
  union all
  select 31, 'v14', 'Trigger que avanza la solicitud al escanear',
         exists(select 1 from pg_trigger where tgname='trg_imp_sol_sync')

  -- ── v15 — estanterías con cuatro orientaciones ─────────────
  union all
  select 32, 'v15', 'Estanterías: rot_deg admite 180 y 270',
         exists(select 1 from pg_constraint
                 where conname='imp_estanterias_rot_check'
                   and pg_get_constraintdef(oid) like '%270%')
) v
order by v.n;
