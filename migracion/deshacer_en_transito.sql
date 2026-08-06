-- ============================================================
--  DESHACER LO QUE ESTÁ EN TRÁNSITO
--
--  Devuelve cada pallet EN_TRANSITO al depósito y a la ranura de
--  donde salió, le saca el destino y borra la solicitud que lo
--  movía. Queda como si nunca lo hubieran pedido: estacionado en
--  su lugar y disponible para que alguien lo solicite.
--
--  Sirve para cortar una prueba a mitad de camino. No es una
--  herramienta de operación: si un pallet salió de verdad, lo que
--  corresponde es escanearlo al llegar, no borrar el viaje.
--
--  Cómo sabe a qué ranura devolverlo: del movimiento de SALIDA,
--  que guarda de dónde se lo levantó ("Estantería 1 · B6"). Se
--  busca esa estantería en el depósito de origen y se convierte la
--  letra en número de fila (con 4 niveles, A es el de abajo, así
--  que B es la fila 3). Si la ranura está ocupada o el movimiento
--  no dice ubicación, el pallet queda estacionado sin ubicar y se
--  avisa por consola: nunca pisa a otro pallet.
--
--  Qué NO borra: el ARMADO y los viajes anteriores ya terminados.
--  Sólo se deshace el viaje en curso.
--
--  Correr en Supabase → SQL Editor. Si no hay nada en tránsito,
--  no hace nada.
-- ============================================================

-- ── 1. Antes: qué se va a deshacer (opcional, sólo lee) ──────
-- select p.codigo, p.origen, p.destino, p.salida_by, p.salida_at,
--        (select m.ubicacion_de from public.imp_movimientos m
--          where m.pallet_id = p.id and m.tipo='SALIDA'
--          order by m.created_at desc limit 1) as volvia_a
--   from public.imp_pallets p where p.estado = 'EN_TRANSITO';

-- ── 2. Deshacer ──────────────────────────────────────────────
do $$
declare
  v_sols  bigint[];
  p       record;
  m       record;
  v_ubic  text;
  v_est   bigint;
  v_fila  int;
  v_col   int;
  v_nom   text;
  v_resto text;
  v_letra text;
  v_n     int := 0;
begin
  -- 2.1 Las solicitudes que movían esos pallets
  select coalesce(array_agg(distinct i.solicitud_id), '{}')
    into v_sols
    from public.imp_solicitud_items i
    join public.imp_pallets p2 on p2.id = i.pallet_id
   where p2.estado = 'EN_TRANSITO';

  -- 2.2 Primero los pedidos. Si se hiciera al revés, el trigger que
  --     sincroniza solicitudes vería el cambio de estado del pallet y
  --     marcaría el renglón como entregado justo antes de borrarlo.
  if array_length(v_sols, 1) is not null then
    update public.imp_pallets set destino = null
     where id in (select pallet_id from public.imp_solicitud_items
                   where solicitud_id = any(v_sols))
       and estado in ('ESTACIONADO','EN_TRANSITO');
    delete from public.imp_solicitud_items where solicitud_id = any(v_sols);
    delete from public.imp_solicitudes      where id = any(v_sols);
    raise notice 'Solicitudes borradas: %', v_sols;
  end if;

  -- 2.3 Cada pallet, de vuelta a su lugar
  for p in select * from public.imp_pallets where estado = 'EN_TRANSITO' loop
    v_ubic := null; v_est := null; v_fila := null; v_col := null;

    select * into m from public.imp_movimientos
      where pallet_id = p.id and tipo = 'SALIDA'
      order by created_at desc limit 1;

    if found then
      v_ubic := m.ubicacion_de;
      -- El stock vuelve al depósito del que había salido
      perform public.imp_stock_add(p.articulo_id, m.deposito, m.unidades);
      delete from public.imp_movimientos where id = m.id;
    end if;

    -- "Estantería 1 · B6"  →  estantería, fila, columna
    if v_ubic is not null and position(' · ' in v_ubic) > 0 then
      v_nom   := split_part(v_ubic, ' · ', 1);
      v_resto := split_part(v_ubic, ' · ', 2);
      v_letra := upper(left(v_resto, 1));
      v_col   := nullif(regexp_replace(substr(v_resto, 2), '[^0-9]', '', 'g'), '')::int;

      select e.id, e.filas - (ascii(v_letra) - 64) + 1
        into v_est, v_fila
        from public.imp_estanterias e
       where e.deposito = p.origen and e.nombre = v_nom;

      if v_est is not null and v_col is not null and exists(
           select 1 from public.imp_pallets
            where estanteria_id = v_est and fila = v_fila and columna = v_col and id <> p.id) then
        raise notice 'La ranura "%" está ocupada: % queda sin ubicar en %', v_ubic, p.codigo, p.origen;
        v_est := null; v_fila := null; v_col := null;
      end if;
    end if;

    update public.imp_pallets
       set estado         = 'ESTACIONADO',
           deposito       = p.origen,
           estanteria_id  = v_est,
           fila           = v_fila,
           columna        = v_col,
           subdeposito_id = null,
           destino        = null,
           salida_at      = null, salida_by    = null, salida_uid  = null,
           llegada_at     = null, llegada_by   = null, llegada_uid = null,
           consumido_at   = null, consumido_by = null
     where id = p.id;

    v_n := v_n + 1;
    raise notice 'Pallet % de vuelta en % — %', p.codigo, p.origen, coalesce(v_ubic, 'sin ubicar');
  end loop;

  if v_n = 0 then raise notice 'No había nada en tránsito.'; end if;
end $$;

-- ── 3. Cómo quedó ────────────────────────────────────────────
select p.codigo, p.estado, p.deposito,
       public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna) as ubicacion,
       p.destino, p.salida_by
  from public.imp_pallets p
 where p.codigo = 'PLT-MSGEOPGY-DDAA';
-- Esperado: ESTACIONADO · Furriol · "Estantería 1 · B6" · destino vacío · sin salida

select count(*) filter (where estado='EN_TRANSITO') as en_transito,
       (select count(*) from public.imp_solicitudes) as solicitudes
  from public.imp_pallets;
-- Esperado: 0 y 0

select s.deposito, s.cantidad
  from public.imp_stock s join public.imp_articulos a on a.id = s.articulo_id
 where a.codigo = '220132';
-- Esperado: Furriol 60.000 · Artigas 0
