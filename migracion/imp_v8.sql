-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v8
--
--  Reabrir un pallet armado que todavía no se ubicó.
--
--  Un pallet cerrado no se podía tocar: el conteo quedaba
--  congelado para siempre. Está bien para uno estacionado en su
--  ranura o ya despachado, pero no para el que se acaba de armar
--  y sigue en la bandeja "Sin ubicar" — ahí un error de conteo no
--  tenía arreglo más que borrarlo por SQL.
--
--  Se reabre en vez de editar en caliente porque el QR impreso
--  lleva las cantidades: cambiar los números dejando el pallet
--  cerrado deja la etiqueta pegada mintiendo. Volver a ABIERTO
--  obliga a cerrarlo de nuevo y reimprimir.
--
--  No toca stock: desde v5 ni armar ni cerrar suman nada.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v7.sql
--  Es idempotente.
-- ============================================================

create or replace function public.imp_pallet_reabrir(p_pallet bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then return jsonb_build_object('ok',false,'error','Pallet inexistente'); end if;

  if p.estado = 'ABIERTO' then
    return jsonb_build_object('ok',false,'error','El pallet ya está abierto');
  end if;
  if p.estado <> 'ESTACIONADO' then
    return jsonb_build_object('ok',false,
      'error','Sólo se puede reabrir un pallet armado y quieto: éste está '||p.estado,
      'estado',p.estado);
  end if;
  -- Con ranura ya es parte del rack: para editarlo hay que sacarlo antes,
  -- así el movimiento queda asentado y el mapa no miente.
  if p.estanteria_id is not null then
    return jsonb_build_object('ok',false,
      'error','El pallet está en una ranura: quitalo de ahí antes de reabrirlo');
  end if;
  -- Marcado para despacho: alguien lo está esperando del otro lado.
  if p.destino is not null then
    return jsonb_build_object('ok',false,
      'error','El pallet está marcado para despacho a '||p.destino||': desmarcalo antes de reabrirlo');
  end if;

  update public.imp_pallets
     set estado     = 'ABIERTO',
         cerrado_at = null,
         cerrado_by = null
   where id = p.id;

  insert into public.imp_movimientos(pallet_id,articulo_id,tipo,deposito,unidades,usuario,nota)
    values (p.id,p.articulo_id,'REAPERTURA',p.deposito,p.unidades,p_user,
            'Reabierto para corregir el conteo');

  return jsonb_build_object('ok',true,'codigo',p.codigo,'deposito',p.deposito);
end $$;

-- ── Desmarcar un despacho ────────────────────────────────────
--    Hacía falta para poder reabrir uno ya marcado, y de paso
--    arregla que marcar un destino por error no tuviera vuelta.
create or replace function public.imp_pallet_desmarcar(p_pallet bigint, p_user text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.has_module('importacion') then raise exception 'Sin permiso'; end if;
  select * into p from public.imp_pallets where id = p_pallet;
  if not found then return jsonb_build_object('ok',false,'error','Pallet inexistente'); end if;
  if p.estado <> 'ESTACIONADO' then
    return jsonb_build_object('ok',false,
      'error','Sólo se puede desmarcar un pallet que no salió todavía','estado',p.estado);
  end if;
  if p.destino is null then
    return jsonb_build_object('ok',false,'error','El pallet no estaba marcado para despacho');
  end if;

  update public.imp_pallets set destino = null where id = p.id;
  return jsonb_build_object('ok',true,'codigo',p.codigo);
end $$;

-- ── Comprobación ─────────────────────────────────────────────
-- select codigo, estado, estanteria_id, destino, cerrado_at
--   from public.imp_pallets where estado = 'ESTACIONADO' and estanteria_id is null;
