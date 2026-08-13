-- ============================================================
--  Cancelar la solicitud #21 (Furriol → Artigas) y liberar el pallet
--
--  Qué pasó: se armó el pedido y se inició el recorrido, pero el pallet
--  NUNCA se escaneó a la salida. En la base sigue ESTACIONADO en su
--  ranura de Furriol (estantería 1, fila 4, columna 2), así que no hay
--  ningún movimiento que deshacer: lo único que quedó a medias es la
--  reserva (imp_pallets.destino = 'Artigas') y la solicitud abierta.
--
--  Esto hace exactamente lo mismo que el botón "Cancelar pedido" de
--  Solicitar (RPC imp_solicitud_cancelar), pero desde el editor SQL,
--  porque ese botón sólo lo ve la cuenta que pidió (Fabricantes).
--
--  Es idempotente en el sentido útil: si algo no está como se espera,
--  aborta y no toca nada.
-- ============================================================
begin;

-- ── Guardas: si la realidad cambió desde que se escribió esto, cortar
do $$
declare v_estado text; v_pal record; v_n int;
begin
  select estado into v_estado from public.imp_solicitudes where id = 21;
  if v_estado is null then
    raise exception 'La solicitud #21 no existe';
  end if;
  if v_estado <> 'EN_PREPARACION' then
    raise exception 'La solicitud #21 esta en % (se esperaba EN_PREPARACION). Revisar antes de seguir.', v_estado;
  end if;

  -- Ningun pallet puede estar ya despachado: eso habria que recibirlo,
  -- no cancelarlo (misma regla que aplica el RPC de la app).
  select count(*) into v_n
    from public.imp_solicitud_items i
    join public.imp_pallets p on p.id = i.pallet_id
   where i.solicitud_id = 21 and p.estado = 'EN_TRANSITO';
  if v_n > 0 then
    raise exception 'Hay % pallet(s) ya despachados: no se cancela, se reciben.', v_n;
  end if;

  -- Y el pallet tiene que seguir en su ranura
  select p.id, p.codigo, p.estado, p.estanteria_id, p.fila, p.columna
    into v_pal
    from public.imp_solicitud_items i
    join public.imp_pallets p on p.id = i.pallet_id
   where i.solicitud_id = 21
   limit 1;
  raise notice 'Pallet % (%) esta % en estanteria % fila % columna %',
    v_pal.id, v_pal.codigo, v_pal.estado, v_pal.estanteria_id, v_pal.fila, v_pal.columna;
  if v_pal.estado <> 'ESTACIONADO' then
    raise exception 'El pallet % esta en % (se esperaba ESTACIONADO)', v_pal.codigo, v_pal.estado;
  end if;
end $$;

-- ── 1. Liberar la reserva: el pallet deja de estar comprometido a Artigas
update public.imp_pallets p
   set destino = null
  from public.imp_solicitud_items i
 where i.solicitud_id = 21
   and p.id = i.pallet_id
   and p.estado = 'ESTACIONADO';

-- ── 2. Cerrar las lineas del pedido
update public.imp_solicitud_items
   set estado = 'CANCELADO'
 where solicitud_id = 21
   and estado in ('PEDIDO','ENVIADO');

-- ── 3. Cerrar el pedido
update public.imp_solicitudes
   set estado       = 'CANCELADA',
       cerrada_by   = 'alechiesa.subatir',
       entregada_at = now()
 where id = 21;

commit;

-- ── Verificacion: como quedo todo
select s.id                              as solicitud,
       s.estado                          as estado_solicitud,
       s.cerrada_by,
       p.codigo                          as pallet,
       p.estado                          as estado_pallet,
       p.deposito,
       p.destino                         as reservado_para,
       p.estanteria_id, p.fila, p.columna,
       i.estado                          as estado_linea
  from public.imp_solicitudes s
  join public.imp_solicitud_items i on i.solicitud_id = s.id
  join public.imp_pallets p         on p.id = i.pallet_id
 where s.id = 21;
