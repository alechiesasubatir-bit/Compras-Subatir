-- ============================================================
--  trg_entregas_sync v2 - que borrar la ULTIMA entrega reabra la linea
--
--  EL PROBLEMA
--  La version de entregas_trigger.sql tenia dos ramas:
--
--      if  total >= pedida  -> marcar la linea recibida
--      elsif ne > 0         -> volvio a parcial: f_recepcion = null
--
--  Si se borraba la unica entrega de una linea, ne quedaba en 0 y no
--  entraba en ninguna de las dos: la linea se quedaba con la
--  f_recepcion que le habia puesto el trigger, pero sin una sola
--  entrega detras. Pedidos entonces la lee como "recibida al viejo
--  estilo" (completa, por el total pedido, sin historial) y encima no
--  deja corregirla: en una linea completa el formulario de entrega ni
--  se muestra.
--
--  Fue lo que paso con la OC 976 (percarbonato de Viracross, 21/09):
--  se registro la entrega por 5.000, se borro, y la linea quedo
--  diciendo que habian llegado las 5.000 cuando llegaron 3.000. Hubo
--  que destrabarla por SQL (corregir_recepcion_oc976.sql).
--
--  LA SOLUCION
--  Una sola rama. Se calcula si la linea esta completa y se escribe el
--  resumen SIEMPRE a partir de las entregas que quedan:
--
--    · completa  -> f_recepcion = la que tenia, o hoy si no tenia
--    · si no     -> f_recepcion = null (parcial o pendiente, da igual
--                   si quedan entregas o ninguna)
--
--  Y lote / COA / conforme / vencimiento / recibido por salen siempre
--  de las entregas vivas. Antes solo se recalculaban al completarse, y
--  al volver atras quedaban los datos de la entrega borrada: la linea
--  mostraba un lote de mercaderia que no estaba. Sin entregas, esos
--  campos quedan vacios, que es la verdad.
--
--  OJO: una linea recibida al viejo estilo (f_recepcion cargada a mano,
--  sin entregas) conserva su lote mientras nadie le registre entregas.
--  El trigger solo corre cuando se toca una fila de `entregas`, asi que
--  a las OC historicas no las mira. Pero si a una de esas se le carga
--  una entrega, el lote de la entrega reemplaza al que tenia escrito:
--  a partir de ahi la entrega es el dato bueno.
--
--  No toca el stock: eso lo resuelve la pantalla (restarAlBorrar en
--  subatir-app.js pregunta si hay que devolver la cantidad al
--  inventario). Desde la base no se puede saber si esa entrega habia
--  sumado: las viejas no sumaban, y las que no encontraron ficha
--  tampoco.
--
--  Correr en Supabase -> SQL Editor. Reemplaza la funcion anterior.
-- ============================================================

create or replace function public.sync_pedido_recepcion()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid bigint; total numeric; pedida numeric; completa boolean;
begin
  pid := coalesce(new.pedido_id, old.pedido_id);
  if pid is null then return coalesce(new, old); end if;

  select coalesce(sum(cantidad), 0) into total
    from public.entregas where pedido_id = pid;
  select cantidad into pedida from public.pedidos where id = pid;

  completa := pedida is not null and pedida > 0 and total >= pedida;

  update public.pedidos p set
    f_recepcion  = case when completa then coalesce(p.f_recepcion, current_date) end,
    lote         = (select string_agg(distinct e.lote, ' / ')
                      from public.entregas e where e.pedido_id = pid and coalesce(e.lote,'') <> ''),
    coa          = (select max(e.coa)      from public.entregas e where e.pedido_id = pid),
    conforme     = (select max(e.conforme) from public.entregas e where e.pedido_id = pid),
    f_vto        = (select e.f_vto from public.entregas e where e.pedido_id = pid order by e.created_at desc limit 1),
    recibido_por = (select e.recibido_por from public.entregas e where e.pedido_id = pid order by e.created_at desc limit 1)
  where p.id = pid;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_entregas_sync on public.entregas;
create trigger trg_entregas_sync
  after insert or delete or update on public.entregas
  for each row execute function public.sync_pedido_recepcion();

-- ── Verificacion ───────────────────────────────────────────────────
--  Lineas que tienen entregas cargadas y como quedaron. Ninguna puede
--  tener f_recepcion con lo recibido por debajo de lo pedido.
select p.n_orden, p.id, left(p.descripcion, 34) as descripcion,
       p.cantidad as pedida,
       coalesce(sum(e.cantidad), 0) as recibida,
       coalesce(p.f_recepcion::text, '(parcial / pendiente)') as f_recepcion,
       coalesce(p.lote, '-') as lote
  from public.pedidos p
  join public.entregas e on e.pedido_id = p.id
 group by p.id
having coalesce(sum(e.cantidad), 0) < p.cantidad
 order by p.id desc
 limit 20;

-- Esperado: todas con f_recepcion "(parcial / pendiente)".
-- Hoy la unica deberia ser el pedido 764 (OC 976, 3.000 de 5.000).
