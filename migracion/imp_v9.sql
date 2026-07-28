-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v9
--
--  Tipo nuevo: "Venta Piscina" (amarillo).
--
--  Los 33 artículos de Intex y los 36 de Enjoy son línea de
--  piscina y ninguno tenía tipo cargado, así que caían todos en el
--  gris de "Sin tipo": en el mapa y en el mini-mapa no se
--  distinguían de un artículo sin clasificar de verdad. Son los 69
--  sin tipo que había en la base; Subatir ya estaba completo.
--
--  Después de correr esto no debería quedar ningún artículo gris.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v8.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Ver qué se va a tocar (opcional, antes de aplicar) ────
-- select proveedor, tipo, count(*)
--   from public.imp_articulos
--  group by proveedor, tipo
--  order by proveedor, tipo;

-- ── 2. Marcar los de Intex y Enjoy ───────────────────────────
--    Sólo los que no tienen tipo: si alguno ya fue clasificado a
--    mano, se respeta. Por eso se puede volver a correr sin pisar
--    nada.
update public.imp_articulos
   set tipo = 'Venta Piscina',
       updated_at = now()
 where proveedor in ('Intex','Enjoy')
   and tipo is null;

-- ── 3. Comprobación ──────────────────────────────────────────
-- Intex y Enjoy tienen que quedar enteros en 'Venta Piscina', y
-- (sin tipo) no debería aparecer en ninguna fila:
-- select proveedor, coalesce(tipo,'(sin tipo)') as tipo, count(*)
--   from public.imp_articulos
--  group by proveedor, tipo
--  order by proveedor, tipo;

-- ── Nota sobre los tipos ─────────────────────────────────────
--    imp_articulos.tipo es texto libre, sin constraint. Los que
--    la app conoce y colorea están en la constante TIPOS de
--    deposito/index.html: Consumo, Venta, Venta Piscina e
--    Infraestructura. Un tipo escrito directo en la base que no
--    esté en esa lista se va a ver gris, como si no tuviera.
