-- ============================================================
--  Pedidos de infraestructura #36 y #48: quién pidió y motivo
--
--  Completa lo que faltaba después de imp_infra_destino_36_48.sql:
--    #36 → pidió Diego Rivero · motivo Reforma Minas
--    #48 → motivo Local Nuevo (quien pidió, Guillermo, ya estaba)
--
--  También se rehace la nota de las salidas de Furriol, para que el
--  movimiento se entienda solo, sin abrir el pedido.
--  Idempotente: correrlo dos veces deja lo mismo.
--  Correr en Supabase → SQL Editor.
-- ============================================================

update public.imp_solicitudes set responsable = 'Diego Rivero', motivo = 'Reforma Minas'
 where id = 36 and sucursal = 'Minas';
update public.imp_solicitudes set motivo = 'Local Nuevo'
 where id = 48 and sucursal = 'Centro';

update public.imp_movimientos m
   set nota = 'Infraestructura · pedido #'||s.id||' · sin pallet · a sucursal '||s.sucursal
           || coalesce(' · pide '||s.responsable,'')
           || coalesce(' · motivo: '||s.motivo,'')
           || ' · destino corregido 06/10/2026 (antes Artigas)'
  from public.imp_solicitudes s
 where s.id in (36,48)
   and m.pallet_id is null and m.tipo = 'SALIDA' and m.deposito = 'Furriol'
   and m.nota like 'Infraestructura · pedido #'||s.id||' ·%';

-- ── Control ─────────────────────────────────────────────────
select id, sucursal, responsable, motivo from public.imp_solicitudes where id in (36,48) order by id;
-- Esperado: 36 Minas · Diego Rivero · Reforma Minas
--           48 Centro · Guillermo · Local Nuevo

select id, nota from public.imp_movimientos
 where nota like 'Infraestructura · pedido #36 ·%' or nota like 'Infraestructura · pedido #48 ·%'
 order by id;
-- Esperado: 5 salidas con «pide …» y «motivo: …»
