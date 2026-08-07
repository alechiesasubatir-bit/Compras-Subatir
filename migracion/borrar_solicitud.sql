-- ============================================================
--  BORRAR UNA SOLICITUD QUE TODAVÍA NO DESPACHÓ NADA
--
--  Saca el pedido de la lista y libera sus pallets: les quita el
--  destino que les puso "Iniciar recorrido", así vuelven a figurar
--  como pedibles. No toca el stock porque no hay nada que tocar:
--  se niega a correr si algún pallet del pedido ya salió.
--
--  Para un pedido con mercadería EN CAMINO no sirve esto: va
--  deshacer_en_transito.sql, que además revierte la salida.
--
--  Cambiá el número y ejecutá.
-- ============================================================

do $$
declare
  v_sol bigint := 8;      -- ← el pedido a borrar
  v_n   int;
begin
  if not exists(select 1 from public.imp_solicitudes where id = v_sol) then
    raise notice 'No existe el pedido %', v_sol; return;
  end if;

  select count(*) into v_n
    from public.imp_solicitud_items i
    join public.imp_pallets p on p.id = i.pallet_id
   where i.solicitud_id = v_sol and p.estado <> 'ESTACIONADO';
  if v_n > 0 then
    raise exception 'El pedido % tiene % pallet(s) que ya no están estacionados: usá deshacer_en_transito.sql',
                    v_sol, v_n;
  end if;

  update public.imp_pallets set destino = null
   where id in (select pallet_id from public.imp_solicitud_items where solicitud_id = v_sol);

  delete from public.imp_solicitud_items where solicitud_id = v_sol;
  delete from public.imp_solicitudes      where id = v_sol;

  raise notice 'Pedido % borrado y sus pallets liberados.', v_sol;
end $$;

-- ── Cómo quedó ───────────────────────────────────────────────
select count(*) as solicitudes from public.imp_solicitudes;
-- Esperado: 0

select codigo, deposito, ubicacion from public.imp_pallets_disponibles
 where codigo in ('PLT-MSGEOPGY-DDAA','PLT-MSHITRRP-04F2')
 order by codigo;
-- Esperado: los dos, libres para pedir
