-- ============================================================
--  Infraestructura · devolucion de la sucursal Centro a Furriol
--  Pedido #53 (09/10/2026, pidio Diego, "Armado nueva sucursal"):
--  salieron 134 parantes y 19 patas. Sobraron y vuelven a Furriol:
--      3 Pata Lateral (Portico) 2m x 60cm   (art. 130, cod. 490002)
--      1 Parante 2m                         (art. 129, cod. 490078)
--
--  QUE HACE
--    · Suma al stock de Furriol (imp_stock).
--    · Deja un movimiento ENTRADA por articulo, con origen "Sucursal
--      Centro" y "pedido #53" en la nota: Informes -> Depositos ->
--      Infraestructura lo cuenta como ingreso y lo cuelga del pedido.
--    · NO toca el renglon del pedido: lo que se despacho fue 134/19 y
--      eso queda como historia. "Por destino" sigue mostrando lo
--      despachado; la devolucion se ve en los movimientos.
--
--  ANTES DE CORRER: en Furriol tiene que haber 394 parantes y 59 patas.
--  Idempotente: si ya existe el movimiento de devolucion de ese
--  articulo, no suma de nuevo.
--
--  Correr en Supabase -> SQL Editor.
-- ============================================================

begin;

do $$
declare r record; v_antes numeric;
begin
  for r in select * from (values (130::bigint, 3::numeric), (129::bigint, 1::numeric)) as t(art, u) loop
    if exists (select 1 from public.imp_movimientos
                where articulo_id = r.art and tipo = 'ENTRADA'
                  and nota like 'Devolucion · pedido #53 %') then
      raise notice 'art % ya devuelto, no se suma de nuevo', r.art;
      continue;
    end if;

    select coalesce(cantidad, 0) into v_antes
      from public.imp_stock where articulo_id = r.art and deposito = 'Furriol';

    perform public.imp_stock_add(r.art, 'Furriol', r.u);

    insert into public.imp_movimientos
           (articulo_id, tipo, origen, destino, deposito, unidades, usuario, nota, stock_antes, stock_despues)
    values (r.art, 'ENTRADA', 'Sucursal Centro', 'Furriol', 'Furriol', r.u, 'alechiesa.subatir',
            'Devolucion · pedido #53 · de sucursal Centro · sobrante del armado de la nueva sucursal',
            v_antes, coalesce(v_antes, 0) + r.u);
  end loop;
end $$;

commit;

-- ── Verificacion ───────────────────────────────────────────────────
select a.id, a.codigo, a.descripcion, s.deposito, s.cantidad
  from public.imp_stock s
  join public.imp_articulos a on a.id = s.articulo_id
 where s.articulo_id in (129, 130) and s.deposito = 'Furriol'
 order by a.id;

-- Esperado:
--   129 Parante      Furriol 395
--   130 Pata Lateral Furriol  62
