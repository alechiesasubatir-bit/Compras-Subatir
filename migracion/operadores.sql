-- ============================================================
--  QUIÉN OPERA · trazabilidad en cuentas compartidas
--
--  Hay cuentas que usa más de una persona (produccionsubatir,
--  operadorprueba, logistica.artigas). Todo lo que registran queda
--  a nombre de la cuenta, así que no se sabe quién lo hizo — hoy
--  los pallets consumidos en Artigas dicen literalmente
--  "Operario Deposito (Poner Nombre)".
--
--  A partir de acá, una cuenta puede marcarse como COMPARTIDA: al
--  entrar a la pantalla se pregunta quién está operando y ese
--  nombre es el que queda en el registro.
--
--    profiles.compartida  → ¿hay que preguntar quién opera?
--    profiles.operadores  → la lista para elegir, o [] para que
--                           se escriba el nombre a mano:
--        [{"nombre":"VALENTINA GONZALEZ","rol":"Encargada"}, ...]
--
--  Las dos se editan desde el módulo Usuarios.
--
--  Correr UNA vez en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Perfil: cuenta compartida y su lista de operadores ────
alter table public.profiles
  add column if not exists compartida boolean not null default false,
  add column if not exists operadores jsonb   not null default '[]'::jsonb;

comment on column public.profiles.compartida is 'La usan varias personas: preguntar quién opera al entrar';
comment on column public.profiles.operadores is '[{nombre,rol}] para elegir; [] = se escribe a mano';

-- ── 2. Quién pidió, además de con qué cuenta ─────────────────
--  `solicitante` se sigue guardando con la CUENTA: es la clave con
--  la que "Mis pedidos" arma la lista del turno. El nombre de la
--  persona va aparte, para no romper ese filtro.
alter table public.imp_solicitudes
  add column if not exists pedido_por text;

comment on column public.imp_solicitudes.pedido_por is 'Persona que hizo el pedido (en cuentas compartidas)';

-- ── 3. La vista del resumen expone el campo nuevo ────────────
--  Es `select s.*`, así que al agregar una columna a la tabla se
--  corren todas las de atrás. `create or replace view` NO puede
--  renombrar columnas existentes, así que hay que dropearla:
--    ERROR 42P16: cannot change name of view column "items"
--  No tiene grants ni policies propias (usa security_invoker y la
--  RLS de imp_solicitudes), pero igual se re-otorgan abajo.
drop view if exists public.imp_solicitud_resumen;

create or replace view public.imp_solicitud_resumen
with (security_invoker = true) as
select s.*,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as items,
       (select count(*) from public.imp_solicitud_items i
         where i.solicitud_id = s.id and i.estado = 'ENTREGADO') as entregados,
       (select coalesce(sum(p.unidades),0) from public.imp_solicitud_items i
         join public.imp_pallets p on p.id = i.pallet_id
        where i.solicitud_id = s.id and i.estado <> 'CANCELADO') as unidades,
       (select coalesce(jsonb_agg(to_jsonb(x) order by x.un desc), '[]'::jsonb)
          from (
            select coalesce(a.descripcion, '(sin artículo)') as art,
                   a.codigo                                  as cod,
                   sum(p.unidades)                           as un,
                   count(*)                                  as pal
              from public.imp_solicitud_items i
              join public.imp_pallets p        on p.id = i.pallet_id
              left join public.imp_articulos a on a.id = p.articulo_id
             where i.solicitud_id = s.id and i.estado <> 'CANCELADO'
             group by a.descripcion, a.codigo
          ) x
       ) as articulos
  from public.imp_solicitudes s;

grant select on public.imp_solicitud_resumen to authenticated;

-- ── 4. Crear solicitud: ahora recibe quién la pidió ──────────
--  Se DROPEA antes de recrear: agregar un parámetro genera una
--  sobrecarga, y PostgREST llama por nombre — con dos versiones
--  vivas la llamada queda ambigua y falla.
drop function if exists public.imp_solicitud_crear(text, text, bigint[], text, text);

create or replace function public.imp_solicitud_crear(
  p_origen   text,
  p_destino  text,
  p_pallets  bigint[],
  p_nota     text,
  p_user     text,
  p_operador text default null
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

  insert into public.imp_solicitudes(solicitante,origen,destino,nota,pedido_por)
    values (p_user, p_origen, p_destino, nullif(trim(coalesce(p_nota,'')),''),
            nullif(trim(coalesce(p_operador,'')),''))
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

-- ── 5. Marcar las cuentas compartidas de hoy ─────────────────
--  Producción elige de una lista; las otras dos escriben el nombre
--  hasta que se arme su lista. Todo esto se edita en Usuarios.
update public.profiles
   set compartida = true,
       operadores = '[{"nombre":"VALENTINA GONZALEZ","rol":"Encargada"},
                      {"nombre":"ESTEFANIE VIERA","rol":"Encargada"},
                      {"nombre":"NOELIA BENTANCUR","rol":"Fabricante"},
                      {"nombre":"NOELIA EROZA","rol":"Fabricante"}]'::jsonb
 where email = 'produccionsubatir@gmail.com';

update public.profiles
   set compartida = true,
       operadores = '[]'::jsonb
 where email in ('operadorprueba@gmail.com', 'logistica.artigas@gmail.com');

-- ── 6. Comprobar cómo quedó ──────────────────────────────────
select email, full_name, compartida,
       jsonb_array_length(operadores) as cant_operadores,
       operadores
  from public.profiles
 where compartida
 order by email;
