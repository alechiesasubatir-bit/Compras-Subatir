-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v24
--
--  CORREGIR EL STOCK de los artículos que NO son de Consumo.
--
--  Hasta acá el stock sólo podía SUBIR a mano (imp_ingreso). Bajaba
--  únicamente por el circuito de pallets o por infraestructura. La
--  mercadería de Venta, Venta Piscina e Infraestructura se mueve por
--  fuera de ese circuito —se vende, se rompe, se devuelve— así que el
--  número se despega de la realidad y no había forma de cuadrarlo.
--
--  Esta función fija el stock en el valor real contado. La diferencia
--  la calcula ella; el usuario escribe cuánto HAY, no cuánto sumar.
--
--  Tres límites, y los tres viven acá adentro, no en la pantalla:
--
--   1. Sólo admin. Esconder el botón no impide llamar la RPC.
--   2. Consumo queda afuera. Es lo que Fabricantes pide todos los días
--      y su stock lo mueve el circuito de solicitudes; corregirlo a
--      mano taparía descuadres en vez de mostrarlos.
--   3. NO se puede bajar por debajo de lo que ya está dentro de
--      pallets ABIERTO/ESTACIONADO en ese depósito. El stock del
--      depósito YA INCLUYE esas unidades (los pallets reservan, no
--      suman: ver imp_v5). Dejarlo por debajo pondría el "disponible
--      para armar" en negativo, que es un número imposible. Si el
--      pallet es el que está mal, se corrige o se deshace el pallet.
--
--  Correr UNA vez en Supabase → SQL Editor. Es idempotente.
-- ============================================================

create or replace function public.imp_ajuste_stock(
  p_art      bigint,
  p_dep      text,
  p_cantidad numeric,          -- cuánto HAY realmente, no la diferencia
  p_user     text,
  p_nota     text default null  -- obligatoria: es lo que distingue un
                                -- ajuste de un número que apareció solo
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tipo    text;
  v_antes   numeric;
  v_delta   numeric;
  v_pallet  numeric;
  v_npal    int;
  v_nota    text;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;

  if not public.is_admin() then
    return jsonb_build_object('ok',false,
      'error','Sólo un administrador puede corregir el stock');
  end if;

  select tipo into v_tipo
    from public.imp_articulos where id = p_art;
  if not found then
    return jsonb_build_object('ok',false,'error','Artículo inexistente');
  end if;

  if coalesce(v_tipo,'Consumo') = 'Consumo' then
    return jsonb_build_object('ok',false,
      'error','El stock de Consumo no se corrige a mano: lo mueven los pedidos');
  end if;

  if p_cantidad is null or p_cantidad < 0 then
    return jsonb_build_object('ok',false,'error','La cantidad no puede ser negativa');
  end if;

  if not exists(select 1 from public.imp_depositos where nombre = p_dep) then
    return jsonb_build_object('ok',false,
      'error','El depósito '||coalesce(p_dep,'(vacío)')||' no existe');
  end if;

  v_nota := nullif(trim(coalesce(p_nota,'')),'');
  if v_nota is null then
    return jsonb_build_object('ok',false,'error','Poné el motivo de la corrección');
  end if;

  -- El piso: lo que está reservado dentro de pallets de este depósito.
  select coalesce(sum(unidades),0), count(*) into v_pallet, v_npal
    from public.imp_pallets
   where articulo_id = p_art and deposito = p_dep
     and estado in ('ABIERTO','ESTACIONADO');

  if p_cantidad < v_pallet then
    return jsonb_build_object('ok',false,'minimo',v_pallet,'pallets',v_npal,
      'error','En '||p_dep||' hay '||public.imp_num_txt(v_pallet)||' u. dentro de '
            ||v_npal||' pallet'||(case when v_npal=1 then '' else 's' end)
            ||': no podés dejarlo en menos de '||public.imp_num_txt(v_pallet)
            ||'. Si el pallet está mal, corregilo o deshacelo primero.');
  end if;

  select coalesce(cantidad,0) into v_antes
    from public.imp_stock where articulo_id = p_art and deposito = p_dep;
  v_antes := coalesce(v_antes, 0);
  v_delta := p_cantidad - v_antes;

  -- Sin diferencia no hay nada que anotar: un movimiento de cero
  -- ensucia la bitácora sin decir nada.
  if v_delta = 0 then
    return jsonb_build_object('ok',true,'sin_cambio',true,'deposito',p_dep,
      'stock_antes',v_antes,'stock_despues',v_antes,'delta',0,
      'disponible',public.imp_disponible(p_art,p_dep));
  end if;

  perform public.imp_stock_add(p_art, p_dep, v_delta);

  -- unidades va CON SIGNO: es la corrección, no una cantidad que entró.
  insert into public.imp_movimientos(articulo_id,tipo,destino,deposito,unidades,usuario,nota,
                                     stock_antes,stock_despues)
    values (p_art,'AJUSTE',p_dep,p_dep,v_delta,p_user,v_nota,v_antes,p_cantidad);

  return jsonb_build_object('ok',true,'deposito',p_dep,'delta',v_delta,
                            'stock_antes',v_antes,'stock_despues',p_cantidad,
                            'disponible',public.imp_disponible(p_art,p_dep));
end $$;

grant execute on function public.imp_ajuste_stock(bigint,text,numeric,text,text) to authenticated;

-- ── Comprobación ─────────────────────────────────────────────
-- Los ajustes hechos, con el antes y el después:
-- select m.created_at, a.descripcion, a.tipo, m.deposito,
--        m.stock_antes, m.unidades as correccion, m.stock_despues,
--        m.nota, m.usuario
--   from public.imp_movimientos m
--   join public.imp_articulos a on a.id = m.articulo_id
--  where m.tipo = 'AJUSTE'
--  order by m.created_at desc;
