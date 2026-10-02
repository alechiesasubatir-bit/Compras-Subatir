-- ============================================================
--  CORRECCIÓN 01/10/2026 · Tapas Alcoa Rosca 28 CORTA (art. 165)
--
--  Qué pasó (leído de la base):
--    · INGRESO mov 294: Furriol 0 → 270.000   (debía ser 204.000)
--    · Pallet 71 PLT-MUPO318V-0ECC armado con 75.000, ubicado en
--      Estantería 5 · D3 y después reabierto (estado ABIERTO).
--
--  Qué hace:
--    1. Anula el pallet 71: borra el pallet y su bitácora
--       (ARMADO / UBICACION / REAPERTURA). Armar no suma stock,
--       así que las 75.000 vuelven solas al disponible.
--    2. Deja el stock de Furriol en 204.000.
--    3. Corrige el renglón del INGRESO a 204.000 (con nota), para
--       que el reporte de Ingresos muestre lo que entró de verdad.
--
--  Aborta sin tocar nada si el estado ya no es el de arriba
--  (stock distinto de 270.000, pallet movido, u otro movimiento
--  del artículo posterior al reabrir).
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  v_stock numeric;
  v_estado text;
  v_otros int;
begin
  select cantidad into v_stock from public.imp_stock
   where articulo_id = 165 and deposito = 'Furriol';
  select estado into v_estado from public.imp_pallets
   where id = 71 and codigo = 'PLT-MUPO318V-0ECC' and articulo_id = 165;
  select count(*) into v_otros from public.imp_movimientos
   where articulo_id = 165 and id > 297;

  if v_stock = 204000 and v_estado is null then
    raise notice 'Ya estaba corregido: no se hace nada.';
    return;
  end if;
  if v_stock is distinct from 270000 then
    raise exception 'El stock de Furriol es % (esperaba 270000). No se toca nada.', v_stock;
  end if;
  if v_estado is distinct from 'ABIERTO' then
    raise exception 'El pallet 71 está en estado % (esperaba ABIERTO). No se toca nada.', v_estado;
  end if;
  if v_otros > 0 then
    raise exception 'Hay % movimientos nuevos del artículo después del 297. Revisar antes.', v_otros;
  end if;

  -- 1. Anular el pallet
  delete from public.imp_movimientos where pallet_id = 71;
  delete from public.imp_pallets where id = 71;

  -- 2. Stock real
  update public.imp_stock set cantidad = 204000
   where articulo_id = 165 and deposito = 'Furriol';

  -- 3. El ingreso fue de 204.000
  update public.imp_movimientos
     set unidades = 204000, stock_despues = 204000,
         nota = 'Corregido 01/10/2026: se había cargado 270.000'
   where id = 294 and tipo = 'INGRESO' and articulo_id = 165;

  raise notice 'Listo: pallet 71 anulado, Furriol en 204.000, ingreso 294 corregido.';
end $$;

-- ── Verificación ─────────────────────────────────────────────
select 'stock' as que, deposito as donde, cantidad::text as valor
  from public.imp_stock where articulo_id = 165
union all
select 'pallets activos', coalesce(string_agg(codigo, ', '), '(ninguno)'), count(*)::text
  from public.imp_pallets
 where articulo_id = 165 and estado in ('ABIERTO','ESTACIONADO')
union all
select 'ingreso 294', nota, unidades::text
  from public.imp_movimientos where id = 294;
