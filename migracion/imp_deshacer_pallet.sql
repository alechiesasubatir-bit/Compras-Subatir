-- ============================================================
--  DESHACER UN PALLET (para pruebas)
--
--  Revierte el efecto de un pallet sobre el stock y lo borra
--  junto con su bitácora. Pensado para limpiar pallets de prueba.
--
--  Cambiá el código en la primera línea del bloque y ejecutá.
--  Es seguro: si el código no existe, no hace nada.
-- ============================================================

-- ── 1. Ver primero qué hizo el pallet ────────────────────────
--    (ejecutá esto solo, para revisar antes de borrar)
select p.codigo, p.estado, p.deposito, p.unidades, p.cajas,
       m.tipo, m.deposito as mov_deposito, m.origen, m.destino,
       m.unidades as mov_unidades, m.ubicacion_de, m.ubicacion_a, m.created_at
  from public.imp_pallets p
  left join public.imp_movimientos m on m.pallet_id = p.id
 where p.codigo = 'PLT-XXXX'          -- ← poné acá el código del pallet
 order by m.created_at;

-- ── 2. Revertir y borrar ─────────────────────────────────────
do $$
declare
  v_codigo text := 'PLT-XXXX';        -- ← el mismo código acá
  p record; m record; v_neto numeric := 0;
begin
  select * into p from public.imp_pallets where codigo = v_codigo;
  if not found then
    raise notice 'No existe ningún pallet con código %', v_codigo;
    return;
  end if;

  -- Cada movimiento se revierte con el signo contrario al que aplicó
  for m in select * from public.imp_movimientos where pallet_id = p.id loop
    if    m.tipo = 'RECEPCION' then
      perform public.imp_stock_add(p.articulo_id, m.deposito, -m.unidades);
      v_neto := v_neto - m.unidades;
    elsif m.tipo = 'SALIDA' then
      perform public.imp_stock_add(p.articulo_id, m.deposito,  m.unidades);
      v_neto := v_neto + m.unidades;
    elsif m.tipo = 'ENTRADA' then
      perform public.imp_stock_add(p.articulo_id, m.destino,  -m.unidades);
      v_neto := v_neto - m.unidades;
    elsif m.tipo = 'CONSUMO' then
      perform public.imp_stock_add(p.articulo_id, m.deposito,  m.unidades);
      v_neto := v_neto + m.unidades;
    end if;
    -- UBICACION no toca stock: no hay nada que revertir
  end loop;

  delete from public.imp_movimientos where pallet_id = p.id;
  delete from public.imp_pallets where id = p.id;

  raise notice 'Pallet % revertido y borrado (ajuste neto de stock: % u.)', v_codigo, v_neto;
end $$;

-- ── 3. Comprobar cómo quedó el stock del artículo ────────────
-- select s.deposito, s.cantidad, a.descripcion
--   from public.imp_stock s join public.imp_articulos a on a.id = s.articulo_id
--  where a.descripcion ilike '%parte de la descripción%';
