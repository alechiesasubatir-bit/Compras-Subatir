-- ============================================================
--  Calidad MP: quien tiene el permiso 'calidad' puede SUBIR
--  (07/10/2026, pedido del usuario: "Subir todo")
--
--  Antes subía sólo el administrador. Ahora cualquiera con el
--  módulo 'calidad' (por ejemplo fabricantes) puede cargar FT,
--  HDS, COA y otros documentos, también con la cámara.
--
--  Lo que NO cambia:
--    · Borrar o editar un documento a mano sigue siendo sólo admin
--      (las políticas de delete/update siguen con puede_doc_mp).
--
--  El caso especial: una FT u HDS nueva REEMPLAZA a la anterior
--  de esa MP y ese proveedor (la anterior se borra). Para que un
--  no-admin pueda hacerlo sin darle "borrar" en general, el borrado
--  pasa por mp_doc_reemplazar(), que sólo acepta borrar documentos
--  del MISMO tipo FT/HDS y de la MISMA MP que el nuevo, y más viejos
--  que él. El archivo del bucket lo puede borrar sólo cuando ya no
--  hay ninguna fila que lo use (o sea, después del reemplazo).
--
--  Idempotente. Correr en Supabase -> SQL Editor.
-- ============================================================

-- 1 . Quién puede SUBIR (has_module ya incluye al admin)
create or replace function public.puede_subir_doc_mp(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select t in ('FT','HDS','COA','OTRO') and public.has_module('calidad');
$$;

create or replace function public.puede_subir_archivo_mp(ruta text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.puede_subir_doc_mp(upper((storage.foldername(ruta))[1]));
$$;

drop policy if exists p_mp_doc_ins on public.mp_documentos;
create policy p_mp_doc_ins on public.mp_documentos
  for insert with check (public.puede_subir_doc_mp(tipo));

drop policy if exists p_calidad_mp_ins on storage.objects;
create policy p_calidad_mp_ins on storage.objects
  for insert with check (bucket_id = 'calidad-mp' and public.puede_subir_archivo_mp(name));

-- 2 . Archivos huérfanos: quien sube puede borrar un archivo del
--     bucket sólo si ninguna fila de mp_documentos lo usa. El admin
--     sigue pudiendo borrar cualquiera (política p_calidad_mp_del).
drop policy if exists p_calidad_mp_del_huerfano on storage.objects;
create policy p_calidad_mp_del_huerfano on storage.objects
  for delete using (
    bucket_id = 'calidad-mp'
    and public.puede_subir_archivo_mp(name)
    and not exists (select 1 from public.mp_documentos d where d.archivo = storage.objects.name)
  );

-- 3 . El reemplazo de FT/HDS. Recibe el documento nuevo y los ids
--     que la pantalla decidió reemplazar (el emparejamiento por
--     proveedor normalizado vive en CalidadMP.aReemplazar). Acá se
--     valida que cada uno sea reemplazable y se borran. Devuelve las
--     rutas de los archivos para que la pantalla los saque del bucket.
create or replace function public.mp_doc_reemplazar(p_nuevo bigint, p_viejos bigint[])
returns text[] language plpgsql security definer set search_path = public as $$
declare n record; v_arch text[];
begin
  select * into n from public.mp_documentos where id = p_nuevo;
  if not found then raise exception 'Documento nuevo inexistente'; end if;
  if n.tipo not in ('FT','HDS') then return '{}'; end if;
  if not public.puede_subir_doc_mp(n.tipo) then raise exception 'Sin permiso'; end if;

  with borrados as (
    delete from public.mp_documentos d
     where d.id = any(p_viejos)
       and d.id <> n.id
       and d.tipo = n.tipo
       and d.inventario_id  is not distinct from n.inventario_id
       and d.mp_articulo_id is not distinct from n.mp_articulo_id
       and d.created_at <= n.created_at
    returning d.archivo
  )
  select coalesce(array_agg(archivo), '{}') into v_arch from borrados;
  return v_arch;
end $$;

grant execute on function public.mp_doc_reemplazar(bigint, bigint[]) to authenticated;

-- 4 . Comprobar: quiénes van a poder subir (activos, con 'calidad' o admin)
select p.email, p.role, ('calidad' = any(p.modules)) as tiene_calidad
  from public.profiles p
 where p.activo and (p.role = 'admin' or 'calidad' = any(p.modules))
 order by p.role, p.email;
