-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v4
--
--  1) Pallet de cajas completas + remanente: casi siempre hay una
--     caja abierta con la que se completa el pedido y que no trae
--     la cantidad entera.
--  2) Armado sin asignar lugar: el pallet puede quedar en el
--     depósito sin ranura y ubicarse después arrastrándolo al mapa.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v3.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Remanente: unidades sueltas fuera de caja ─────────────
--    unidades = cajas × un_x_caja + remanente
alter table public.imp_pallets add column if not exists remanente numeric not null default 0;

-- Los pallets que ya existían no tenían remanente: se deduce del total.
-- Si el total no es múltiplo exacto de la caja, la diferencia era remanente.
update public.imp_pallets
   set remanente = greatest(0, coalesce(unidades,0) - coalesce(cajas,0) * coalesce(un_x_caja,0))
 where remanente = 0
   and coalesce(cajas,0) > 0
   and coalesce(un_x_caja,0) > 0
   and coalesce(unidades,0) <> coalesce(cajas,0) * coalesce(un_x_caja,0);

-- ── 2. Contar: ahora también registra el remanente ───────────
--    Se reemplaza la firma anterior (4 parámetros) por una de 5.
drop function if exists public.imp_pallet_contar(bigint, numeric, numeric, text);
create or replace function public.imp_pallet_contar(
  p_pallet    bigint,
  p_cajas     numeric,
  p_unidades  numeric,
  p_user      text,
  p_remanente numeric default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then return jsonb_build_object('ok',false,'error','Pallet inexistente'); end if;
  if p.estado <> 'ABIERTO' then
    return jsonb_build_object('ok',false,'error','El pallet ya está cerrado: no se puede cambiar el conteo');
  end if;
  if coalesce(p_unidades,0) < 0 or coalesce(p_remanente,0) < 0 then
    return jsonb_build_object('ok',false,'error','Las cantidades no pueden ser negativas');
  end if;

  update public.imp_pallets
     set cajas     = p_cajas,
         unidades  = coalesce(p_unidades,0),
         remanente = coalesce(p_remanente,0)
   where id = p_pallet;

  return jsonb_build_object('ok',true);
end $$;

-- ── 3. Ubicación legible cuando el pallet no tiene lugar ─────
--    Ya se contempla: imp_ubic_txt2 devuelve null y la app muestra
--    "sin ranura". No hace falta cambiar nada más: estanteria_id,
--    fila y columna son nullable y el índice único es parcial
--    (sólo aplica cuando estanteria_id no es null).

-- ── 4. Comprobación rápida ───────────────────────────────────
-- select codigo, cajas, un_x_caja, remanente, unidades,
--        (coalesce(cajas,0)*coalesce(un_x_caja,0) + coalesce(remanente,0)) as recalculado
--   from public.imp_pallets
--  order by created_at desc limit 20;
