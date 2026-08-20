-- ============================================================
--  DESHACER EL TRASLADO · Solicitud #24
--
--  Qué pasó (19/08/2026):
--    Pallet PLT-MSGEKH0R-07A4 · 1.800 u.
--    Tubo Kraft 5 diámetro x 16 alto · 220209 · artículo 166
--    Furriol → Artigas, pedido #24, entregado y consumido por "Ale".
--
--  Movimientos del pallet:
--    #69  ARMADO     Furriol   05/08 18:10   ← LEGÍTIMO, no se toca
--    #143..#156 UBICACION      17/08         ← LEGÍTIMOS, no se tocan
--    #177 SALIDA     Fur→Art   19/08 17:57   ← se revierte
--    #178 ENTRADA    Artigas   19/08 17:58   ← se revierte
--    #179 CONSUMO    Artigas   19/08 17:58   ← se revierte
--
--  El pallet NO se borra: se armó de verdad el 05/08. Sólo se
--  deshace el traslado, así que vuelve a Furriol como estaba.
--
--  A DIFERENCIA de las veces anteriores, esta vez SÍ se puede
--  devolver a su ranura: el movimiento #156 dejó registrado que
--  estaba en "Estantería 1 · D4" de Furriol. En esa estantería
--  (4 filas) la etiqueta D4 es fila 1, columna 4 — la letra se
--  cuenta de abajo hacia arriba (letterOf: filas - fila + 1).
--  La ranura fue verificada libre antes de escribir esto.
--
--  Efecto sobre el stock del artículo 166 (hoy Furriol 0, Artigas 0):
--    SALIDA  → +1.800 a Furriol
--    ENTRADA → -1.800 a Artigas
--    CONSUMO → +1.800 a Artigas
--    Neto: Furriol 1.800 · Artigas 0
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Mirar antes de tocar ──────────────────────────────────
select p.id, p.codigo, p.estado, p.deposito, p.destino, p.unidades,
       p.estanteria_id, p.fila, p.columna,
       m.id as mov, m.tipo, m.deposito as mov_dep, m.destino as mov_dest,
       m.unidades as mov_un, m.usuario, m.created_at
  from public.imp_pallets p
  left join public.imp_movimientos m on m.pallet_id = p.id
 where p.codigo = 'PLT-MSGEKH0R-07A4'
 order by m.id;

select articulo_id, deposito, cantidad
  from public.imp_stock
 where articulo_id = 166
 order by deposito;

-- ── 2. Deshacer ──────────────────────────────────────────────
do $$
declare
  v_cod  text   := 'PLT-MSGEKH0R-07A4';
  v_sol  bigint := 24;
  v_est  bigint := 1;   -- Estantería 1 de Furriol
  v_fila int    := 1;   -- "D4" con 4 filas → fila 1
  v_col  int    := 4;
  p      record;
  m      record;
  v_mov  bigint[] := '{}';
  v_ocupa bigint;
begin
  select * into p from public.imp_pallets where codigo = v_cod;
  if not found then
    raise notice 'No existe el pallet %  — no se hizo nada', v_cod; return;
  end if;
  if p.estado <> 'CONSUMIDO' then
    raise notice 'El pallet % está en % y no en CONSUMIDO: parece que ya se deshizo. No se hizo nada.', v_cod, p.estado;
    return;
  end if;

  -- 2.a Revertir el stock, con el signo contrario al que aplicó cada
  --     movimiento. El ARMADO y las UBICACION quedan fuera: el pallet
  --     sigue existiendo y esos movimientos no tocan stock.
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

  -- 2.b El pedido PRIMERO: hay un trigger sobre imp_pallets que
  --     sincroniza la solicitud al cambiar el estado del pallet, y sin
  --     el pedido no tiene nada que tocar. Los items caen por cascada.
  delete from public.imp_solicitudes where id = v_sol;

  -- 2.c Los movimientos del traslado (quedan ARMADO y UBICACION)
  delete from public.imp_movimientos
   where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO');

  -- 2.d ¿La ranura sigue libre? Si alguien puso otro pallet ahí entre
  --     medio, vuelve sin ubicar en vez de pisarlo.
  select id into v_ocupa from public.imp_pallets
   where estanteria_id = v_est and fila = v_fila and columna = v_col
     and id <> p.id limit 1;
  if v_ocupa is not null then
    v_est := null; v_fila := null; v_col := null;
    raise notice 'La ranura D4 quedó ocupada por el pallet %: vuelve SIN UBICAR.', v_ocupa;
  end if;

  -- 2.e El pallet vuelve a Furriol, a su ranura
  update public.imp_pallets
     set estado        = 'ESTACIONADO',
         deposito      = 'Furriol',
         destino       = null,
         salida_at     = null, salida_by    = null,
         llegada_at    = null, llegada_by   = null,
         consumido_at  = null, consumido_by = null,
         estanteria_id = v_est, fila = v_fila, columna = v_col
   where id = p.id;

  raise notice 'Listo: pallet % de vuelta en Furriol (ESTACIONADO, Estantería 1 · D4). Movimientos borrados: %. Pedido #% eliminado.',
               v_cod, v_mov, v_sol;
end $$;

-- ── 3. Comprobar cómo quedó ──────────────────────────────────
--  Esperado:
--    pallet         → ESTACIONADO · Furriol · destino — · est 1, fila 1, col 4
--    stock Furriol  → 1.800
--    stock Artigas  → 0
--    pedido #24     → no existe
--    movimientos    → sólo ARMADO y las UBICACION
select id, codigo, estado, deposito, destino, estanteria_id, fila, columna
  from public.imp_pallets where codigo = 'PLT-MSGEKH0R-07A4';

select deposito, cantidad from public.imp_stock
 where articulo_id = 166 order by deposito;

select count(*) as pedido_24 from public.imp_solicitudes where id = 24;

select id, tipo, deposito, destino, created_at
  from public.imp_movimientos
 where pallet_id = (select id from public.imp_pallets where codigo = 'PLT-MSGEKH0R-07A4')
 order by id;
