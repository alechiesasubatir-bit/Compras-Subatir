-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v10
--
--  El ingreso guarda cuánto había antes y cuánto quedó después.
--
--  Hasta ahora el movimiento de INGRESO sólo anotaba las unidades
--  que entraban. Para un reporte de recepciones hace falta el
--  contexto: cuánto había en el depósito cuando llegó la
--  mercadería y en cuánto quedó. Eso NO se puede reconstruir
--  después — el stock de hoy ya absorbió todos los movimientos
--  posteriores — así que hay que anotarlo en el momento.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v9.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Columnas del contexto ─────────────────────────────────
alter table public.imp_movimientos add column if not exists stock_antes   numeric;
alter table public.imp_movimientos add column if not exists stock_despues numeric;

-- Los INGRESO que ya existan quedan en null: no se inventan. En el
-- reporte se muestran como "—", que es honesto; deducirlos sería
-- adivinar.

-- ── 2. Ingreso: anota el antes y el después ──────────────────
create or replace function public.imp_ingreso(
  p_art      bigint,
  p_dep      text,
  p_unidades numeric,
  p_user     text,
  p_nota     text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existe boolean; v_antes numeric; v_despues numeric;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  if coalesce(p_unidades,0) <= 0 then
    return jsonb_build_object('ok',false,'error','La cantidad tiene que ser mayor que cero');
  end if;
  select exists(select 1 from public.imp_depositos where nombre = p_dep) into v_existe;
  if not v_existe then
    return jsonb_build_object('ok',false,'error','El depósito '||coalesce(p_dep,'(vacío)')||' no existe');
  end if;
  if not exists(select 1 from public.imp_articulos where id = p_art) then
    return jsonb_build_object('ok',false,'error','Artículo inexistente');
  end if;

  -- Se lee ANTES de sumar: es la foto del momento en que llegó.
  select coalesce(cantidad,0) into v_antes
    from public.imp_stock where articulo_id = p_art and deposito = p_dep;
  v_antes := coalesce(v_antes, 0);

  perform public.imp_stock_add(p_art, p_dep, p_unidades);
  v_despues := v_antes + p_unidades;

  insert into public.imp_movimientos(articulo_id,tipo,destino,deposito,unidades,usuario,nota,
                                     stock_antes,stock_despues)
    values (p_art,'INGRESO',p_dep,p_dep,p_unidades,p_user,
            nullif(trim(coalesce(p_nota,'')),''), v_antes, v_despues);

  return jsonb_build_object('ok',true,'deposito',p_dep,'unidades',p_unidades,
                            'stock_antes',v_antes,'stock_despues',v_despues,
                            'disponible',public.imp_disponible(p_art,p_dep));
end $$;

-- ── 3. Comprobación ──────────────────────────────────────────
-- select m.created_at, a.descripcion, m.deposito,
--        m.stock_antes, m.unidades, m.stock_despues, m.nota, m.usuario
--   from public.imp_movimientos m
--   join public.imp_articulos a on a.id = m.articulo_id
--  where m.tipo = 'INGRESO'
--  order by m.created_at desc;
