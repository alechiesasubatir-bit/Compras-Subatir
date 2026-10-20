-- ============================================================
--  PERMISOS DE LA DATA API  ·  octubre 2026
--
--  Desde el 30/10/2026 Supabase ya no les da permisos automáticos
--  a las tablas nuevas de "public". Las que ya existen conservan los
--  suyos, así que correr esto hoy NO cambia nada: deja escrito qué
--  permisos necesita cada tabla para que la app las pueda leer y
--  escribir.
--
--  Sirve sobre todo si algún día hay que rearmar la base en un
--  proyecto nuevo: se corre DESPUÉS de todos los SQL que crean
--  tablas y vistas. Sin esto la app da "permission denied" aunque
--  las políticas RLS estén bien.
--
--  - authenticated: el rol de cualquier usuario logueado. RLS sigue
--    decidiendo qué filas ve y toca cada uno.
--  - service_role: el del panel y de scripts de servidor.
--  - anon: NADA. La app es toda con login.
--
--  Si una tabla de la lista ya no existe (contingencia, conteos) se
--  saltea con un aviso, no da error. Se puede correr varias veces.
--
--  De acá en adelante cada SQL que cree una tabla trae sus propios
--  grant al final, como conteos.sql o pedidos_varios.sql.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  t text;
  tablas text[] := array[
    -- Base (schema.sql)
    'profiles', 'proveedores', 'precios', 'pedidos', 'inventario',
    'contingencia',
    -- Compras
    'categorias', 'entregas', 'art_proveedor',
    'pedidos_varios', 'pedidos_varios_items',
    'conteos', 'conteo_lineas',
    -- Calidad MP
    'mp_documentos',
    -- Importaciones (MERO AR)
    'mp_proveedores', 'mp_articulos', 'mp_parametros', 'mp_corridas',
    'mp_datos', 'mp_ofertas', 'mp_productos', 'mp_producto_esencias',
    -- Previsión Cloro
    'cl_temporadas', 'cl_materias', 'cl_productos', 'cl_ventas',
    'cl_envasado', 'cl_stock_inicial', 'cl_parametros', 'cl_ajustes',
    -- Depósitos
    'imp_depositos', 'imp_estanterias', 'imp_articulos', 'imp_stock',
    'imp_pallets', 'imp_movimientos', 'imp_zonas', 'imp_subdepositos',
    'imp_solicitudes', 'imp_solicitud_items', 'imp_tandas',
    -- Importaciones (líneas de Depósitos)
    'imp_prev_parametros', 'imp_prev_corridas', 'imp_prev_datos'
  ];
  vistas text[] := array[
    'imp_subdep_uso', 'imp_pallets_disponibles', 'imp_solicitud_resumen',
    'imp_en_transito_quien', 'imp_por_recibir', 'imp_pallet_ult_ranura',
    'imp_infra_pendientes', 'imp_infra_traza', 'imp_en_camino'
  ];
begin
  foreach t in array tablas loop
    if to_regclass('public.' || t) is null then
      raise notice 'tabla % no existe, se saltea', t;
    else
      execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    end if;
  end loop;

  -- Las vistas son de lectura: la app escribe en las tablas de abajo.
  foreach t in array vistas loop
    if to_regclass('public.' || t) is null then
      raise notice 'vista % no existe, se saltea', t;
    else
      execute format('grant select on public.%I to authenticated, service_role', t);
    end if;
  end loop;
end $$;

-- Los id autonuméricos: sin esto el INSERT falla al pedir el próximo
-- número aunque la tabla tenga permiso.
grant usage, select on all sequences in schema public to authenticated, service_role;


-- ── Control ─────────────────────────────────────────────────
--  Tablas y vistas de "public" que la app todavía no puede leer.
--  Tiene que salir VACÍO. Si aparece algo, es una tabla que no está
--  en la lista de arriba: agregarla y volver a correr.
select c.relname as nombre,
       case c.relkind when 'v' then 'vista' when 'm' then 'vista materializada' else 'tabla' end as tipo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind in ('r', 'p', 'v', 'm')
   and not has_table_privilege('authenticated', c.oid, 'select')
 order by 1;
