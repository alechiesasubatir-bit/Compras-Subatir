-- ============================================================
--  DESHACER EL TRASLADO DE PRUEBA · Solicitud #14
--
--  Qué pasó (11/08/2026):
--    Pallet PLT-MSGFHGWX-BE07 · 13.200 u.
--    Frasco VIDRIO ambar x 30 ml. c/tapa y gotero (48.3g)
--    Furriol → Artigas, pedido #14, entregado y consumido.
--
--  Movimientos del pallet:
--    #73  ARMADO   Furriol   05/08 18:36   ← LEGÍTIMO, no se toca
--    #129 SALIDA   Fur→Art   11/08 17:28   ← prueba, se revierte
--    #130 ENTRADA  Fur→Art   11/08 17:30   ← prueba, se revierte
--    #131 CONSUMO  Artigas   11/08 17:30   ← prueba, se revierte
--
--  El pallet NO se borra: se armó de verdad el 05/08 y sigue
--  siendo mercadería real. Sólo se deshace el traslado, así que
--  vuelve a Furriol como estaba antes de salir.
--
--  OJO con la ubicación: el traslado borró en qué ranura estaba
--  y no quedó registro de cuál era (el arrastre al rack no deja
--  movimiento). Vuelve SIN UBICAR: va a aparecer en el dock
--  "📥 Sin ubicar" de Furriol para que lo arrastres a su lugar.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Mirar antes de tocar ──────────────────────────────────
--    Corré este select solo y comprobá que es lo que esperás.
select p.codigo, p.estado, p.deposito, p.destino, p.unidades,
       m.id as mov, m.tipo, m.deposito as mov_dep, m.origen, m.destino as mov_dest,
       m.unidades as mov_un, m.created_at
  from public.imp_pallets p
  left join public.imp_movimientos m on m.pallet_id = p.id
 where p.codigo = 'PLT-MSGFHGWX-BE07'
 order by m.id;

-- ── 2. Deshacer ──────────────────────────────────────────────
do $$
declare
  v_cod  text   := 'PLT-MSGFHGWX-BE07';
  v_sol  bigint := 14;
  p      record;
  m      record;
  v_mov  bigint[] := '{}';
begin
  select * into p from public.imp_pallets where codigo = v_cod;
  if not found then
    raise notice 'No existe el pallet %  — no se hizo nada', v_cod; return;
  end if;
  if p.estado <> 'CONSUMIDO' then
    raise notice 'El pallet % está en % y no en CONSUMIDO: parece que ya se deshizo. No se hizo nada.', v_cod, p.estado;
    return;
  end if;

  -- 2.a Revertir el efecto sobre el stock, con el signo contrario al
  --     que aplicó cada movimiento (mismo criterio que imp_deshacer_pallet).
  --     El ARMADO queda fuera: el pallet sigue existiendo.
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

  -- 2.b Borrar el pedido PRIMERO: hay un trigger sobre imp_pallets que
  --     sincroniza la solicitud cuando cambia el estado del pallet, y sin
  --     el pedido no tiene nada que tocar. Los items caen por cascada.
  delete from public.imp_solicitudes where id = v_sol;

  -- 2.c Borrar los movimientos de la prueba (queda el ARMADO)
  delete from public.imp_movimientos
   where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO');

  -- 2.d El pallet vuelve a Furriol como estaba: estacionado y sin destino
  update public.imp_pallets
     set estado        = 'ESTACIONADO',
         deposito      = 'Furriol',
         destino       = null,
         salida_at     = null, salida_by    = null,
         llegada_at    = null, llegada_by   = null,
         consumido_at  = null, consumido_by = null,
         estanteria_id = null, fila = null, columna = null
   where id = p.id;

  raise notice 'Listo: pallet % de vuelta en Furriol (ESTACIONADO, sin ubicar). Movimientos borrados: %. Pedido #% eliminado.',
               v_cod, v_mov, v_sol;
end $$;

-- ── 3. Comprobar cómo quedó ──────────────────────────────────
--  Esperado:
--    pallet   → ESTACIONADO · Furriol · destino null · sin ranura
--    stock    → Furriol 13.200 · Artigas 0
--    pedido   → 0 filas
--    movs     → sólo el ARMADO
select
  (select p.estado             from public.imp_pallets p where p.codigo = 'PLT-MSGFHGWX-BE07') as pallet_estado,
  (select p.deposito           from public.imp_pallets p where p.codigo = 'PLT-MSGFHGWX-BE07') as pallet_deposito,
  (select coalesce(p.destino,'—') from public.imp_pallets p where p.codigo = 'PLT-MSGFHGWX-BE07') as pallet_destino,
  (select p.estanteria_id      from public.imp_pallets p where p.codigo = 'PLT-MSGFHGWX-BE07') as ranura,
  (select s.cantidad from public.imp_stock s where s.articulo_id = 132 and s.deposito = 'Furriol') as stock_furriol,
  (select s.cantidad from public.imp_stock s where s.articulo_id = 132 and s.deposito = 'Artigas') as stock_artigas,
  (select count(*)   from public.imp_solicitudes where id = 14) as pedido_14,
  (select string_agg(m.tipo, ', ' order by m.id)
     from public.imp_movimientos m
    where m.pallet_id = (select p.id from public.imp_pallets p
                          where p.codigo = 'PLT-MSGFHGWX-BE07')) as movimientos;
