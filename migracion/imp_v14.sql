-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v14
--
--  Solicitudes de mercadería: alguien pide, el depósito prepara.
--
--  Hasta ahora una transferencia la armaba el operario de la nada:
--  entraba a "Transferir pallets", marcaba unos cuantos y les ponía
--  destino. No quedaba registro de QUIÉN los había pedido ni para
--  qué, y el que necesitaba la mercadería tenía que pedirla por
--  fuera del sistema.
--
--  Ahora hay dos roles y un papel entre ellos:
--
--    SOLICITANTE  busca por descripción, ve los pallets disponibles
--                 con su ubicación y marca los que necesita.
--    OPERARIO     ve la solicitud, inicia el recorrido, prepara esos
--                 pallets y los escanea para enviarlos.
--
--  DECISIÓN DE DISEÑO — el solicitante elige PALLETS CONCRETOS, no
--  "500 unidades de X". Es lo que pidió el usuario y tiene sentido
--  acá: los pallets son unidades físicas cerradas con su QR, y el
--  que pide sabe cuál necesita (lote, vencimiento). La contra es que
--  hay que RESERVAR: si dos personas piden el mismo pallet, el
--  segundo se lleva una sorpresa. Eso lo impide un índice único
--  parcial más abajo, no la buena voluntad de la app.
--
--  CÓMO SE ENGANCHA CON LO QUE YA ANDA: al iniciar el recorrido la
--  solicitud escribe imp_pallets.destino, que es exactamente lo que
--  el escaneo de salida ya necesitaba. De ahí en adelante el flujo
--  es el de siempre — salida, tránsito, llegada, consumir o
--  estacionar. Esta etapa NO reinventa nada de eso: le pone un
--  pedido adelante.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v13.sql
--  Es idempotente.
-- ============================================================

-- ── 1. La solicitud ──────────────────────────────────────────
create table if not exists public.imp_solicitudes (
  id            bigint generated always as identity primary key,
  solicitante   text not null,
  origen        text not null references public.imp_depositos(nombre) on update cascade,
  destino       text not null references public.imp_depositos(nombre) on update cascade,
  estado        text not null default 'PENDIENTE',
  nota          text,
  operario      text,
  created_at    timestamptz not null default now(),
  iniciada_at   timestamptz,
  entregada_at  timestamptz,
  cerrada_by    text
);

alter table public.imp_solicitudes drop constraint if exists imp_solicitudes_estado_check;
alter table public.imp_solicitudes add constraint imp_solicitudes_estado_check
  check (estado in ('PENDIENTE','EN_PREPARACION','EN_TRANSITO','ENTREGADA','CANCELADA'));

-- Pedirse mercadería a uno mismo no es una transferencia.
alter table public.imp_solicitudes drop constraint if exists imp_solicitudes_dep_check;
alter table public.imp_solicitudes add constraint imp_solicitudes_dep_check
  check (origen <> destino);

create index if not exists imp_solicitudes_estado_idx on public.imp_solicitudes(estado);

-- ── 2. Los pallets pedidos ───────────────────────────────────
create table if not exists public.imp_solicitud_items (
  id           bigint generated always as identity primary key,
  solicitud_id bigint not null references public.imp_solicitudes(id) on delete cascade,
  pallet_id    bigint not null references public.imp_pallets(id) on delete cascade,
  estado       text not null default 'PEDIDO',
  created_at   timestamptz not null default now(),
  unique (solicitud_id, pallet_id)
);

alter table public.imp_solicitud_items drop constraint if exists imp_solicitud_items_estado_check;
alter table public.imp_solicitud_items add constraint imp_solicitud_items_estado_check
  check (estado in ('PEDIDO','ENVIADO','ENTREGADO','CANCELADO'));

create index if not exists imp_solicitud_items_sol_idx on public.imp_solicitud_items(solicitud_id);

--  LA RESERVA. Un pallet no puede estar pedido en dos solicitudes
--  vivas a la vez. Es un índice, no una regla de la app: aunque dos
--  celulares confirmen en el mismo segundo, la base deja pasar uno
--  solo. Los items cerrados (entregados o cancelados) no cuentan, así
--  el mismo pallet se puede volver a pedir más adelante.
create unique index if not exists imp_solicitud_items_pallet_vivo
  on public.imp_solicitud_items(pallet_id)
  where estado in ('PEDIDO','ENVIADO');

