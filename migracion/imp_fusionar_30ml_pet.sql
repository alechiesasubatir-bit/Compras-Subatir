-- ============================================================
--  DEPÓSITOS · fusionar "30ML PET bottle" (id 242) dentro de
--  "Envase Unicornio 30 mL Bajo Transparente (8.8g)" (id 125)
--
--  Los dos tienen el código 220210. El 242 se dio de alta el 12/10
--  con el nombre del proveedor y no está vacío:
--    · pallet #79 (PLT-MV5GQGBK-B4AE) · 10.000 u · EN_TRANSITO a Artigas
--      (despachado el 13/10)
--    · 3 movimientos: INGRESO, ARMADO, SALIDA
--    · 1 renglón en la corrida "Prueba" de Importaciones
--  Todo pasa al 125, así cuando el pallet llegue a Artigas la entrada
--  y el consumo quedan en el artículo correcto. Después se borra el 242.
--
--  Única duplicación de código en imp_articulos (verificado el 14/10).
--  Idempotente: si el 242 ya no existe, no hace nada.
--  Correr en Supabase → SQL Editor.
-- ============================================================
do $$
declare v_bueno bigint := 125; v_dup bigint := 242;
begin
  if not exists (select 1 from public.imp_articulos where id = v_dup) then
    raise notice 'El 242 ya no existe: nada que hacer'; return;
  end if;
  -- Seguro: que sean los dos 220210 de Subatir y no otros por un id cambiado
  if (select count(*) from public.imp_articulos
       where id in (v_bueno, v_dup) and proveedor = 'Subatir' and codigo = '220210') <> 2 then
    raise exception 'Los ids 125/242 no son los dos 220210 de Subatir: no se toca nada';
  end if;

  update public.imp_pallets         set articulo_id = v_bueno where articulo_id = v_dup;
  update public.imp_movimientos     set articulo_id = v_bueno where articulo_id = v_dup;
  update public.imp_solicitud_items set articulo_id = v_bueno where articulo_id = v_dup;

  -- Stock: se suma por depósito (hoy el 242 tiene 0 en Furriol)
  insert into public.imp_stock (articulo_id, deposito, cantidad)
  select v_bueno, deposito, cantidad from public.imp_stock where articulo_id = v_dup
  on conflict (articulo_id, deposito)
    do update set cantidad = public.imp_stock.cantidad + excluded.cantidad;
  delete from public.imp_stock where articulo_id = v_dup;

  -- Previsión: el 125 ya tiene su renglón en cada corrida; el del 242 sobra
  delete from public.imp_prev_datos where articulo_id = v_dup;

  delete from public.imp_articulos where id = v_dup;
end $$;

-- ── Control ─────────────────────────────────────────────────
-- Esperado: un solo artículo 220210 (id 125); el pallet #79 apuntando
-- al 125 y EN_TRANSITO; 10 movimientos del 125 (7 viejos + 3 del 242).
select id, codigo, descripcion from public.imp_articulos where codigo = '220210';
select id, codigo, articulo_id, estado, unidades from public.imp_pallets where id = 79;
select articulo_id, count(*) as movimientos from public.imp_movimientos
 where articulo_id in (125, 242) group by articulo_id;
