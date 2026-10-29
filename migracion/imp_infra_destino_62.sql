-- ============================================================
--  Pedido de infraestructura #62: iba a la Sucursal Centro
--
--  Se cargo Furriol -> Artigas (deposito) con motivo "Para Fraquicia
--  Centro". Segun el usuario (29/10/2026) las 150 Chapa Estante
--  fueron a la sucursal Centro, no a Artigas.
--    · 23/10 Cristian Montes de Oca despacho 150 de Furriol.
--    · 29/10 17:41 se recibio en Artigas: ENTRADA + CONSUMO de 150
--      (Artigas es fabrica, entra y se consume en el mismo acto).
--
--  QUE HACE (igual que imp_infra_destino_36_48.sql)
--  · El pedido pasa de destino Artigas a sucursal Centro.
--  · La SALIDA de Furriol queda (eso si paso) pero apuntando a la
--    sucursal, con la nota nueva.
--  · Se BORRAN la ENTRADA y el CONSUMO en Artigas: nunca llegaron ahi.
--    El stock de Artigas no cambia (sigue en 0) y el de Furriol
--    tampoco: la salida ya estaba descontada.
--  · Como en todo pedido a sucursal, despachado = entregado: la
--    recepcion queda con la fecha y el usuario del despacho (23/10).
--
--  Idempotente: si el pedido ya tiene sucursal, no lo toca.
--  Correr en Supabase -> SQL Editor.
-- ============================================================

do $$
declare s record; v_mov int; v_sal int;
begin
  select * into s from public.imp_solicitudes where id = 62;
  if not found then raise exception 'El pedido #62 no existe'; end if;
  if s.sucursal is not null then
    raise notice 'Pedido #62 ya va a sucursal %: no se toca.', s.sucursal;
    return;
  end if;
  -- Guardas: que sea el pedido que creemos
  if s.destino is distinct from 'Artigas' or s.origen is distinct from 'Furriol' then
    raise exception 'El pedido #62 es % -> %, no Furriol -> Artigas. No se toca.', s.origen, s.destino;
  end if;
  if exists(select 1 from public.imp_solicitud_items
             where solicitud_id = 62 and pallet_id is not null) then
    raise exception 'El pedido #62 tiene pallets: no es solo infraestructura. No se toca.';
  end if;

  -- Movimientos en Artigas que no ocurrieron
  delete from public.imp_movimientos
   where pallet_id is null and tipo in ('ENTRADA','CONSUMO') and deposito = 'Artigas'
     and nota like 'Infraestructura · pedido #62 ·%';
  get diagnostics v_mov = row_count;

  -- La salida de Furriol: ahora hacia la sucursal
  update public.imp_movimientos
     set destino = 'Centro',
         nota = 'Infraestructura · pedido #62 · sin pallet · a sucursal Centro'
             || coalesce(' · pide '||s.responsable,'')
             || coalesce(' · motivo: '||coalesce(s.motivo,s.nota),'')
             || ' · destino corregido 29/10/2026 (antes Artigas)'
   where pallet_id is null and tipo = 'SALIDA' and deposito = 'Furriol'
     and nota like 'Infraestructura · pedido #62 ·%';
  get diagnostics v_sal = row_count;

  -- A sucursal nadie recibe: entregado al despachar
  update public.imp_solicitud_items
     set recibido_at = despachado_at, recibido_by = despachado_by
   where solicitud_id = 62 and pallet_id is null and estado = 'ENTREGADO';

  update public.imp_solicitudes
     set destino = null, sucursal = 'Centro',
         entregada_at = coalesce((select max(despachado_at) from public.imp_solicitud_items
                                   where solicitud_id = 62), entregada_at)
   where id = 62;

  raise notice 'Pedido #62 -> Sucursal Centro: % salidas corregidas, % movimientos de Artigas borrados.',
    v_sal, v_mov;
end $$;

-- ── Control ─────────────────────────────────────────────────
select id, origen, destino, sucursal, responsable, coalesce(motivo, nota) as motivo, estado
  from public.imp_solicitudes where id = 62;
-- Esperado: 62 Furriol · (null) · Centro · Diego La Luz · Para Fraquicia Centro · ENTREGADA

select tipo, deposito, destino, count(*), sum(unidades)
  from public.imp_movimientos
 where pallet_id is null and nota like 'Infraestructura · pedido #62 ·%'
 group by 1,2,3 order by 1,2,3;
-- Esperado: solo SALIDA · Furriol · Centro · 1 mov · 150 u.

select articulo_id, deposito, cantidad from public.imp_stock
 where articulo_id = 128 order by 2;
-- Esperado (sin cambios): Artigas 0 · Furriol 414
