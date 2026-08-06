-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v17
--
--  La recepción la tiene que hacer OTRA persona.
--
--  Hasta ahora el mismo operario podía escanear las dos puntas: la
--  salida en Furriol y la llegada en Artigas. Con eso, la llegada
--  no era una comprobación de nadie — era el mismo que despachó
--  diciendo que lo que despachó llegó.
--
--  A partir de acá, el segundo escaneo lo rechaza la base si lo
--  hace el mismo usuario que despachó. Tiene que confirmarlo
--  alguien del otro lado.
--
--  Se compara por USUARIO DE LA SESIÓN (auth.uid()), no por el
--  nombre que manda la pantalla: dos personas pueden llamarse
--  igual, un nombre se puede cambiar, y el texto que llega en
--  p_user lo elige el cliente. El uid no.
--
--  Para eso se guardan dos columnas nuevas, salida_uid y
--  llegada_uid, que además dejan la trazabilidad atada a la cuenta
--  y no sólo al nombre mostrado.
--
--  OJO — pallets que ya salieron: los que hoy están EN_TRANSITO no
--  tienen salida_uid (se despacharon antes de esto), así que la
--  regla no los alcanza y los recibe cualquiera. Es a propósito:
--  bloquearlos sería dejar mercadería trabada por un dato que no
--  existe. Aplica de los despachos nuevos en adelante.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v16.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Quién despachó y quién recibió, por cuenta ────────────
alter table public.imp_pallets add column if not exists salida_uid  uuid;
alter table public.imp_pallets add column if not exists llegada_uid uuid;

comment on column public.imp_pallets.salida_uid  is
  'Cuenta que escaneó la salida. La llegada la tiene que hacer otra (ver imp_pallet_scan).';
comment on column public.imp_pallets.llegada_uid is
  'Cuenta que escaneó la llegada.';

-- ── 2. El escaneo, con la regla adentro ──────────────────────
--    Va en la base y no en la pantalla a propósito: si estuviera en
--    el JavaScript, alcanzaría con abrir la consola para saltearla.
create or replace function public.imp_pallet_scan(p_codigo text, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_uid uuid := auth.uid(); v_quien text;
begin
  if not public.imp_puede_recorrido() then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where codigo = p_codigo;
  if not found then return jsonb_build_object('ok',false,'error','QR no encontrado'); end if;

  if p.estado = 'ABIERTO' then
    return jsonb_build_object('ok',false,
      'error','El pallet está abierto: cerralo antes de despacharlo','estado',p.estado);

  elsif p.estado = 'ESTACIONADO' then
    if p.destino is null then
      return jsonb_build_object('ok',false,
        'error','El pallet no tiene destino asignado (marcalo desde Transferir pallets)','estado',p.estado);
    end if;
    perform public.imp_stock_add(p.articulo_id, p.deposito, -p.unidades);
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario,ubicacion_de)
      values (p.id,p.articulo_id,'SALIDA',p.deposito,p.destino,p.deposito,p.unidades,p_user,
              public.imp_ubic_txt2(p.estanteria_id,p.fila,p.columna,p.zona_id));
    update public.imp_pallets
       set estado='EN_TRANSITO', origen=p.deposito, deposito=null,
           estanteria_id=null, fila=null, columna=null,
           salida_at=now(), salida_by=p_user, salida_uid=v_uid
     where id=p.id;
    return jsonb_build_object('ok',true,'estado','EN_TRANSITO','accion','salida','pallet',p.codigo,
                              'origen',p.deposito,'destino',p.destino,
                              'destino_tipo',public.imp_dep_tipo(p.destino));

  elsif p.estado = 'EN_TRANSITO' then
    -- LA REGLA: el que despachó no puede confirmar su propia entrega.
    if p.salida_uid is not null and v_uid is not null and p.salida_uid = v_uid then
      v_quien := coalesce(nullif(btrim(p.salida_by),''), 'vos mismo');
      return jsonb_build_object('ok',false,'estado',p.estado,'accion','bloqueada',
        'error','Este pallet lo despachaste vos ('||v_quien||'): la llegada la tiene que '||
                'confirmar otra persona en '||coalesce(p.destino,'destino')||'.');
    end if;

    -- Sin distinguir almacén de fábrica: en los dos casos la mercadería
    -- llega y queda sin ubicar, esperando que la guarden o la usen.
    perform public.imp_stock_add(p.articulo_id, p.destino, p.unidades);
    update public.imp_pallets set estado='RECIBIDO', deposito=p.destino,
           llegada_at=now(), llegada_by=p_user, llegada_uid=v_uid where id=p.id;
    insert into public.imp_movimientos(pallet_id,articulo_id,tipo,origen,destino,deposito,unidades,usuario)
      values (p.id,p.articulo_id,'ENTRADA',p.origen,p.destino,p.destino,p.unidades,p_user);
    return jsonb_build_object('ok',true,'estado','RECIBIDO','accion','entrada','pallet',p.codigo,
                              'destino',p.destino,
                              'destino_tipo',public.imp_dep_tipo(p.destino));

  elsif p.estado = 'CONSUMIDO' then
    return jsonb_build_object('ok',false,
      'error','Ese pallet ya se consumió en '||coalesce(p.deposito,'fábrica'),'estado',p.estado);
  else
    return jsonb_build_object('ok',false,'error','El pallet ya fue recibido','estado',p.estado);
  end if;
end $$;

-- ── 3. Para que la pantalla pueda avisar ANTES de escanear ───
--    Sin esto el operario camina hasta el pallet y se entera recién
--    frente al lector. La vista deja ver, de lo que está en camino,
--    qué despachó cada cuenta.
create or replace view public.imp_en_transito_quien as
  select p.id, p.codigo, p.articulo_id, p.unidades, p.origen, p.destino,
         p.salida_at, p.salida_by, p.salida_uid,
         (p.salida_uid is not null and p.salida_uid = auth.uid()) as lo_despache_yo
    from public.imp_pallets p
   where p.estado = 'EN_TRANSITO';

-- ── 4. Comprobación ──────────────────────────────────────────
select case when exists(
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='imp_pallet_scan'
            and pg_get_functiondef(p.oid) like '%lo despachaste vos%')
       then '✅ la regla está puesta' else '❌ no se aplicó' end as recepcion_por_otro,
       (select count(*) from public.imp_pallets
         where estado='EN_TRANSITO' and salida_uid is null) as en_transito_sin_uid_no_alcanzados;
