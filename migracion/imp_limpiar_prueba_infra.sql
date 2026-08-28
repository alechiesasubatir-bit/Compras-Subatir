-- ============================================================
--  LIMPIAR LA PRUEBA DEL PEDIDO DE INFRAESTRUCTURA
--
--  Para verificar imp_v23_infra.sql hubo que hacer el circuito
--  completo con mercadería real: se pidieron, despacharon y
--  recibieron 5 «Estanteria Picking Pata Lateral» de Furriol a
--  Artigas (pedido #31, renglón #30, 28/08/2026).
--
--  Funcionó — el stock de Furriol bajó de 90 a 85 y el pedido se
--  cerró solo — pero esas 5 unidades no se movieron de verdad: siguen
--  en el estante. Esto devuelve todo a como estaba.
--
--  Borra el pedido de prueba y sus tres movimientos (SALIDA, ENTRADA
--  y CONSUMO), que se reconocen por la nota que les puso la función.
--
--  Idempotente: si ya se corrió, avisa y no hace nada.
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare
  v_sol   bigint := 31;
  v_art   bigint := 130;
  v_un    numeric;
  v_movs  int;
  s       record;
begin
  select * into s from public.imp_solicitudes where id = v_sol;
  if not found then
    raise notice 'El pedido #% ya no existe: nada que limpiar.', v_sol;
    return;
  end if;
  -- Guarda: que sea la prueba y no un pedido de verdad
  if s.solicitante <> 'PRUEBA Claude' then
    raise exception 'El pedido #% es de «%», no es la prueba. No se toca.', v_sol, s.solicitante;
  end if;

  select coalesce(sum(unidades),0) into v_un
    from public.imp_solicitud_items
   where solicitud_id = v_sol and articulo_id = v_art and estado = 'ENTREGADO';

  -- El stock vuelve al estante de Furriol. Artigas no se toca: es
  -- fábrica, entró y se consumió en el mismo acto, así que quedó en 0.
  if v_un > 0 then
    perform public.imp_stock_add(v_art, s.origen, v_un);
    raise notice 'Devueltas % unidades a %.', v_un, s.origen;
  end if;

  delete from public.imp_movimientos
   where nota like '%pedido #'||v_sol||'%' and pallet_id is null;
  get diagnostics v_movs = row_count;
  raise notice 'Movimientos borrados: %', v_movs;

  delete from public.imp_solicitud_items where solicitud_id = v_sol;
  delete from public.imp_solicitudes      where id = v_sol;
  raise notice 'Pedido de prueba #% borrado.', v_sol;
end $$;

-- ── Control ─────────────────────────────────────────────────
select deposito, cantidad from public.imp_stock
 where articulo_id in (128,129,130) order by articulo_id, deposito;
-- Esperado: 128 Furriol 600 · 129 Furriol 592 · 130 Furriol 90 · Artigas 0 los tres

select count(*) as pedidos_de_prueba from public.imp_solicitudes where solicitante = 'PRUEBA Claude';
-- Esperado: 0

select count(*) as movimientos_de_prueba from public.imp_movimientos where nota like '%pedido #31%';
-- Esperado: 0
