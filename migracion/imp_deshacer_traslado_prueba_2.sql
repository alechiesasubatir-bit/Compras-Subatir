-- ============================================================
--  DESHACER EL TRASLADO DE PRUEBA · Solicitud #19
--
--  Qué pasó (12/08/2026):
--    Pallet PLT-MSHITRRP-04F2 · 2.880 u.
--    Botella PET x 250 ml con Gatillo Mini trigger (Textiles) · 220034
--    Furriol → Artigas, pedido #19, entregado y consumido.
--    Despachó "Pele", recibió "DL" (nombres de operador reales:
--    la trazabilidad de cuentas compartidas ya está funcionando).
--
--  Movimientos del pallet:
--    #92  ARMADO   Furriol   06/08 12:57   ← LEGÍTIMO, no se toca
--    #133 SALIDA   Fur→Art   12/08 18:30   ← prueba, se revierte
--    #134 ENTRADA  Fur→Art   12/08 18:34   ← prueba, se revierte
--    #135 CONSUMO  Artigas   12/08 18:34   ← prueba, se revierte
--
--  El pallet NO se borra: se armó de verdad el 06/08. Sólo se
--  deshace el traslado, así que vuelve a Furriol como estaba.
--
--  Además se borran los pedidos #16, #17 y #18: son intentos
--  previos sobre ESTE MISMO pallet que quedaron CANCELADOS. Sus
--  ítems están en CANCELADO, así que no reservan nada ni tocaron
--  el stock —no generaron ningún movimiento—: borrarlos es sólo
--  sacar ruido de la lista.
--
--  Igual que la vez anterior, el traslado borró en qué ranura
--  estaba y no queda registro (el arrastre al rack no genera
--  movimiento). Vuelve SIN UBICAR: aparece en el dock
--  "📥 Sin ubicar" de Furriol para que lo arrastres a su lugar.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Mirar antes de tocar ──────────────────────────────────
--  1.a El pallet y sus movimientos
select p.codigo, p.estado, p.deposito, p.destino, p.unidades,
       m.id as mov, m.tipo, m.deposito as mov_dep, m.origen, m.destino as mov_dest,
       m.unidades as mov_un, m.usuario, m.created_at
  from public.imp_pallets p
  left join public.imp_movimientos m on m.pallet_id = p.id
 where p.codigo = 'PLT-MSHITRRP-04F2'
 order by m.id;

--  1.b Los pedidos que se van a borrar
select s.id, s.estado, s.origen, s.destino, s.solicitante, s.created_at,
       (select count(*) from public.imp_solicitud_items i where i.solicitud_id = s.id) as items
  from public.imp_solicitudes s
 where s.id in (16,17,18,19)
 order by s.id;

-- ── 2. Deshacer ──────────────────────────────────────────────
do $$
declare
  v_cod  text   := 'PLT-MSHITRRP-04F2';
  v_sol  bigint := 19;
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
  --     que aplicó cada movimiento. El ARMADO queda fuera: el pallet
  --     sigue existiendo.
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

  -- 2.c Los movimientos de la prueba (queda el ARMADO)
  delete from public.imp_movimientos
   where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO');

  -- 2.d El pallet vuelve a Furriol como estaba
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

-- ── 2 bis. Los cancelados de prueba ──────────────────────────
--  Va APARTE del bloque de arriba a propósito: ese se corta si el
--  pallet ya no está CONSUMIDO, y esto tiene que correr igual.
--  Los ítems caen por cascada. No tocan stock: ya estaban CANCELADO.
delete from public.imp_solicitudes where id in (16, 17, 18);

-- ── 3. Comprobar cómo quedó ──────────────────────────────────
--  Esperado:
--    pallet          → ESTACIONADO · Furriol · destino — · ranura null
--    stock Furriol   → 39.600   (36.720 + 2.880 que vuelven)
--    stock Artigas   → 0
--    pedidos 16 a 19 → 0  (los tres cancelados + el entregado)
--    movimientos     → sólo ARMADO
select
  (select p.estado   from public.imp_pallets p where p.codigo = 'PLT-MSHITRRP-04F2') as pallet_estado,
  (select p.deposito from public.imp_pallets p where p.codigo = 'PLT-MSHITRRP-04F2') as pallet_deposito,
  (select coalesce(p.destino,'—') from public.imp_pallets p where p.codigo = 'PLT-MSHITRRP-04F2') as pallet_destino,
  (select p.estanteria_id from public.imp_pallets p where p.codigo = 'PLT-MSHITRRP-04F2') as ranura,
  (select s.cantidad from public.imp_stock s where s.articulo_id = 121 and s.deposito = 'Furriol') as stock_furriol,
  (select s.cantidad from public.imp_stock s where s.articulo_id = 121 and s.deposito = 'Artigas') as stock_artigas,
  (select count(*)   from public.imp_solicitudes where id in (16,17,18,19)) as pedidos_16_a_19,
  (select string_agg(m.tipo, ', ' order by m.id)
     from public.imp_movimientos m
    where m.pallet_id = (select p.id from public.imp_pallets p
                          where p.codigo = 'PLT-MSHITRRP-04F2')) as movimientos;
