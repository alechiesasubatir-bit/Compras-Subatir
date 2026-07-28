-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v5
--
--  Cambia de raíz por dónde entra el stock.
--
--  ANTES: la única puerta de entrada era cerrar un pallet.
--         Todo lo que llegaba tenía que palletizarse para existir.
--  AHORA: la mercadería que llega se ingresa como cantidad suelta,
--         y los pallets se arman DESPUÉS con lo que hay suelto.
--         Armar y cerrar un pallet ya no suma stock: sólo reserva
--         y etiqueta lo que ya estaba en el depósito.
--
--  Sin este cambio, agregar el ingreso contaría todo dos veces.
--
--  Los datos existentes NO se rompen ni hay que migrarlos: cada
--  pallet cerrado sumó una sola vez, así que el stock de hoy ya
--  cumple  stock = suelto + palletizado.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v4.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Cuánto hay suelto, sin palletizar ─────────────────────
--    Los pallets ABIERTO y ESTACIONADO de un depósito guardan
--    unidades que YA están contadas dentro de imp_stock: son una
--    porción del stock, no algo aparte. Lo disponible para armar
--    un pallet nuevo es lo que queda fuera de ellos.
--    (EN_TRANSITO no cuenta: al salir se restó del origen y el
--     pallet quedó sin depósito. CONSUMIDO tampoco: neto cero.)
create or replace function public.imp_disponible(p_art bigint, p_dep text)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select cantidad from public.imp_stock
                    where articulo_id = p_art and deposito = p_dep), 0)
       - coalesce((select sum(unidades) from public.imp_pallets
                    where articulo_id = p_art and deposito = p_dep
                      and estado in ('ABIERTO','ESTACIONADO')), 0);
$$;

-- ── 1b. Utilidades ───────────────────────────────────────────
--    La referencia del ingreso (remito, proveedor) es una nota, no
--    una ubicación: metida en ubicacion_a la bitácora la mostraba
--    como si el pallet hubiera estado en un lugar con ese nombre.
alter table public.imp_movimientos add column if not exists nota text;

--    Números legibles en los mensajes: to_char con FM deja el
--    separador colgando en los enteros ("hay 500. u.").
create or replace function public.imp_num_txt(n numeric)
returns text language sql immutable as $$
  select rtrim(rtrim(to_char(coalesce(n,0),'FM999999999990.99'),'0'),'.');
$$;

--    Los códigos de pallet los venía generando el navegador en
--    base36. Al pasar el armado a la base hay que generarlos igual,
--    o conviven dos formatos de etiqueta.
create or replace function public.imp_base36(n bigint)
returns text language plpgsql immutable as $$
declare d constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        r text := ''; v bigint := n;
begin
  if v is null or v = 0 then return '0'; end if;
  while v > 0 loop
    r := substr(d, (v % 36)::int + 1, 1) || r;
    v := v / 36;
  end loop;
  return r;
end $$;

