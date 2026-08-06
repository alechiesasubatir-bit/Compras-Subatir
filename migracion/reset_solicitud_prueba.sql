-- ============================================================
--  BORRAR LA SOLICITUD DE PRUEBA Y DEVOLVER EL PALLET
--
--  Solicitud #6 (Furriol → Artigas) con el pallet de Tapas Alcoa
--  PLT-MSGEOPGY-DDAA. El operario alcanzó a escanear la salida
--  (06/08 15:07), así que el pallet quedó EN_TRANSITO, sin ranura
--  y con el stock ya descontado de Furriol.
--
--  Esto deja todo como si el pedido nunca hubiera existido:
--
--    · Se revierte la SALIDA: Furriol vuelve a 60.000 y se borra
--      ese movimiento. El ARMADO del 05/08 queda: no es de la
--      prueba.
--    · El pallet vuelve a ESTACIONADO en Furriol, Estantería 1,
--      B6 (fila 3, columna 6) — la ranura sigue libre.
--    · Se le saca el DESTINO. Sin destino y estacionado, vuelve a
--      figurar en "qué se puede pedir": es la condición para que
--      alguien lo solicite de nuevo desde el celular.
--    · Se borran la solicitud #6 y su renglón.
--
--  El orden importa: primero se borra el pedido y después se
--  mueve el pallet. Al revés, el trigger que sincroniza las
--  solicitudes vería el cambio de estado y marcaría el renglón
--  como entregado justo antes de borrarlo.
--
--  Correr UNA vez en Supabase → SQL Editor. Comprueba el estado
--  antes de tocar nada, así que correrlo dos veces no hace daño.
-- ============================================================

-- ── 1. Antes: qué hay (opcional, sólo lee) ───────────────────
-- select s.id, s.estado, s.origen, s.destino, i.pallet_id, i.estado as item
--   from public.imp_solicitudes s
--   left join public.imp_solicitud_items i on i.solicitud_id = s.id
--  where s.id = 6;

-- ── 2. Volver a cero ─────────────────────────────────────────
do $$
declare
  v_sol  bigint := 6;
  v_cod  text   := 'PLT-MSGEOPGY-DDAA';
  p      record;
  m      record;
  v_est  bigint;
begin
  select * into p from public.imp_pallets where codigo = v_cod;
  if not found then raise notice 'No existe el pallet %', v_cod; return; end if;

  select id into v_est from public.imp_estanterias
   where deposito = 'Furriol' and nombre = 'Estantería 1';
  if v_est is null then raise exception 'No encuentro la Estantería 1 de Furriol'; end if;
  if exists(select 1 from public.imp_pallets
             where estanteria_id = v_est and fila = 3 and columna = 6 and id <> p.id) then
    raise exception 'La ranura B6 de la Estantería 1 está ocupada por otro pallet';
  end if;

  -- 2.1 Primero el pedido, para que el trigger no lo toque después
  delete from public.imp_solicitud_items where solicitud_id = v_sol;
  delete from public.imp_solicitudes      where id = v_sol;

  -- 2.2 Revertir lo que el escaneo movió de stock
  for m in select * from public.imp_movimientos
            where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO') loop
    if    m.tipo = 'SALIDA'  then perform public.imp_stock_add(p.articulo_id, m.deposito,  m.unidades);
    elsif m.tipo = 'ENTRADA' then perform public.imp_stock_add(p.articulo_id, m.destino,  -m.unidades);
    elsif m.tipo = 'CONSUMO' then perform public.imp_stock_add(p.articulo_id, m.deposito,  m.unidades);
    end if;
  end loop;

  delete from public.imp_movimientos
   where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO');

  -- 2.3 El pallet, en su ranura y sin destino: listo para que lo pidan
  update public.imp_pallets
     set estado         = 'ESTACIONADO',
         deposito       = 'Furriol',
         estanteria_id  = v_est,
         fila           = 3,
         columna        = 6,
         subdeposito_id = null,
         origen         = 'Furriol',
         destino        = null,
         salida_at      = null, salida_by    = null, salida_uid  = null,
         llegada_at     = null, llegada_by   = null, llegada_uid = null,
         consumido_at   = null, consumido_by = null
   where id = p.id;

  raise notice 'Solicitud % borrada y pallet % de vuelta en Estantería 1 · B6, sin destino.',
               v_sol, v_cod;
end $$;

-- ── 3. Cómo quedó ────────────────────────────────────────────
select p.codigo, p.estado, p.deposito,
       public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna) as ubicacion,
       p.destino, p.salida_by,
       (select count(*) from public.imp_movimientos m where m.pallet_id = p.id) as movimientos
  from public.imp_pallets p
 where p.codigo = 'PLT-MSGEOPGY-DDAA';
-- Esperado: ESTACIONADO · Furriol · "Estantería 1 · B6" · destino vacío · 1 movimiento (el ARMADO)

select s.deposito, s.cantidad
  from public.imp_stock s join public.imp_articulos a on a.id = s.articulo_id
 where a.codigo = '220132';
-- Esperado: Furriol 60.000 · Artigas 0

select count(*) as solicitudes_vivas from public.imp_solicitudes;
-- Esperado: 0

-- Y que vuelva a aparecer como pedible:
select codigo, deposito, ubicacion from public.imp_pallets_disponibles
 where codigo = 'PLT-MSGEOPGY-DDAA';
-- Esperado: una fila
