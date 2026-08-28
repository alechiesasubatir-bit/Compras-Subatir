-- ============================================================
--  CORRECCIÓN · se cargó al camión el pallet equivocado
--  Solicitud #30 · 28/08/2026 · Gatillo Mini Trigger rosca 24
--
--  QUÉ PASÓ
--  En Furriol había dos pallets idénticos del mismo artículo, con
--  10.000 unidades cada uno:
--
--    · PLT-MSGD15LY-5A97  (id 30)  ranura Estantería 1 · A3
--    · PLT-MSGD313S-33BE  (id 31)  ranura Estantería 1 · C3
--
--  Al despachar se escaneó el QR del 33BE, pero al camión subió
--  físicamente el 5A97. En Artigas, la operaria escaneó el pallet que
--  tenía delante —el 5A97— y el sistema le dijo "este pallet todavía
--  no salió", porque para la base el que viajaba era el otro.
--
--  QUÉ CORRIGE ESTE ARCHIVO
--  Deja la base contando lo que pasó de verdad:
--    · el 5A97 sale de Furriol, llega a Artigas y se consume
--    · el 33BE vuelve a estar estacionado en su ranura, como si nunca
--      lo hubieran tocado
--    · la solicitud #30 queda ENTREGADA, apuntando al pallet correcto
--
--  EL STOCK NO CAMBIA. Se deshace un -10.000 en Furriol y se hace
--  otro igual: los dos pallets tienen el mismo artículo y la misma
--  cantidad. Artigas es FÁBRICA, así que la entrada y el consumo se
--  cancelan y queda en 0, igual que ahora.
--
--  POR QUÉ EL ORDEN NO SE PUEDE CAMBIAR
--  El trigger trg_imp_sol_sync mira el estado de cada pallet y mueve
--  la solicitud solo. Si al 33BE se lo sacara de EN_TRANSITO **antes**
--  de reasignar el renglón del pedido, el trigger lo daría por
--  entregado y cerraría la solicitud con el pallet equivocado. Por eso
--  primero se reasigna el renglón y recién después se tocan los
--  pallets — y el despacho y la llegada del 5A97 se hacen en dos pasos
--  separados, para que el trigger cierre la solicitud como lo haría en
--  un viaje normal en vez de escribirle el estado a mano.
--
--  Va todo en un solo bloque: o entra completo o no entra nada. A
--  mitad de camino el stock quedaría descuadrado.
--
--  Es idempotente: si ya se corrió, avisa y no hace nada.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  v_bueno   text := 'PLT-MSGD15LY-5A97';   -- el que viajó de verdad
  v_malo    text := 'PLT-MSGD313S-33BE';   -- el que quedó en Furriol
  v_sol     bigint := 30;
  -- Quién hizo cada cosa. Se respeta la realidad: despachó Ana desde la
  -- cuenta de operario, y la llegada la confirma la operaria de Artigas.
  -- Los uid tienen que ser distintos: el circuito no deja que la misma
  -- persona despache y reciba.
  v_uid_sal uuid := '0b26e2e0-5228-40ad-a4bd-7cf734f1aad9';  -- operadorprueba@gmail.com
  v_uid_lle uuid := 'e10700d1-c635-4db0-b286-029317e274e6';  -- logistica.artigas@gmail.com
  v_by_sal  text := 'Ana nante';
  v_by_lle  text := 'Rosario';
  v_nota    text := 'Corrección: al camión subió el 5A97, en el sistema se había escaneado el 33BE (solicitud #30)';
  b         record;   -- pallet bueno
  m         record;   -- pallet malo
  s         record;   -- movimiento de SALIDA a deshacer
  v_salida  timestamptz;
  v_ubic    text;
  v_dep_tipo text;
