-- ============================================================
--  BAJA 24/11/2026 · "Pastilla Triple Accion (3 unidades)" (218851)
--  Ya no se trabaja como materia prima.
--
--  El código 218851 tiene DOS filas en inventario:
--    id 107 · Pastilla Triple Accion · stock 6.900 · consumo 9.000
--             → la usa Previsión Cloro (cl_materias 8). NO se toca.
--    id 108 · Pastilla Triple Accion (3 unidades) · stock 0 · consumo 0
--             → la que se borra.
--  Por eso se borra POR ID, nunca por código.
--
--  Leído de la base antes de escribir esto: id 108 sin pedidos,
--  art_proveedor, mp_documentos ni cl_materias. El precio de Solsire
--  (precios id 230) es de la 107 y queda.
--
--  Aborta sin borrar si la 108 tiene stock o algo la usa.
--  Idempotente: si ya no está, no hace nada.
--  Correr en Supabase → SQL Editor.
-- ============================================================

do $$
declare r record; n int; c int;
begin
  select * into r from public.inventario where id = 108;
  if not found then
    raise notice 'La fila 108 ya no existe: nada que hacer.';
    return;
  end if;
  if r.codigo <> '218851' or r.descripcion not ilike '%3 unidades%' then
    raise exception 'La fila 108 es "%" (%), no la pastilla de 3 unidades. No se borra.', r.descripcion, r.codigo;
  end if;
  if coalesce(r.inventario,0) <> 0 then
    raise exception 'La fila 108 tiene stock % : no se borra.', r.inventario;
  end if;

  select (select count(*) from public.pedidos       where inventario_id = 108)
       + (select count(*) from public.art_proveedor where inventario_id = 108)
       + (select count(*) from public.mp_documentos where inventario_id = 108)
       + (select count(*) from public.cl_materias   where inventario_id = 108)
    into n;
  -- conteo_lineas está en conteos.sql pero no existe en la base: sólo
  -- se mira si algún día se crea (la 1ª versión de este script abortaba acá)
  if to_regclass('public.conteo_lineas') is not null then
    execute 'select count(*) from public.conteo_lineas where inventario_id = 108' into c;
    n := n + c;
  end if;
  if n > 0 then
    raise exception 'La fila 108 tiene % referencias (pedidos/reposición/calidad/conteos/cloro). No se borra.', n;
  end if;

  delete from public.inventario where id = 108;
  raise notice 'Borrada la fila 108 "Pastilla Triple Accion (3 unidades)".';
end $$;

-- ── Verificación ─────────────────────────────────────────────
-- Esperado: una sola fila, id 107 "Pastilla Triple Accion" con 6.900
select id, codigo, descripcion, inventario, consumo_mensual
  from public.inventario
 where codigo = '218851';
