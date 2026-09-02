-- ============================================================
--  Limpiar la auditoria de correccion de proveedor cuando el
--  proveedor "anterior" ya no existe en el maestro.
--
--  Caso concreto (02/09/2026): el articulo 84 (Etiq. Medianas corto)
--  guardaba prov_auto_anterior = 'MIL ROLLOS' de cuando el modulo de
--  reposicion corrigio su proveedor segun la OC 905. Despues unificamos
--  MIL ROLLOS con Lipiner S.A. y borramos esa ficha del maestro, asi que
--  el cartel quedo ofreciendo "Volver a MIL ROLLOS": un boton que le
--  devolveria al articulo un proveedor que ya no existe.
--
--  No es un bug del modulo: guardo bien lo que habia antes. Es que la
--  unificacion posterior dejo ese dato sin sentido.
--
--  Se limpian los tres campos de auditoria y NO se toca `proveedor`:
--  el valor bueno (Lipiner S.A.) se queda. prov_auto_off tampoco se
--  toca: si alguien habia desactivado la correccion a proposito, esa
--  decision se respeta.
--
--  No reabre la correccion automatica: la guarda contra el bucle es la
--  comparacion de proveedor (inventario.proveedor vs el de la ultima
--  OC), y despues de la unificacion los dos dicen 'Lipiner S.A.', asi
--  que no hay nada que corregir.
--
--  Generico e idempotente: limpia cualquier fila cuyo prov_auto_anterior
--  ya no figure en el maestro, no solo la 84.
--
--  Correr en Supabase -> SQL Editor.
-- ============================================================

begin;

update public.inventario i
   set prov_auto_at       = null,
       prov_auto_oc       = null,
       prov_auto_anterior = null
 where i.prov_auto_anterior is not null
   and not exists (
         select 1 from public.proveedores p
          where upper(btrim(p.empresa)) = upper(btrim(i.prov_auto_anterior))
       );

commit;

-- Verificacion ------------------------------------------------------
select 'carteles con proveedor inexistente (debe ser 0)' as que,
       count(*)::text as valor
  from public.inventario i
 where i.prov_auto_anterior is not null
   and not exists (select 1 from public.proveedores p
                    where upper(btrim(p.empresa)) = upper(btrim(i.prov_auto_anterior)))
union all
select 'articulo 84: proveedor (debe seguir en Lipiner S.A.)',
       coalesce(proveedor,'(VACIO - MAL)') from public.inventario where id = 84
union all
select 'articulo 84: seguimiento (debe seguir en true)',
       seguimiento::text from public.inventario where id = 84
union all
select 'articulo 84: cartel (debe estar vacio)',
       coalesce(prov_auto_anterior,'(vacio, OK)') from public.inventario where id = 84
union all
select 'fichas de reposicion del 84 (debe seguir 1, con demora 15)',
       count(*)::text || ' / demora ' || coalesce(max(demora_dias)::text,'-')
  from public.art_proveedor where inventario_id = 84;

-- Esperado:
--   carteles con proveedor inexistente   0
--   articulo 84: proveedor               Lipiner S.A.
--   articulo 84: seguimiento             true
--   articulo 84: cartel                  (vacio, OK)
--   fichas de reposicion del 84          1 / demora 15
