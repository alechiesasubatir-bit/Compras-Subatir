-- ============================================================
--  CAMBIAR LA CANTIDAD PEDIDA RECALCULA LA RECEPCIÓN  ·  26/11/2026
--
--  EL PROBLEMA
--  Si una línea tiene entregas, la fecha de recepción la pone la base
--  (trigger trg_entregas_sync) cada vez que se registra o se borra una
--  entrega. Pero si después se corrige la CANTIDAD PEDIDA desde
--  Pedidos → Editar, nadie vuelve a hacer la cuenta.
--
--  Pasó con la OC 905 (Etiquetas medianas corto): el 03/09 llegaron
--  31.200 etiquetas; el 29/09 se bajó lo pedido a 31.200 para cerrarla.
--  Lo recibido ya alcanzaba lo pedido, pero la línea siguió sin fecha
--  de recepción: Pedidos y el Dashboard la cuentan como PENDIENTE
--  mientras Recepción y el detalle la muestran COMPLETA.
--
--  QUÉ HACE
--  1. Nuevo trigger trg_pedidos_cantidad: cuando cambia la cantidad de
--     una línea con entregas, la cierra (o la reabre) según lo recibido.
--     Las líneas sin entregas (recepción vieja, a mano) no se tocan.
--  2. trg_entregas_sync pone como fecha de recepción la fecha de la
--     entrega que completó la línea (la que eligió quien recibió), no
--     el día del servidor: la base corre en hora UTC y después de las
--     21 h ya era "mañana".
--  3. Arregla las líneas que hoy no coinciden (al 26/11: sólo la 905).
--
--  No toca cantidades, entregas ni stock.
--  Correr en Supabase → SQL Editor, de una sola vez.
-- ============================================================

begin;

-- Antes: líneas con entregas cuya fecha de recepción no coincide con lo recibido
with s as (select pedido_id, sum(cantidad) tot, max(fecha) ult from public.entregas group by 1)
select p.id, p.n_orden, p.descripcion, p.cantidad as pedida, s.tot as recibida, p.f_recepcion
  from public.pedidos p join s on s.pedido_id = p.id
 where (p.f_recepcion is null and p.cantidad > 0 and s.tot >= p.cantidad)
    or (p.f_recepcion is not null and s.tot < p.cantidad);

-- 2. Fecha de la entrega, no la del servidor
create or replace function public.sync_pedido_recepcion()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid bigint; total numeric; pedida numeric; ne int; ult date;
begin
  pid := coalesce(new.pedido_id, old.pedido_id);
  if pid is null then return coalesce(new, old); end if;

  select coalesce(sum(cantidad),0), count(*), max(fecha) into total, ne, ult
    from public.entregas where pedido_id = pid;
  select cantidad into pedida from public.pedidos where id = pid;

  if pedida is not null and pedida > 0 and total >= pedida then
    -- Línea completa → marcar recibida con resumen de las entregas
    update public.pedidos p set
      f_recepcion  = coalesce(p.f_recepcion, ult, current_date),
      lote         = (select string_agg(distinct e.lote, ' / ')
                        from public.entregas e where e.pedido_id = pid and coalesce(e.lote,'') <> ''),
      coa          = (select max(e.coa)      from public.entregas e where e.pedido_id = pid),
      conforme     = (select max(e.conforme) from public.entregas e where e.pedido_id = pid),
      f_vto        = (select e.f_vto from public.entregas e where e.pedido_id = pid order by e.created_at desc limit 1),
      recibido_por = (select e.recibido_por from public.entregas e where e.pedido_id = pid order by e.created_at desc limit 1)
    where p.id = pid;
  elsif ne > 0 then
    -- Volvió a parcial/pendiente (se borraron entregas): reabrir la línea
    update public.pedidos set f_recepcion = null where id = pid;
  end if;

  return coalesce(new, old);
end $$;

-- 1. Cambiar la cantidad pedida rehace la cuenta
create or replace function public.pedidos_recalcula_recepcion()
returns trigger language plpgsql security definer set search_path = public as $$
declare total numeric; ne int; ult date;
begin
  select coalesce(sum(cantidad),0), count(*), max(fecha) into total, ne, ult
    from public.entregas where pedido_id = new.id;
  if ne = 0 then return new; end if;            -- recepción vieja, a mano: no se toca

  if new.cantidad > 0 and total >= new.cantidad then
    new.f_recepcion := coalesce(new.f_recepcion, ult);
    new.lote        := coalesce(nullif(new.lote,''), (select string_agg(distinct e.lote, ' / ')
                         from public.entregas e where e.pedido_id = new.id and coalesce(e.lote,'') <> ''));
    new.coa         := coalesce(nullif(new.coa,''), (select max(e.coa) from public.entregas e where e.pedido_id = new.id));
  else
    new.f_recepcion := null;                    -- lo pedido ya no está todo recibido
  end if;
  return new;
end $$;

drop trigger if exists trg_pedidos_cantidad on public.pedidos;
create trigger trg_pedidos_cantidad
  before update of cantidad on public.pedidos
  for each row when (old.cantidad is distinct from new.cantidad)
  execute function public.pedidos_recalcula_recepcion();

-- 3. Las que hoy no coinciden
with s as (select pedido_id, sum(cantidad) tot, max(fecha) ult from public.entregas group by 1)
update public.pedidos p set f_recepcion = s.ult
  from s where s.pedido_id = p.id
   and p.f_recepcion is null and p.cantidad > 0 and s.tot >= p.cantidad;

with s as (select pedido_id, sum(cantidad) tot from public.entregas group by 1)
update public.pedidos p set f_recepcion = null
  from s where s.pedido_id = p.id
   and p.f_recepcion is not null and s.tot < p.cantidad;

-- Después: tiene que dar cero filas
with s as (select pedido_id, sum(cantidad) tot from public.entregas group by 1)
select p.id, p.n_orden, p.cantidad, s.tot, p.f_recepcion
  from public.pedidos p join s on s.pedido_id = p.id
 where (p.f_recepcion is null and p.cantidad > 0 and s.tot >= p.cantidad)
    or (p.f_recepcion is not null and s.tot < p.cantidad);

commit;
