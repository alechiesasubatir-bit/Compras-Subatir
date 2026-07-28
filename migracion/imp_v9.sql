-- ============================================================
--  CONTROL DE STOCK DEPÓSITOS — v9
--
--  Tipo nuevo: "Venta Piscina" (amarillo).
--
--  Los 33 artículos de Intex son línea de piscina y no tenían tipo
--  cargado, así que caían todos en el gris de "Sin tipo": en el
--  mapa y en el mini-mapa no se distinguían de un artículo sin
--  clasificar de verdad.
--
--  OJO: los 36 de Enjoy TAMBIÉN están sin tipo. No se tocan acá
--  porque no se definió qué son. Después de correr esto, los que
--  queden en gris son exactamente esos.
--
--  Correr UNA vez en Supabase → SQL Editor, DESPUÉS de imp_v8.sql
--  Es idempotente.
-- ============================================================

-- ── 1. Ver qué se va a tocar (opcional, antes de aplicar) ────
-- select proveedor, tipo, count(*)
--   from public.imp_articulos
--  group by proveedor, tipo
--  order by proveedor, tipo;

-- ── 2. Marcar los de Intex ───────────────────────────────────
--    Sólo los que no tienen tipo: si alguno ya fue clasificado a
--    mano, se respeta. Por eso se puede volver a correr sin pisar
--    nada.
update public.imp_articulos
   set tipo = 'Venta Piscina',
       updated_at = now()
 where proveedor = 'Intex'
   and tipo is null;

-- ── 3. Comprobación ──────────────────────────────────────────
-- Intex tiene que quedar entero en 'Venta Piscina', y los únicos
-- sin tipo deberían ser los de Enjoy:
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
