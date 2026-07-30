-- ============================================================================
--  ROLLBACK de normalizar_inventario_prov.sql
--  Restaura por id exacto los 139 valores originales de public.inventario
--  tal como estaban antes de la normalización del 2026-07-29.
--
--  Es un rollback por id (no por valor) porque el mapeo es de muchos a uno:
--  "NORTESUR" y "Norte Sur" terminaron ambos en "Nortesur S.A.", así que a
--  partir del valor nuevo no se puede deducir cuál era el viejo.
--
--  OJO: si alguien editó estos artículos después de normalizar, esto le pisa
--  el cambio. Revisá antes de correrlo.
--
--  Sin begin/commit a propósito: el editor SQL de Supabase confirma cada
--  sentencia por separado, así que envolverlas daría una atomicidad falsa.
--  Cada UPDATE es independiente e idempotente — si se corta a mitad de camino,
--  volver a correr el archivo completo termina el trabajo.
-- ============================================================================

-- ── columna proveedor ──────────────────────────────────────────────────────
update public.inventario set proveedor='CARRETO'          where id in (15,19,21,22,117,119);
update public.inventario set proveedor='DAXILAN (GUCA)'   where id in (89);
update public.inventario set proveedor='ENZUR'            where id in (3,9,14,44,60,62,74,94,99,112,114,115,127);
update public.inventario set proveedor='ERESUR'           where id in (75,78,79,80,81);
update public.inventario set proveedor='FLAX'             where id in (122);
update public.inventario set proveedor='GREEN OIL'        where id in (23,24,27,28,30,31,32,33,34,70,93,133);
update public.inventario set proveedor='IRMARI'           where id in (36,103,138,144);
update public.inventario set proveedor='IRMARI/MIDARMA'   where id in (72);
update public.inventario set proveedor='LARIALES'         where id in (51,54,55,57,146);
update public.inventario set proveedor='LIDERQUIM'        where id in (76);
update public.inventario set proveedor='MIDARMA'          where id in (25,26,29,91,143);
update public.inventario set proveedor='NORTESUR'         where id in (2,6,8,39,40,52,53,56,101,120,139);
update public.inventario set proveedor='OJEDA NICOLAS'    where id in (20,71,95,96,130,131,132,134,135,142);
update public.inventario set proveedor='PACK IMPORT.'     where id in (73,92,140);
update public.inventario set proveedor='PERRIN'           where id in (69);
update public.inventario set proveedor='POLIN'            where id in (18);
update public.inventario set proveedor='QUIMICA ORIENTAL' where id in (38,97);
update public.inventario set proveedor='QUIMICA SA'       where id in (42,58,100,128,145);
update public.inventario set proveedor='RIVERFILCO'       where id in (147);
update public.inventario set proveedor='ROYDEL'           where id in (77);
update public.inventario set proveedor='RYMEL'            where id in (16);
update public.inventario set proveedor='TORREVIEJA'       where id in (46,47,49,106,107,108,109,110,124,125);
update public.inventario set proveedor='VENTAS URUGUAY'   where id in (105);
update public.inventario set proveedor='VERNOL'           where id in (4,10,59,126,129);
update public.inventario set proveedor='VIRACROSS'        where id in (7,50,104,111,113);
update public.inventario set proveedor='WILLIAMS'         where id in (90);

-- ── columna proveedor_sugerido ─────────────────────────────────────────────
update public.inventario set proveedor_sugerido='ENZUR'            where id in (3,60,94,114,115,127);
update public.inventario set proveedor_sugerido='IMPOFRA'          where id in (131,135);
update public.inventario set proveedor_sugerido='LARIALES'         where id in (146);
update public.inventario set proveedor_sugerido='MIDARMA'          where id in (72);
update public.inventario set proveedor_sugerido='Moizo'            where id in (102);
update public.inventario set proveedor_sugerido='NORTESUR'         where id in (40);
update public.inventario set proveedor_sugerido='Norte Sur'        where id in (8,52,53);
update public.inventario set proveedor_sugerido='POLIN'            where id in (18);
update public.inventario set proveedor_sugerido='QUIMICA ORIENTAL' where id in (42);
update public.inventario set proveedor_sugerido='QUIMICA SA'       where id in (58,100,145);
update public.inventario set proveedor_sugerido='SOLSIRE'          where id in (48,124,125);
update public.inventario set proveedor_sugerido='VERNOL'           where id in (4,59);
update public.inventario set proveedor_sugerido='VIRACROSS'        where id in (104,113);