-- ── 3. Qué pallets se pueden pedir ───────────────────────────
--  Cerrado, quieto en su depósito, sin destino puesto y sin estar ya
--  en otra solicitud. Con la ubicación resuelta para poder ordenar el
--  recorrido y para que el solicitante vea dónde está.
create or replace view public.imp_pallets_disponibles
with (security_invoker = true) as
select p.id, p.codigo, p.deposito, p.articulo_id,
       a.descripcion as articulo, a.codigo as art_codigo, a.tipo,
       p.unidades, p.cajas, p.estado,
       p.estanteria_id, e.nombre as estanteria, e.subdeposito_id,
       s.nombre as subdeposito,
       p.fila, p.columna,
       public.imp_ubic_txt2(p.estanteria_id, p.fila, p.columna, p.zona_id) as ubicacion
  from public.imp_pallets p
  left join public.imp_articulos a on a.id = p.articulo_id
  left join public.imp_estanterias e on e.id = p.estanteria_id
  left join public.imp_subdepositos s on s.id = e.subdeposito_id
 where p.estado = 'ESTACIONADO'
   and p.destino is null
   and not exists (
     select 1 from public.imp_solicitud_items i
      where i.pallet_id = p.id and i.estado in ('PEDIDO','ENVIADO')
   );

-- ── 4. Resumen para las listas ───────────────────────────────
create or replace view public.imp_solicitud_resumen
with (security_invoker = true) as
select s.*,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as items,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado = 'ENTREGADO') as entregados,
       (select coalesce(sum(p.unidades),0) from public.imp_solicitud_items i
         join public.imp_pallets p on p.id = i.pallet_id
        where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as unidades
  from public.imp_solicitudes s;

-- ── 5. Crear una solicitud ───────────────────────────────────
--  Se valida pallet por pallet ADENTRO de la transacción: entre que
--  el celular armó la lista y toca Confirmar puede haber pasado un
--  rato, y otro pudo llevarse alguno.
create or replace function public.imp_solicitud_crear(
  p_origen  text,
  p_destino text,
  p_pallets bigint[],
  p_nota    text,
  p_user    text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_pid bigint; v_ok boolean; v_malos text := '';
begin
  if not (public.has_module('solicitante') or public.has_module('importacion')) then
    raise exception 'Sin permiso para solicitar mercadería';
  end if;
  if p_pallets is null or array_length(p_pallets,1) is null then
    return jsonb_build_object('ok',false,'error','No elegiste ningún pallet');
  end if;
  if p_origen = p_destino then
    return jsonb_build_object('ok',false,'error','El origen y el destino son el mismo depósito');
  end if;

  insert into public.imp_solicitudes(solicitante,origen,destino,nota)
    values (p_user, p_origen, p_destino, nullif(trim(coalesce(p_nota,'')),''))
    returning id into v_id;

  foreach v_pid in array p_pallets loop
    select exists(select 1 from public.imp_pallets_disponibles d
                   where d.id = v_pid and d.deposito = p_origen) into v_ok;
    if v_ok then
      insert into public.imp_solicitud_items(solicitud_id,pallet_id) values (v_id, v_pid);
    else
      -- No se corta todo por uno: se informan los que se cayeron y la
      -- solicitud queda con el resto. Perder diez pallets bien pedidos
      -- porque alguien se llevó uno seria peor.
      v_malos := v_malos || coalesce((select codigo from public.imp_pallets where id=v_pid), v_pid::text) || ', ';
    end if;
  end loop;

  if not exists(select 1 from public.imp_solicitud_items where solicitud_id = v_id) then
    delete from public.imp_solicitudes where id = v_id;
    return jsonb_build_object('ok',false,
      'error','Ninguno de los pallets sigue disponible: alguien se los llevó mientras armabas el pedido');
  end if;

  return jsonb_build_object('ok',true,'solicitud',v_id,
    'items',(select count(*) from public.imp_solicitud_items where solicitud_id=v_id),
    'no_disponibles', nullif(rtrim(v_malos,', '),''));
end $$;

-- ── 6. El operario arranca el recorrido ──────────────────────
--  Acá se escribe imp_pallets.destino, que es lo que habilita el
--  escaneo de salida. Desde este punto el flujo viejo toma la posta.
create or replace function public.imp_solicitud_iniciar(p_sol bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_n int;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into s from public.imp_solicitudes where id = p_sol;
  if not found then return jsonb_build_object('ok',false,'error','Solicitud inexistente'); end if;
  if s.estado <> 'PENDIENTE' then
    return jsonb_build_object('ok',false,'error','La solicitud ya está '||s.estado);
  end if;

  update public.imp_pallets p
     set destino = s.destino
    from public.imp_solicitud_items i
   where i.solicitud_id = p_sol and i.estado = 'PEDIDO' and p.id = i.pallet_id;
  get diagnostics v_n = row_count;

  update public.imp_solicitudes
     set estado='EN_PREPARACION', operario=p_user, iniciada_at=now()
   where id = p_sol;

  return jsonb_build_object('ok',true,'solicitud',p_sol,'pallets',v_n,'destino',s.destino);
end $$;

-- ── 7. Cancelar: hay que soltar los pallets ──────────────────
--  Si no, quedan reservados y con destino puesto para siempre.
create or replace function public.imp_solicitud_cancelar(p_sol bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not (public.has_module('solicitante') or public.has_module('importacion')) then
    raise exception 'Sin permiso';
  end if;
  select * into s from public.imp_solicitudes where id = p_sol;
  if not found then return jsonb_build_object('ok',false,'error','Solicitud inexistente'); end if;
  if s.estado in ('ENTREGADA','CANCELADA') then
    return jsonb_build_object('ok',false,'error','La solicitud ya está '||s.estado);
  end if;
  if exists(select 1 from public.imp_solicitud_items i
             join public.imp_pallets p on p.id=i.pallet_id
            where i.solicitud_id=p_sol and p.estado='EN_TRANSITO') then
    return jsonb_build_object('ok',false,
      'error','Hay pallets ya despachados: no se puede cancelar, hay que recibirlos');
  end if;

  -- Sólo se limpia el destino de los que siguen quietos en su depósito
  update public.imp_pallets p set destino = null
    from public.imp_solicitud_items i
   where i.solicitud_id=p_sol and p.id=i.pallet_id and p.estado='ESTACIONADO';

  update public.imp_solicitud_items set estado='CANCELADO'
   where solicitud_id=p_sol and estado in ('PEDIDO','ENVIADO');
  update public.imp_solicitudes
     set estado='CANCELADA', cerrada_by=p_user, entregada_at=now()
   where id=p_sol;

  return jsonb_build_object('ok',true,'solicitud',p_sol);
end $$;

-- ── 8. Avance automático al escanear ─────────────────────────
--  El operario escanea pallets, no solicitudes: que tenga que
--  acordarse de marcar "ya salió" es pedirle que haga de contador.
--  El trigger mira el estado del pallet y mueve el item y la
--  solicitud solos.
create or replace function public.imp_sol_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sol bigint;
begin
  select solicitud_id into v_sol from public.imp_solicitud_items
   where pallet_id = new.id and estado in ('PEDIDO','ENVIADO') limit 1;
  if v_sol is null then return new; end if;

  if new.estado = 'EN_TRANSITO' then
    update public.imp_solicitud_items set estado='ENVIADO'
     where solicitud_id=v_sol and pallet_id=new.id and estado='PEDIDO';
    update public.imp_solicitudes set estado='EN_TRANSITO'
     where id=v_sol and estado in ('PENDIENTE','EN_PREPARACION');

  elsif new.estado in ('RECIBIDO','ESTACIONADO','CONSUMIDO')
        and old.estado = 'EN_TRANSITO' then
    update public.imp_solicitud_items set estado='ENTREGADO'
     where solicitud_id=v_sol and pallet_id=new.id;
    -- La solicitud se cierra sola cuando llegó el último
    if not exists(select 1 from public.imp_solicitud_items
                   where solicitud_id=v_sol and estado in ('PEDIDO','ENVIADO')) then
      update public.imp_solicitudes
         set estado='ENTREGADA', entregada_at=now()
       where id=v_sol and estado <> 'ENTREGADA';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_imp_sol_sync on public.imp_pallets;
create trigger trg_imp_sol_sync after update of estado on public.imp_pallets
  for each row when (old.estado is distinct from new.estado)
  execute function public.imp_sol_sync();

-- ── 9. RLS y realtime ────────────────────────────────────────
--  Leer: cualquier autenticado (el solicitante tiene que ver cómo va
--  su pedido). Escribir: sólo por los RPC de arriba, que son SECURITY
--  DEFINER y ya validan el permiso — por eso no se abre el write
--  directo a la tabla.
alter table public.imp_solicitudes enable row level security;
drop policy if exists p_imp_solicitudes_read on public.imp_solicitudes;
create policy p_imp_solicitudes_read on public.imp_solicitudes for select
  using (auth.role()='authenticated');

alter table public.imp_solicitud_items enable row level security;
drop policy if exists p_imp_solicitud_items_read on public.imp_solicitud_items;
create policy p_imp_solicitud_items_read on public.imp_solicitud_items for select
  using (auth.role()='authenticated');

do $$ begin
  execute 'alter publication supabase_realtime add table public.imp_solicitudes';
exception when duplicate_object then null; when others then null; end $$;
do $$ begin
  execute 'alter publication supabase_realtime add table public.imp_solicitud_items';
exception when duplicate_object then null; when others then null; end $$;

-- ── 10. Comprobación ─────────────────────────────────────────
-- select * from public.imp_pallets_disponibles order by deposito, ubicacion;
-- select * from public.imp_solicitud_resumen order by created_at desc;
--
--  Para habilitar a alguien como solicitante, desde usuarios.html o:
-- update public.profiles set modules = array_append(modules,'solicitante')
--  where email = 'quien@corresponda';
