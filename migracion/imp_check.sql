-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — comprobación de migraciones
--
--  Sólo lee: no modifica nada. Corrélo en Supabase → SQL Editor
--  antes y después de aplicar imp_v2 / imp_v3 / imp_v4 para ver
--  qué versión tiene la base.
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
  select 8, 'v3', 'imp_pallet_scan acepta la zona (3 parámetros)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='imp_pallet_scan'
                   and p.pronargs=3)
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
) v
order by v.n;
