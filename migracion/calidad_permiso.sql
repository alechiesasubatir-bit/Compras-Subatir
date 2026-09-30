-- ============================================================
--  Calidad MP pasa a ser un permiso por usuario (30/09/2026)
--
--  Hasta ahora Calidad MP estaba abierto a cualquiera que entrara a
--  Compras. Desde esta versión se asigna en Usuarios como el resto.
--  Para que nadie pierda el acceso el día del cambio, se le agrega
--  'calidad' a quien hoy podía entrar: todo usuario (no admin) con algún
--  módulo de Compras. Los que sólo tienen pantallas del depósito
--  (solicitante / recorrido) no entraban a Compras y quedan igual.
--  Después, desde Usuarios, se le saca a quien no corresponda.
--
--  CORRER ANTES de publicar la versión nueva (si se publica primero,
--  estos usuarios dejan de ver Calidad MP hasta que se corra).
--  Se puede correr más de una vez: no duplica.
--
--  Supabase -> SQL Editor. Es un UPDATE directo, no depende de auth.uid().
-- ============================================================

update public.profiles
   set modules = array_append(modules, 'calidad')
 where role <> 'admin'
   and not ('calidad' = any(modules))
   and exists (select 1 from unnest(modules) m
                where m not in ('solicitante', 'recorrido'));

-- Verificación: quién quedó con el permiso
select email, role, modules
  from public.profiles
 where 'calidad' = any(modules) or role = 'admin'
 order by role, email;
