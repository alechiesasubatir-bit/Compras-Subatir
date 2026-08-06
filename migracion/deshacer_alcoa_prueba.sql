-- ============================================================
--  DESHACER LA PRUEBA DEL PALLET DE TAPAS ALCOA
--
--  Pallet PLT-MSGEOPGY-DDAA (#35) — Tapas Alcoa Rosca 28,
--  25.000 unidades. El 06/08 el operario hizo el recorrido entero
--  de prueba, antes de que estuvieran las reglas nuevas:
--
--    14:27  SALIDA   Furriol (Estantería 1 · B6) → Artigas
--    14:27  ENTRADA  llegó a Artigas
--    14:28  CONSUMO  se consumió en Artigas
--
--  Esto lo devuelve exactamente a como estaba antes de ese
--  recorrido, para poder rehacerlo con la recepción por otra
--  persona (v17) ya aplicada.
--
--  Qué revierte:
--    · Stock: Furriol vuelve a 60.000 (hoy 35.000). Artigas queda
--      en 0, que es donde está: la entrada y el consumo se
--      cancelaban entre sí.
--    · El pallet vuelve a ESTACIONADO en Furriol, Estantería 1,
--      fila 3 columna 6 — que es el "B6" del cartel (con 4 niveles,
--      A es el de abajo, así que B es la fila 3). La ranura está
--      libre: nadie la ocupó.
--    · Se borran los tres movimientos de la prueba. El ARMADO del
--      05/08 QUEDA: ese no es de la prueba, es cuando se armó.
--    · La solicitud #6 vuelve a EN_PREPARACION con su pallet en
--      PEDIDO, o sea justo después de "Iniciar recorrido". El
--      operario puede escanear de nuevo sin rehacer el pedido.
--
--  Correr UNA vez en Supabase → SQL Editor. Si ya se corrió, no
--  vuelve a tocar nada: comprueba el estado antes.
-- ============================================================

-- ── 1. Antes: ver qué hizo la prueba (opcional, sólo lee) ────
-- select m.id, m.tipo, m.unidades, m.deposito, m.origen, m.destino,
--        m.ubicacion_de, m.ubicacion_a, m.usuario, m.created_at
--   from public.imp_movimientos m
--   join public.imp_pallets p on p.id = m.pallet_id
--  where p.codigo = 'PLT-MSGEOPGY-DDAA'
--  order by m.created_at;

-- ── 2. Deshacer ──────────────────────────────────────────────
do $$
declare
  v_cod  text := 'PLT-MSGEOPGY-DDAA';
  p      record;
  m      record;
  v_est  bigint;
begin
  select * into p from public.imp_pallets where codigo = v_cod;
  if not found then
    raise notice 'No existe el pallet %', v_cod; return;
  end if;
  if p.estado <> 'CONSUMIDO' then
    raise notice 'El pallet % está en % y no en CONSUMIDO: no se toca nada.', v_cod, p.estado;
    return;
  end if;

  -- La estantería, por nombre y depósito: el id se busca, no se escribe
  -- a mano, así esto sigue sirviendo si algún día se recrea.
  select id into v_est from public.imp_estanterias
   where deposito = 'Furriol' and nombre = 'Estantería 1';
  if v_est is null then
    raise exception 'No encuentro la Estantería 1 de Furriol';
  end if;
  if exists(select 1 from public.imp_pallets
             where estanteria_id = v_est and fila = 3 and columna = 6 and id <> p.id) then
    raise exception 'La ranura B6 de la Estantería 1 está ocupada por otro pallet';
  end if;

  -- Cada movimiento de la prueba se revierte con el signo contrario
  -- al que aplicó. El ARMADO no toca stock, así que no entra acá.
  for m in select * from public.imp_movimientos
            where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO') loop
    if    m.tipo = 'SALIDA'  then perform public.imp_stock_add(p.articulo_id, m.deposito,  m.unidades);
    elsif m.tipo = 'ENTRADA' then perform public.imp_stock_add(p.articulo_id, m.destino,  -m.unidades);
    elsif m.tipo = 'CONSUMO' then perform public.imp_stock_add(p.articulo_id, m.deposito,  m.unidades);
    end if;
  end loop;

  delete from public.imp_movimientos
   where pallet_id = p.id and tipo in ('SALIDA','ENTRADA','CONSUMO');

  -- El pallet, de vuelta en su lugar y esperando que lo despachen
  update public.imp_pallets
     set estado         = 'ESTACIONADO',
         deposito       = 'Furriol',
         estanteria_id  = v_est,
         fila           = 3,
         columna        = 6,
         subdeposito_id = null,
         origen         = 'Furriol',
         destino        = 'Artigas',    -- lo puso "Iniciar recorrido"
         salida_at      = null, salida_by      = null,
         llegada_at     = null, llegada_by     = null,
         consumido_at   = null, consumido_by   = null
   where id = p.id;

  -- Las columnas de la v17 pueden no existir todavía si se corre esto
  -- antes que aquella: se limpian sólo si están.
  begin
    update public.imp_pallets set salida_uid = null, llegada_uid = null where id = p.id;
  exception when undefined_column then null; end;

  -- El pedido, como quedó recién iniciado
  update public.imp_solicitud_items
     set estado = 'PEDIDO'
   where pallet_id = p.id and estado = 'ENTREGADO';

  update public.imp_solicitudes s
     set estado = 'EN_PREPARACION', entregada_at = null
   where s.id in (select solicitud_id from public.imp_solicitud_items where pallet_id = p.id)
     and s.estado = 'ENTREGADA';

  raise notice 'Pallet % de vuelta en Furriol · Estantería 1 · B6, con % u. devueltas al stock.',
               v_cod, p.unidades;
end $$;

-- ── 3. Cómo quedó ────────────────────────────────────────────
select p.codigo, p.estado, p.deposito,
       public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna) as ubicacion,
       p.destino, p.unidades,
       (select count(*) from public.imp_movimientos m where m.pallet_id = p.id) as movimientos
  from public.imp_pallets p
 where p.codigo = 'PLT-MSGEOPGY-DDAA';
-- Esperado: ESTACIONADO · Furriol · "Estantería 1 · B6" · destino Artigas · 1 movimiento (el ARMADO)

select s.deposito, s.cantidad
  from public.imp_stock s
  join public.imp_articulos a on a.id = s.articulo_id
 where a.codigo = '220132';
-- Esperado: Furriol 60.000 · Artigas 0

select id, estado from public.imp_solicitudes where id = 6;
-- Esperado: EN_PREPARACION
