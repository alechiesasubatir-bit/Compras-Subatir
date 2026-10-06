-- ============================================================
--  Pedidos de infraestructura #36 y #48: iban a sucursales
--
--  Se cargaron con destino Artigas porque la opción "sucursal" no
--  existía (llegó con imp_v25_infra_destino.sql, 06/10/2026). Datos
--  reales, según el usuario:
--    #36 (02/09) → Sucursal Minas
--    #48 (06/10) → Sucursal Centro · pidió Guillermo
--
--  QUÉ HACE
--  · El pedido pasa de destino Artigas a su sucursal.
--  · La SALIDA de Furriol queda (eso sí pasó) pero apuntando a la
--    sucursal, con la nota nueva.
--  · Se BORRAN la ENTRADA y el CONSUMO en Artigas: nunca llegaron ahí.
--    Artigas es fábrica, cada renglón entró y se consumió en el mismo
--    acto, así que su stock no cambia (sigue en 0). Furriol tampoco
--    cambia: la salida ya estaba descontada.
--
--  Idempotente: si un pedido ya tiene sucursal, no lo toca.
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  c record; s record; v_mov int; v_sal int;
begin
  for c in select * from (values
             (36::bigint, 'Minas'::text,  null::text),
             (48::bigint, 'Centro'::text, 'Guillermo'::text)) as t(id, suc, resp)
  loop
    select * into s from public.imp_solicitudes where id = c.id;
    if not found then raise exception 'El pedido #% no existe', c.id; end if;
    if s.sucursal is not null then
      raise notice 'Pedido #% ya va a sucursal %: no se toca.', c.id, s.sucursal;
      continue;
    end if;
    -- Guardas: que sea el pedido que creemos
    if s.destino is distinct from 'Artigas' or s.origen is distinct from 'Furriol' then
      raise exception 'El pedido #% es % → %, no Furriol → Artigas. No se toca.', c.id, s.origen, s.destino;
    end if;
    if exists(select 1 from public.imp_solicitud_items
               where solicitud_id = c.id and pallet_id is not null) then
      raise exception 'El pedido #% tiene pallets: no es sólo infraestructura. No se toca.', c.id;
    end if;

    -- Movimientos en Artigas que no ocurrieron
    delete from public.imp_movimientos
     where pallet_id is null and tipo in ('ENTRADA','CONSUMO') and deposito = 'Artigas'
       and nota like 'Infraestructura · pedido #'||c.id||' ·%';
    get diagnostics v_mov = row_count;

    -- La salida de Furriol: ahora hacia la sucursal
    update public.imp_movimientos
       set destino = c.suc,
           nota = 'Infraestructura · pedido #'||c.id||' · sin pallet · a sucursal '||c.suc
               || coalesce(' · pide '||c.resp,'')
               || coalesce(' · motivo: '||coalesce(s.motivo,s.nota),'')
               || ' · destino corregido 06/10/2026 (antes Artigas)'
     where pallet_id is null and tipo = 'SALIDA' and deposito = 'Furriol'
       and nota like 'Infraestructura · pedido #'||c.id||' ·%';
    get diagnostics v_sal = row_count;

    update public.imp_solicitudes
       set destino = null, sucursal = c.suc,
           responsable = coalesce(c.resp, responsable)
     where id = c.id;

    raise notice 'Pedido #% → Sucursal %: % salidas corregidas, % movimientos de Artigas borrados.',
      c.id, c.suc, v_sal, v_mov;
  end loop;
end $$;

-- ── Control ─────────────────────────────────────────────────
select id, origen, destino, sucursal, responsable, coalesce(motivo, nota) as motivo, estado
  from public.imp_solicitudes where id in (36,48) order by id;
-- Esperado: 36 Furriol · (null) · Minas  · (null)    · Fabrica Diego · ENTREGADA
--           48 Furriol · (null) · Centro · Guillermo · (null)        · ENTREGADA

select tipo, deposito, destino, count(*), sum(unidades)
  from public.imp_movimientos
 where pallet_id is null and (nota like 'Infraestructura · pedido #36 ·%' or nota like 'Infraestructura · pedido #48 ·%')
 group by 1,2,3 order by 1,2,3;
-- Esperado: sólo SALIDA desde Furriol · Minas 3 movs 17 u. · Centro 2 movs 21 u.

select articulo_id, deposito, cantidad from public.imp_stock
 where articulo_id in (128,129,130) order by 1,2;
-- Esperado (sin cambios): Furriol 598 · 562 · 84 · Artigas 0 los tres
