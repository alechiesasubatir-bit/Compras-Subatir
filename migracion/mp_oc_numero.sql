-- ============================================================
--  MP IMPORTACIÓN · número de Orden de Compra por corrida
--
--  Hasta ahora una corrida cerrada era "el pedido que ya se hizo",
--  pero no tenía número: el papel que se le manda al proveedor sí lo
--  necesita, y tiene que ser SIEMPRE EL MISMO. Si el número se
--  calculara al vuelo cada vez que se aprieta "Generar OC", el mismo
--  pedido podría salir dos veces con números distintos —y del otro
--  lado quedarían dos órdenes donde hay una.
--
--  Por eso se guarda acá, la primera vez que se emite, y después se
--  reusa. Formato: OC-<PROVEEDOR>-NNN  (ej. OC-MEROAR-001).
--
--  El índice único es el que evita el choque de dos personas
--  emitiendo a la vez: la segunda falla en vez de duplicar el número.
--  Es parcial (where not null) porque las corridas que todavía no se
--  emitieron tienen oc_numero en null y son muchas.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

alter table public.mp_corridas
  add column if not exists oc_numero text;

create unique index if not exists ux_mp_corridas_oc_numero
  on public.mp_corridas (proveedor_id, oc_numero)
  where oc_numero is not null;

-- ── Control ─────────────────────────────────────────────────
-- Tiene que devolver una fila con la columna ya creada y, por ahora,
-- todas las corridas sin número.
select count(*)                          as corridas,
       count(oc_numero)                  as con_numero,
       count(*) - count(oc_numero)       as sin_numero
  from public.mp_corridas;
