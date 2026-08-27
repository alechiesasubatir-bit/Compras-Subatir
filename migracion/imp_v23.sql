-- ============================================================
--  TANDAS DE IMPORTACIÓN  ·  el FIFO que no depende de cuándo se armó
--
--  Hasta acá el orden FIFO salía de imp_pallets.created_at, que es
--  cuándo se ARMÓ el pallet. Eso alcanza mientras se palletice en el
--  mismo orden en que entra la mercadería, y justamente ahora no va a
--  pasar: las ~2.100 unidades que quedan sueltas son de la importación
--  VIEJA y se van a armar el día que llegue la NUEVA. Con created_at,
--  esos pallets nacerían el mismo día que los nuevos y el sistema los
--  trataría como igual de recientes.
--
--  La tanda arregla eso: la mercadería se etiqueta con la importación
--  de la que vino, no con el día en que alguien la puso arriba de un
--  pallet. El FIFO pasa a ordenar por la FECHA DE LA TANDA y recién
--  después por el armado.
--
--  Se crea una sola tanda, "Stock inicial", y se le asignan TODOS los
--  pallets que existen hoy. Las siguientes las da de alta el usuario
--  desde la pantalla (Pallets → Tandas), con su nombre y su color.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

-- ── 1. La tabla de tandas ───────────────────────────────────
create table if not exists public.imp_tandas (
  id         bigint generated always as identity primary key,
  nombre     text not null unique,
  -- Con qué color se pinta en las pantallas. Hex de 6 dígitos.
  color      text not null default '#1bc8ff',
  -- La fecha que MANDA para el FIFO: cuándo llegó esa importación.
  -- No es created_at de la fila: una tanda se puede dar de alta
  -- después de que la mercadería ya entró.
  fecha      date not null default current_date,
  activa     boolean not null default true,   -- las inactivas no se ofrecen al armar
  nota       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_imp_tandas_fecha on public.imp_tandas(fecha);

-- ── 2. El pallet pertenece a una tanda ──────────────────────
alter table public.imp_pallets add column if not exists tanda_id bigint;
do $$ begin
  alter table public.imp_pallets add constraint imp_pallets_tanda_fk
    foreign key (tanda_id) references public.imp_tandas(id) on delete set null;
exception when duplicate_object then null; when others then null; end $$;
create index if not exists idx_imp_pallets_tanda on public.imp_pallets(tanda_id);

-- ── 3. Todo lo que existe hoy es "Stock inicial" ────────────
--  La fecha se toma del pallet más viejo que haya, así el FIFO la
--  ubica antes que cualquier importación que se dé de alta después.
insert into public.imp_tandas (nombre, color, fecha, nota)
select 'Stock inicial', '#a78bfa',
       coalesce((select min(created_at)::date from public.imp_pallets), current_date),
       'Lo que ya estaba en el depósito cuando se empezó a marcar la tanda de cada pallet.'
where not exists (select 1 from public.imp_tandas where nombre = 'Stock inicial');

update public.imp_pallets
   set tanda_id = (select id from public.imp_tandas where nombre = 'Stock inicial')
 where tanda_id is null;

-- ── 4. RLS: igual que el resto del módulo ───────────────────
alter table public.imp_tandas enable row level security;
drop policy if exists p_imp_tandas_read on public.imp_tandas;
create policy p_imp_tandas_read on public.imp_tandas
  for select using (auth.role() = 'authenticated');
drop policy if exists p_imp_tandas_write on public.imp_tandas;
create policy p_imp_tandas_write on public.imp_tandas
  for all using (public.has_module('importacion'))
  with check (public.has_module('importacion'));

-- ── 5. Armar un pallet ahora recibe la tanda ────────────────
--  Mismo cuerpo que en imp_v5.sql; sólo se agrega p_tanda al final
--  (con default, así una pantalla vieja que no lo mande sigue
--  funcionando y el pallet cae en la tanda activa más reciente).
create or replace function public.imp_pallet_armar(
  p_art       bigint,
  p_dep       text,
  p_cajas     numeric,
  p_un_x_caja numeric,
  p_remanente numeric,
  p_unidades  numeric,
  p_est       bigint,
  p_fila      int,
  p_col       int,
  p_user      text,
  p_tanda     bigint default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_disp numeric; v_dep text; v_codigo text; v_id bigint; v_tanda bigint;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  if coalesce(p_unidades,0) <= 0 then
    return jsonb_build_object('ok',false,'error','El pallet tiene que llevar al menos una unidad');
  end if;

  -- La ranura manda sobre el depósito: si se eligió una, el pallet
  -- queda en el depósito de esa estantería.
  if p_est is not null then
    select deposito into v_dep from public.imp_estanterias where id = p_est;
    if v_dep is null then
      return jsonb_build_object('ok',false,'error','Estantería inválida');
    end if;
    if exists(select 1 from public.imp_pallets
               where estanteria_id = p_est and fila = p_fila and columna = p_col) then
      return jsonb_build_object('ok',false,'error','Esa ranura ya está ocupada');
    end if;
  else
    v_dep := p_dep;
    if v_dep is null then
      return jsonb_build_object('ok',false,'error','Elegí el depósito');
    end if;
  end if;

  if public.imp_dep_tipo(v_dep) = 'FABRICA' then
    return jsonb_build_object('ok',false,'error',
      v_dep||' es depósito de fábrica: la mercadería se consume, no se arma en pallets');
  end if;

  -- El corazón del cambio: no se puede palletizar lo que no hay suelto
  v_disp := public.imp_disponible(p_art, v_dep);
  if p_unidades > v_disp then
    return jsonb_build_object('ok',false,'error',
      'No alcanza lo disponible en '||v_dep||': hay '||public.imp_num_txt(v_disp)||
      ' u. sin palletizar y el pallet pide '||public.imp_num_txt(p_unidades)||' u.',
      'disponible',v_disp);
  end if;

  -- Tanda: la que se eligió; si no vino, la activa más reciente. Nunca
  -- queda en null teniendo alguna, porque un pallet sin tanda se cae
  -- del orden FIFO y no se nota hasta que sale mercadería equivocada.
  v_tanda := p_tanda;
  if v_tanda is not null and not exists(select 1 from public.imp_tandas where id = v_tanda) then
    return jsonb_build_object('ok',false,'error','La tanda elegida no existe');
  end if;
  if v_tanda is null then
    select id into v_tanda from public.imp_tandas
     where activa order by fecha desc, id desc limit 1;
  end if;

  v_codigo := 'PLT-'||public.imp_base36(floor(extract(epoch from clock_timestamp())*1000)::bigint)
              ||'-'||upper(substr(md5(random()::text),1,4));

  insert into public.imp_pallets(codigo,articulo_id,cajas,un_x_caja,remanente,unidades,
                                 estado,deposito,origen,estanteria_id,fila,columna,created_by,
                                 tanda_id)
    values (v_codigo,p_art,nullif(p_cajas,0),p_un_x_caja,coalesce(p_remanente,0),p_unidades,
            'ABIERTO',v_dep,v_dep,p_est,p_fila,p_col,p_user,
            v_tanda)
    returning id into v_id;

  return jsonb_build_object('ok',true,'id',v_id,'codigo',v_codigo,'deposito',v_dep,
                            'tanda_id',v_tanda,
                            'disponible',public.imp_disponible(p_art,v_dep));
end $$;

-- ── 6. La vista de disponibles lleva la tanda ───────────────
--  tanda_fecha es la que ordena; nombre y color son para pintar.
create or replace view public.imp_pallets_disponibles
with (security_invoker = true) as
select p.id, p.codigo, p.deposito, p.articulo_id,
       a.descripcion as articulo, a.codigo as art_codigo, a.tipo,
       p.unidades, p.cajas, p.estado,
       p.estanteria_id, e.nombre as estanteria, e.subdeposito_id,
       s.nombre as subdeposito,
       p.fila, p.columna,
       public.imp_ubic_txt2(p.estanteria_id, p.fila, p.columna, p.zona_id) as ubicacion,
       p.created_at,
       greatest(0, (current_date - p.created_at::date))::int as dias,
       p.tanda_id,
       t.nombre as tanda,
       t.color  as tanda_color,
       t.fecha  as tanda_fecha
  from public.imp_pallets p
  left join public.imp_articulos a on a.id = p.articulo_id
  left join public.imp_estanterias e on e.id = p.estanteria_id
  left join public.imp_subdepositos s on s.id = e.subdeposito_id
  left join public.imp_tandas t on t.id = p.tanda_id
 where p.estado = 'ESTACIONADO'
   and p.destino is null
   and not exists (
     select 1 from public.imp_solicitud_items i
      where i.pallet_id = p.id and i.estado in ('PEDIDO','ENVIADO')
   );

-- ── Controles ───────────────────────────────────────────────
-- 1) Tiene que haber UNA tanda y ningún pallet sin ella.
select (select count(*) from public.imp_tandas)                      as tandas,
       (select count(*) from public.imp_pallets)                     as pallets,
       (select count(*) from public.imp_pallets where tanda_id is null) as pallets_sin_tanda;

-- 2) Los disponibles, en el orden en que van a salir.
select tanda, tanda_fecha, codigo, articulo, dias, ubicacion
  from public.imp_pallets_disponibles
 order by tanda_fecha asc, created_at asc
 limit 20;
