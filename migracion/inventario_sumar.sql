-- ============================================================
--  RECEPCIÓN PUEDE SUMAR AL STOCK  ·  y el faltante que dejó
--
--  EL PROBLEMA
--  La política de escritura de `inventario` pide el módulo 'stock'.
--  Los operarios de recepción no lo tienen: registran la entrega
--  (esa tabla sí les deja) pero el UPDATE al inventario lo rechaza
--  RLS. Y Postgres, cuando RLS bloquea un UPDATE, NO devuelve error:
--  devuelve cero filas. Así que la pantalla les mostraba
--  "📥 BTC 80: 200 + 1.000 = 1.200" en verde y no se sumaba nada.
--
--  Por eso funcionaba para los admin y fallaba para los operarios,
--  con el mismo código y sin un solo mensaje de error.
--
--  LA SOLUCIÓN
--  Una función con privilegios que SÓLO SUMA (o resta) a una ficha.
--  No es "darles permiso sobre inventario": es darles permiso para
--  hacer exactamente una cosa. Mismo criterio que sync_pedido_recepcion
--  e imp_pallet_armar, que ya existen en este sistema.
--
--  De paso arregla una carrera que estaba latente: antes se leía el
--  stock, se sumaba en el navegador y se escribía el total. Dos
--  personas recibiendo a la vez se pisaban. Acá la suma la hace la
--  base sobre el valor actual.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

create or replace function public.inventario_sumar(p_id bigint, p_delta numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nuevo numeric; v_desc text;
begin
  -- Recepción o stock. El admin entra por has_module, que ya lo
  -- contempla. Cualquier otro, no.
  if not (public.has_module('recepcion') or public.has_module('stock')) then
    return jsonb_build_object('ok', false, 'error', 'No tenés permiso para tocar el stock');
  end if;
  if p_id is null or p_delta is null then
    return jsonb_build_object('ok', false, 'error', 'Falta la ficha o la cantidad');
  end if;

  update public.inventario
     set inventario = coalesce(inventario, 0) + p_delta
   where id = p_id
   returning inventario, descripcion into v_nuevo, v_desc;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No existe la ficha de inventario #' || p_id);
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'descripcion', v_desc, 'inventario', v_nuevo);
end $$;

revoke all on function public.inventario_sumar(bigint, numeric) from public;
grant execute on function public.inventario_sumar(bigint, numeric) to authenticated;


-- ============================================================
--  EL FALTANTE
--
--  El 24/08 se contaron 67 fichas: ese conteo es la base buena, así
--  que sólo falta lo recibido DESPUÉS por cuentas de operario.
--  Lo anterior ya está reflejado en el conteo.
--
--  Son estas entregas. Se suman con la función de arriba, así queda
--  el mismo camino que va a usar la app de ahora en más.
-- ============================================================
do $$
declare r record; res jsonb;
begin
  for r in
    select * from (values
      -- ficha, cantidad, qué es (para poder leerlo en el resultado)
      (111, 1000::numeric, 'Percarbonato de Sodio · OC 929 · 27/08'),
      ( 38, 1000::numeric, 'BTC 80 · OC 929 · 27/08'),
      (139,  690::numeric, 'Trietanolamina · OC 932 · 27/08'),
      ( 60, 1000::numeric, 'Dietanolamina de coco · OC 932 · 27/08'),
      ( 44, 1000::numeric, 'Cera QTE · OC 932 · 27/08'),
      ( 85,50000::numeric, 'Etiq. Medianas largo · OC 927 · 27/08')
    ) as t(ficha, cant, detalle)
  loop
    select public.inventario_sumar(r.ficha, r.cant) into res;
    raise notice '% -> %', r.detalle, res;
  end loop;
end $$;

-- OJO: quedan DOS entregas más sin sumar que NO se incluyen arriba
-- porque hay que decidirlas a mano:
--
--   · 27/08 · Blanqueador Óptico · 25 u  (OC 932)
--       No entró acá porque su ficha hay que confirmarla: revisá en
--       Stock que el nombre sea el mismo y sumale las 25.
--
--   · 26/08 · Cera natural de Abejas 100 u y Alcohol Rectificado 95%
--       4.050 u (NOELIA BENTANCUR)
--       Son POSTERIORES al conteo del 24/08, así que en principio
--       también faltan. Confirmá contra el depósito antes de sumarlas:
--       si el conteo se hizo después de esas entregas, ya están.
--
--   · 24/08 · Botella PET x 1 L Alta Bioetanol · 1.624 u (VALENTINA)
--       Mismo día del conteo. Si se contó después de recibirla, ya
--       está contada y sumarla la duplicaría. No la toques sin mirar.


-- ── Control ─────────────────────────────────────────────────
select id, descripcion, inventario
  from public.inventario
 where id in (111,38,139,60,44,85)
 order by id;