-- ── 2. Ingreso de mercadería: entra al stock sin pallet ──────
--    Es el acto de recibir lo que llegó al depósito y contarlo.
create or replace function public.imp_ingreso(
  p_art      bigint,
  p_dep      text,
  p_unidades numeric,
  p_user     text,
  p_nota     text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existe boolean;
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

  perform public.imp_stock_add(p_art, p_dep, p_unidades);
  insert into public.imp_movimientos(articulo_id,tipo,destino,deposito,unidades,usuario,nota)
    values (p_art,'INGRESO',p_dep,p_dep,p_unidades,p_user,nullif(trim(coalesce(p_nota,'')),''));

  return jsonb_build_object('ok',true,'deposito',p_dep,'unidades',p_unidades,
                            'disponible',public.imp_disponible(p_art,p_dep));
end $$;

-- ── 3. Armar un pallet ───────────────────────────────────────
--    Antes la app hacía un insert directo en imp_pallets, así que
--    no había dónde validar. Pasa a RPC para poder comprobar que
--    no se palletice más de lo que hay suelto y que la ranura esté
--    libre, todo en la misma transacción.
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
  p_user      text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_disp numeric; v_dep text; v_codigo text; v_id bigint;
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

  v_codigo := 'PLT-'||public.imp_base36(floor(extract(epoch from clock_timestamp())*1000)::bigint)
              ||'-'||upper(substr(md5(random()::text),1,4));

  insert into public.imp_pallets(codigo,articulo_id,cajas,un_x_caja,remanente,unidades,
                                 estado,deposito,origen,estanteria_id,fila,columna,created_by)
    values (v_codigo,p_art,nullif(p_cajas,0),p_un_x_caja,coalesce(p_remanente,0),p_unidades,
            'ABIERTO',v_dep,v_dep,p_est,p_fila,p_col,p_user)
    returning id into v_id;

  return jsonb_build_object('ok',true,'id',v_id,'codigo',v_codigo,'deposito',v_dep,
                            'disponible',public.imp_disponible(p_art,v_dep));
end $$;

-- ── 4. Contar: el ajuste tampoco puede pasarse del disponible ─
--    Lo que el pallet ya tenía reservado vuelve al disponible antes
--    de comparar, si no no se podría ni bajar el conteo.
create or replace function public.imp_pallet_contar(
  p_pallet    bigint,
  p_cajas     numeric,
  p_unidades  numeric,
  p_user      text,
  p_remanente numeric default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_disp numeric;
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

  v_disp := public.imp_disponible(p.articulo_id, p.deposito) + coalesce(p.unidades,0);
  if coalesce(p_unidades,0) > v_disp then
    return jsonb_build_object('ok',false,'error',
      'No alcanza lo disponible en '||p.deposito||': hay '||public.imp_num_txt(v_disp)||
      ' u. para este pallet','disponible',v_disp);
  end if;

  update public.imp_pallets
     set cajas     = p_cajas,
         unidades  = coalesce(p_unidades,0),
         remanente = coalesce(p_remanente,0)
   where id = p_pallet;

  return jsonb_build_object('ok',true);
end $$;

-- ── 5. Cerrar: ya NO suma stock ──────────────────────────────
--    El stock entró con el INGRESO. Cerrar sólo congela el conteo,
--    habilita el QR y deja el pallet listo para despachar.
--    El movimiento pasa de RECEPCION a ARMADO, que es lo que es.
create or replace function public.imp_pallet_cerrar(p_pallet bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then return jsonb_build_object('ok',false,'error','Pallet inexistente'); end if;
  if p.estado <> 'ABIERTO' then
    return jsonb_build_object('ok',false,'error','El pallet ya fue cerrado','estado',p.estado);
  end if;
  if coalesce(p.unidades,0) <= 0 then
    return jsonb_build_object('ok',false,'error','Contá las unidades antes de cerrar el pallet');
  end if;
  if p.deposito is null then
    return jsonb_build_object('ok',false,'error','El pallet no tiene depósito asignado');
  end if;
  if public.imp_dep_tipo(p.deposito) = 'FABRICA' then
    return jsonb_build_object('ok',false,'error',
      p.deposito||' es depósito de fábrica: la mercadería se consume, no se arma en pallets');
  end if;

  -- Sin imp_stock_add: la mercadería ya estaba en el depósito.
  update public.imp_pallets
     set estado='ESTACIONADO', cerrado_at=now(), cerrado_by=p_user
   where id=p.id;
  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,ubicacion_a)
    values (p.id,p.articulo_id,'ARMADO',p.deposito,p.unidades,p_user,
            public.imp_ubic_txt2(p.estanteria_id,p.fila,p.columna,p.zona_id));

  return jsonb_build_object('ok',true,'codigo',p.codigo,'unidades',p.unidades,'deposito',p.deposito);
end $$;

-- ── 6. Comprobaciones ────────────────────────────────────────
-- Disponible por artículo y depósito (no debería dar negativo):
-- select a.descripcion, s.deposito, s.cantidad as stock,
--        public.imp_disponible(s.articulo_id, s.deposito) as sin_palletizar
--   from public.imp_stock s join public.imp_articulos a on a.id = s.articulo_id
--  where s.cantidad > 0
--  order by sin_palletizar;