begin
  select * into b from public.imp_pallets where codigo = v_bueno;
  if not found then raise exception 'No existe el pallet %', v_bueno; end if;
  select * into m from public.imp_pallets where codigo = v_malo;
  if not found then raise exception 'No existe el pallet %', v_malo; end if;

  -- ── ¿ya se corrió? ────────────────────────────────────────
  if b.estado = 'CONSUMIDO' and m.estado = 'ESTACIONADO' then
    raise notice 'Ya estaba corregido: % consumido en % y % estacionado en %.',
      v_bueno, b.deposito, v_malo, m.deposito;
    return;
  end if;

  -- ── guardas: que el punto de partida sea el esperado ──────
  if m.estado <> 'EN_TRANSITO' then
    raise exception '% está en % y se esperaba EN_TRANSITO. Alguien ya lo movió: revisar antes de seguir.',
      v_malo, m.estado;
  end if;
  if b.estado <> 'ESTACIONADO' then
    raise exception '% está en % y se esperaba ESTACIONADO. Alguien ya lo movió: revisar antes de seguir.',
      v_bueno, b.estado;
  end if;
  if b.articulo_id <> m.articulo_id or b.unidades <> m.unidades then
    raise exception 'Los pallets no son intercambiables (artículo o cantidad distintos): no corresponde esta corrección.';
  end if;

  select * into s from public.imp_movimientos
   where pallet_id = m.id and tipo = 'SALIDA'
   order by created_at desc limit 1;
  if not found then raise exception 'No aparece el movimiento de SALIDA de %', v_malo; end if;
  v_salida := s.created_at;   -- la hora real en que salió el camión

  -- ── 1. El renglón del pedido pasa a apuntar al pallet correcto ──
  --  Va PRIMERO. Con el renglón todavía apuntando al 33BE, sacarlo de
  --  EN_TRANSITO haría que el trigger lo diera por entregado.
  update public.imp_solicitud_items
     set pallet_id = b.id, estado = 'PEDIDO'
   where solicitud_id = v_sol and pallet_id = m.id;
  if not found then
    raise exception 'La solicitud #% no tiene ningún renglón con el pallet %', v_sol, v_malo;
  end if;

  -- ── 2. El 33BE nunca salió: se deshace su viaje ────────────
  perform public.imp_stock_add(m.articulo_id, s.deposito, m.unidades);   -- le devuelve el stock a Furriol
  delete from public.imp_movimientos where id = s.id;                    -- salida que no ocurrió

  -- Vuelve a su ranura, salvo que se la hayan ocupado mientras tanto
  if m.ult_estanteria_id is not null and exists(
       select 1 from public.imp_pallets
        where estanteria_id = m.ult_estanteria_id and fila = m.ult_fila
          and columna = m.ult_columna and id <> m.id) then
    raise notice 'La ranura de % está ocupada: queda estacionado en % sin ubicar.', v_malo, m.origen;
    update public.imp_pallets
       set estado='ESTACIONADO', deposito=m.origen, destino=null,
           estanteria_id=null, fila=null, columna=null, subdeposito_id=null,
           salida_at=null, salida_by=null, salida_uid=null,
           llegada_at=null, llegada_by=null, llegada_uid=null
     where id = m.id;
  else
    update public.imp_pallets
       set estado='ESTACIONADO', deposito=m.origen, destino=null,
           estanteria_id=m.ult_estanteria_id, fila=m.ult_fila, columna=m.ult_columna,
           subdeposito_id=null,
           salida_at=null, salida_by=null, salida_uid=null,
           llegada_at=null, llegada_by=null, llegada_uid=null
     where id = m.id;
  end if;

  -- ── 3. El 5A97 sale de Furriol (lo que pasó a las 10:17) ───
  v_ubic := public.imp_ubic_txt2(b.estanteria_id, b.fila, b.columna, b.zona_id);
  perform public.imp_stock_add(b.articulo_id, b.deposito, -b.unidades);
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,
                                     unidades,usuario,ubicacion_de,nota,created_at)
    values (b.id,b.articulo_id,'SALIDA',b.deposito,m.destino,b.deposito,
            b.unidades,v_by_sal,v_ubic,v_nota,v_salida);
  update public.imp_pallets
     set estado='EN_TRANSITO', origen=b.deposito, destino=m.destino, deposito=null,
         ult_estanteria_id=coalesce(b.estanteria_id,ult_estanteria_id),
         ult_fila         =coalesce(b.fila,         ult_fila),
         ult_columna      =coalesce(b.columna,      ult_columna),
         estanteria_id=null, fila=null, columna=null,
         salida_at=v_salida, salida_by=v_by_sal, salida_uid=v_uid_sal
   where id = b.id;
  -- el trigger deja el renglón en ENVIADO

  -- ── 4. Llega a Artigas. Es FÁBRICA: entra y se consume ─────
  v_dep_tipo := public.imp_dep_tipo(m.destino);
  perform public.imp_stock_add(b.articulo_id, m.destino, b.unidades);
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,
                                     unidades,usuario,nota)
    values (b.id,b.articulo_id,'ENTRADA',b.origen,m.destino,m.destino,b.unidades,v_by_lle,v_nota);

  if v_dep_tipo = 'FABRICA' then
    perform public.imp_stock_add(b.articulo_id, m.destino, -b.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,nota)
      values (b.id,b.articulo_id,'CONSUMO',m.destino,b.unidades,v_by_lle,v_nota);
    update public.imp_pallets
       set estado='CONSUMIDO', deposito=m.destino,
           estanteria_id=null, fila=null, columna=null, subdeposito_id=null,
           llegada_at=now(), llegada_by=v_by_lle, llegada_uid=v_uid_lle,
           consumido_at=now(), consumido_by=v_by_lle
     where id = b.id;
  else
    update public.imp_pallets
       set estado='RECIBIDO', deposito=m.destino,
           llegada_at=now(), llegada_by=v_by_lle, llegada_uid=v_uid_lle
     where id = b.id;
  end if;
  -- el trigger marca el renglón ENTREGADO y cierra la solicitud

  raise notice 'Listo: % viajó y se consumió en %. % volvió a su ranura en %.',
    v_bueno, m.destino, v_malo, m.origen;
end $$;

-- ── Control ─────────────────────────────────────────────────
select p.codigo, p.estado, p.deposito, p.destino,
       public.imp_ubic_txt(p.estanteria_id, p.fila, p.columna) as ubicacion,
       p.salida_by, p.llegada_by
  from public.imp_pallets p
 where p.codigo in ('PLT-MSGD15LY-5A97','PLT-MSGD313S-33BE')
 order by p.codigo;
-- Esperado:
--   5A97 · CONSUMIDO   · Artigas · sin ubicación · Ana nante / Rosario
--   33BE · ESTACIONADO · Furriol · Estantería 1 · C3 · sin salida

select s.id, s.estado, s.entregada_at, i.pallet_id, i.estado as item, p.codigo
  from public.imp_solicitudes s
  join public.imp_solicitud_items i on i.solicitud_id = s.id
  left join public.imp_pallets p on p.id = i.pallet_id
 where s.id = 30;
-- Esperado: ENTREGADA · renglón ENTREGADO apuntando a PLT-MSGD15LY-5A97

select deposito, cantidad from public.imp_stock where articulo_id = 133 order by deposito;
-- Esperado SIN CAMBIOS: Artigas 0 · Furriol 20000

select id, tipo, origen, destino, deposito, unidades, usuario, created_at
  from public.imp_movimientos
 where pallet_id in (select id from public.imp_pallets
                      where codigo in ('PLT-MSGD15LY-5A97','PLT-MSGD313S-33BE'))
 order by id;
-- Esperado: el 5A97 con SALIDA + ENTRADA + CONSUMO, y el 33BE sin SALIDA
