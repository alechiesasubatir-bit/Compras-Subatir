-- ============================================================
--  DESHACER EL TRASLADO · Pedido #47 · Pallet 46 (08/10/2026)
--
--  Pallet PLT-MSGKH5ON-6332 · 2.880 u. (8 cajas × 360)
--  Art. 121 · 220034 Botella PET x 250 ml con Gatillo Mini trigger
--  Pedido #47 · Fabricantes · pidió Valentina González
--
--  Movimientos del pallet:
--    #87  ARMADO   Furriol         05/08         ← LEGÍTIMO, no se toca
--    #317 SALIDA   Fur→Art  07/10 13:59  ← se revierte
--    #318 ENTRADA  Artigas  07/10 14:34  ← se revierte (SQL imp_fix_recibir_plt46)
--    #319 CONSUMO  Artigas  07/10 14:34  ← se revierte (SQL imp_fix_recibir_plt46)
--
--  Queda todo como antes del traslado:
--    · Pallet → ESTACIONADO en Furriol, Estantería 4 · D4
--      (id 3, fila 1, columna 4: la ranura de la que salió según
--      el mov #317; verificada libre el 08/10)
--    · Pedido #47 → PENDIENTE, item → PEDIDO (el pallet sigue
--      reservado para ese pedido, se puede volver a despachar)
--
--  Efecto sobre el stock del art. 121 (hoy Furriol 43.880 · Artigas 0):
--    SALIDA  → +2.880 a Furriol
--    ENTRADA → −2.880 a Artigas
--    CONSUMO → +2.880 a Artigas
--    Neto: Furriol 46.760 · Artigas 0
--
--  El trigger trg_imp_sol_sync no interviene: sólo mira items en
--  PEDIDO/ENVIADO y acá el item está ENTREGADO cuando cambia el pallet.
--
--  Correr UNA vez en Supabase → SQL Editor. Si se corre de nuevo,
--  ve que el pallet ya no está CONSUMIDO y no hace nada.
-- ============================================================

do $$
declare
  v_cod  text   := 'PLT-MSGKH5ON-6332';
  v_sol  bigint := 47;
  v_est  bigint := 3;   -- Estantería 4 de Furriol
  v_fila int    := 1;   -- "D4" con 4 filas → fila 1
  v_col  int    := 4;
  p      record;
  m      record;
  v_mov  bigint[] := '{}';
  v_ocupa bigint;
begin
  select * into p from public.imp_pallets where id = 46 and codigo = v_cod;
  if not found then
    raise exception 'No existe el pallet 46 %. No se toca nada.', v_cod;
  end if;
  if p.estado <> 'CONSUMIDO' then
    raise notice 'El pallet está % y no CONSUMIDO: parece que ya se deshizo. No se hizo nada.', p.estado;
    return;
  end if;

  -- 1. Stock: el signo contrario al que aplicó cada movimiento
  for m in select * from public.imp_movimientos
            where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO')
            order by id loop
    if    m.tipo = 'SALIDA'  then
      perform public.imp_stock_add(p.articulo_id, m.deposito, m.unidades);   -- vuelve a Furriol
    elsif m.tipo = 'ENTRADA' then
      perform public.imp_stock_add(p.articulo_id, m.destino, -m.unidades);   -- sale de Artigas
    elsif m.tipo = 'CONSUMO' then
      perform public.imp_stock_add(p.articulo_id, m.deposito, m.unidades);   -- se "des-consume"
    end if;
    v_mov := v_mov || m.id;
  end loop;

  delete from public.imp_movimientos
   where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO');

  -- 2. ¿La ranura sigue libre? Si no, vuelve sin ubicar en vez de pisar
  select id into v_ocupa from public.imp_pallets
   where estanteria_id = v_est and fila = v_fila and columna = v_col
     and id <> p.id limit 1;
  if v_ocupa is not null then
    v_est := null; v_fila := null; v_col := null;
    raise notice 'La ranura Estantería 4 · D4 está ocupada por el pallet %: vuelve SIN UBICAR.', v_ocupa;
  end if;

  -- 3. El pallet vuelve a Furriol. destino en null: lo pone "iniciar"
  --    el pedido, y el pedido vuelve a antes de iniciarse.
  update public.imp_pallets
     set estado        = 'ESTACIONADO',
         deposito      = 'Furriol',
         destino       = null,
         salida_at     = null, salida_by  = null, salida_uid  = null,
         llegada_at    = null, llegada_by = null, llegada_uid = null,
         consumido_at  = null, consumido_by = null,
         estanteria_id = v_est, fila = v_fila, columna = v_col,
         ult_estanteria_id = coalesce(v_est, ult_estanteria_id),
         ult_fila          = coalesce(v_fila, ult_fila),
         ult_columna       = coalesce(v_col, ult_columna)
   where id = p.id;

  -- 4. El pedido vuelve a Pendiente, con el pallet pedido
  update public.imp_solicitud_items
     set estado = 'PEDIDO',
         despachado_at = null, despachado_by = null,
         recibido_at   = null, recibido_by   = null
   where solicitud_id = v_sol and pallet_id = p.id;

  update public.imp_solicitudes
     set estado = 'PENDIENTE', operario = null,
         iniciada_at = null, entregada_at = null, cerrada_by = null
   where id = v_sol;

  raise notice 'Listo: pallet % de vuelta en Furriol (ESTACIONADO). Movimientos borrados: %. Pedido #% en PENDIENTE.',
               v_cod, v_mov, v_sol;
end $$;

-- ── Comprobar cómo quedó ─────────────────────────────────────
--  Esperado:
--    pallet  → ESTACIONADO · Furriol · est 3, fila 1, col 4
--    movs    → sólo el ARMADO #87
--    stock   → Furriol 46.760 · Artigas 0
--    pedido  → PENDIENTE · item PEDIDO
select 'pallet' as que, estado as detalle, deposito as donde,
       concat_ws(' · ', 'est '||estanteria_id, 'fila '||fila, 'col '||columna) as extra
  from public.imp_pallets where id = 46
union all
select 'mov '||id, tipo, deposito, unidades::text
  from public.imp_movimientos where pallet_id = 46
union all
select 'stock', 'art. 121', deposito, cantidad::text
  from public.imp_stock where articulo_id = 121
union all
select 'pedido #47', estado, origen||' → '||destino, null
  from public.imp_solicitudes where id = 47
union all
select 'item', estado, null, 'pallet '||pallet_id
  from public.imp_solicitud_items where solicitud_id = 47;
