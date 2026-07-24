-- ============================================================
--  Sincroniza pedidos.f_recepcion (y datos de recepción) con las
--  entregas parciales. Corre con privilegios (SECURITY DEFINER),
--  así el operario NO necesita permiso de escritura sobre pedidos.
--  Correr UNA vez en Supabase → SQL Editor (después de entregas.sql).
-- ============================================================
create or replace function public.sync_pedido_recepcion()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid bigint; total numeric; pedida numeric; ne int;
begin
  pid := coalesce(new.pedido_id, old.pedido_id);
  if pid is null then return coalesce(new, old); end if;

  select coalesce(sum(cantidad),0), count(*) into total, ne
    from public.entregas where pedido_id = pid;
  select cantidad into pedida from public.pedidos where id = pid;

  if pedida is not null and pedida > 0 and total >= pedida then
    -- Línea completa → marcar recibida con resumen de las entregas
    update public.pedidos p set
      f_recepcion  = coalesce(p.f_recepcion, current_date),
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

drop trigger if exists trg_entregas_sync on public.entregas;
create trigger trg_entregas_sync
  after insert or delete or update on public.entregas
  for each row execute function public.sync_pedido_recepcion();
