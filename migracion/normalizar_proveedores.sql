-- Normalización de nombres de proveedores — generado automáticamente
begin;

-- Alliance Uruguay
update public.pedidos     set proveedor = 'Alliance Uruguay' where proveedor in ('ALLIANCE URUGUAY');
update public.precios      set proveedor = 'Alliance Uruguay' where proveedor in ('ALLIANCE URUGUAY');
update public.proveedores  set empresa   = 'Alliance Uruguay' where empresa   in ('ALLIANCE URUGUAY');

-- Dematte y Asociados SRL
update public.pedidos     set proveedor = 'Dematte y Asociados SRL' where proveedor in ('Dematte Y Asociados SRL');
update public.precios      set proveedor = 'Dematte y Asociados SRL' where proveedor in ('Dematte Y Asociados SRL');
update public.proveedores  set empresa   = 'Dematte y Asociados SRL' where empresa   in ('Dematte Y Asociados SRL');

-- Diamaler S.A.
update public.pedidos     set proveedor = 'Diamaler S.A.' where proveedor in ('Diamaler S.A', 'DIAMALER S.A.');
update public.precios      set proveedor = 'Diamaler S.A.' where proveedor in ('Diamaler S.A', 'DIAMALER S.A.');
update public.proveedores  set empresa   = 'Diamaler S.A.' where empresa   in ('Diamaler S.A', 'DIAMALER S.A.');

-- Emilio Benzo S.A.
update public.pedidos     set proveedor = 'Emilio Benzo S.A.' where proveedor in ('Emilio Benzo SA', 'Emilio Benzo S.A');
update public.precios      set proveedor = 'Emilio Benzo S.A.' where proveedor in ('Emilio Benzo SA', 'Emilio Benzo S.A');
update public.proveedores  set empresa   = 'Emilio Benzo S.A.' where empresa   in ('Emilio Benzo SA', 'Emilio Benzo S.A');

-- Enzur S.A.
update public.pedidos     set proveedor = 'Enzur S.A.' where proveedor in ('Enzur SA', 'Enzur S.A', 'ENZUR S.A.', 'ENZUR');
update public.precios      set proveedor = 'Enzur S.A.' where proveedor in ('Enzur SA', 'Enzur S.A', 'ENZUR S.A.', 'ENZUR');
update public.proveedores  set empresa   = 'Enzur S.A.' where empresa   in ('Enzur SA', 'Enzur S.A', 'ENZUR S.A.', 'ENZUR');

-- Eresur
update public.pedidos     set proveedor = 'Eresur' where proveedor in ('ERESUR');
update public.precios      set proveedor = 'Eresur' where proveedor in ('ERESUR');
update public.proveedores  set empresa   = 'Eresur' where empresa   in ('ERESUR');

-- Flax Uruguay SRL
update public.pedidos     set proveedor = 'Flax Uruguay SRL' where proveedor in ('FLAX URUGUAY');
update public.precios      set proveedor = 'Flax Uruguay SRL' where proveedor in ('FLAX URUGUAY');
update public.proveedores  set empresa   = 'Flax Uruguay SRL' where empresa   in ('FLAX URUGUAY');

-- Fradec LTDA
update public.pedidos     set proveedor = 'Fradec LTDA' where proveedor in ('FRADEC LTDA', 'FRADEC');
update public.precios      set proveedor = 'Fradec LTDA' where proveedor in ('FRADEC LTDA', 'FRADEC');
update public.proveedores  set empresa   = 'Fradec LTDA' where empresa   in ('FRADEC LTDA', 'FRADEC');

-- Green Oil S.A.
update public.pedidos     set proveedor = 'Green Oil S.A.' where proveedor in ('Green Oil SA', 'Green Oil S.A', 'GREEN OIL');
update public.precios      set proveedor = 'Green Oil S.A.' where proveedor in ('Green Oil SA', 'Green Oil S.A', 'GREEN OIL');
update public.proveedores  set empresa   = 'Green Oil S.A.' where empresa   in ('Green Oil SA', 'Green Oil S.A', 'GREEN OIL');

-- Impofra S.A.S
update public.pedidos     set proveedor = 'Impofra S.A.S' where proveedor in ('Impofra SAS');
update public.precios      set proveedor = 'Impofra S.A.S' where proveedor in ('Impofra SAS');
update public.proveedores  set empresa   = 'Impofra S.A.S' where empresa   in ('Impofra SAS');

-- Irmari LTDA
update public.pedidos     set proveedor = 'Irmari LTDA' where proveedor in ('Irmari Ltda', 'IRMARI LTDA', 'IRMARI S.A.', 'IRMARI');
update public.precios      set proveedor = 'Irmari LTDA' where proveedor in ('Irmari Ltda', 'IRMARI LTDA', 'IRMARI S.A.', 'IRMARI');
update public.proveedores  set empresa   = 'Irmari LTDA' where empresa   in ('Irmari Ltda', 'IRMARI LTDA', 'IRMARI S.A.', 'IRMARI');

-- Lariales S.A.
update public.pedidos     set proveedor = 'Lariales S.A.' where proveedor in ('Lariales S.A', 'LARIALES S.A.', 'LARIALES');
update public.precios      set proveedor = 'Lariales S.A.' where proveedor in ('Lariales S.A', 'LARIALES S.A.', 'LARIALES');
update public.proveedores  set empresa   = 'Lariales S.A.' where empresa   in ('Lariales S.A', 'LARIALES S.A.', 'LARIALES');

-- Liderquim S.A.S
update public.pedidos     set proveedor = 'Liderquim S.A.S' where proveedor in ('LIDERQUIM S.A.');
update public.precios      set proveedor = 'Liderquim S.A.S' where proveedor in ('LIDERQUIM S.A.');
update public.proveedores  set empresa   = 'Liderquim S.A.S' where empresa   in ('LIDERQUIM S.A.');

-- Lipiner S.A.
update public.pedidos     set proveedor = 'Lipiner S.A.' where proveedor in ('Lipiner S.A', 'LIPINER');
update public.precios      set proveedor = 'Lipiner S.A.' where proveedor in ('Lipiner S.A', 'LIPINER');
update public.proveedores  set empresa   = 'Lipiner S.A.' where empresa   in ('Lipiner S.A', 'LIPINER');

-- Melinor S.A.
update public.pedidos     set proveedor = 'Melinor S.A.' where proveedor in ('Melinor S.A', 'MELINOR S.A.');
update public.precios      set proveedor = 'Melinor S.A.' where proveedor in ('Melinor S.A', 'MELINOR S.A.');
update public.proveedores  set empresa   = 'Melinor S.A.' where empresa   in ('Melinor S.A', 'MELINOR S.A.');

-- Midarma
update public.pedidos     set proveedor = 'Midarma' where proveedor in ('MIDARMA');
update public.precios      set proveedor = 'Midarma' where proveedor in ('MIDARMA');
update public.proveedores  set empresa   = 'Midarma' where empresa   in ('MIDARMA');

-- Nesta LTDA
update public.pedidos     set proveedor = 'Nesta LTDA' where proveedor in ('NESTA LTDA');
update public.precios      set proveedor = 'Nesta LTDA' where proveedor in ('NESTA LTDA');
update public.proveedores  set empresa   = 'Nesta LTDA' where empresa   in ('NESTA LTDA');

-- Nortesur S.A.
update public.pedidos     set proveedor = 'Nortesur S.A.' where proveedor in ('NORTESUR S.A.', 'NORTESUR');
update public.precios      set proveedor = 'Nortesur S.A.' where proveedor in ('NORTESUR S.A.', 'NORTESUR');
update public.proveedores  set empresa   = 'Nortesur S.A.' where empresa   in ('NORTESUR S.A.', 'NORTESUR');

-- Oziom S.A.S
update public.pedidos     set proveedor = 'Oziom S.A.S' where proveedor in ('Oziom Sas', 'OZIOM');
update public.precios      set proveedor = 'Oziom S.A.S' where proveedor in ('Oziom Sas', 'OZIOM');
update public.proveedores  set empresa   = 'Oziom S.A.S' where empresa   in ('Oziom Sas', 'OZIOM');

-- Perrin S.A.
update public.pedidos     set proveedor = 'Perrin S.A.' where proveedor in ('Perrin S.A', 'PERRIN S.A.', 'Perrin');
update public.precios      set proveedor = 'Perrin S.A.' where proveedor in ('Perrin S.A', 'PERRIN S.A.', 'Perrin');
update public.proveedores  set empresa   = 'Perrin S.A.' where empresa   in ('Perrin S.A', 'PERRIN S.A.', 'Perrin');

-- Polin S.A.
update public.pedidos     set proveedor = 'Polin S.A.' where proveedor in ('Polin S.A', 'POLIN');
update public.precios      set proveedor = 'Polin S.A.' where proveedor in ('Polin S.A', 'POLIN');
update public.proveedores  set empresa   = 'Polin S.A.' where empresa   in ('Polin S.A', 'POLIN');

-- Porto LTDA
update public.pedidos     set proveedor = 'Porto LTDA' where proveedor in ('PORTO LTDA');
update public.precios      set proveedor = 'Porto LTDA' where proveedor in ('PORTO LTDA');
update public.proveedores  set empresa   = 'Porto LTDA' where empresa   in ('PORTO LTDA');

-- Promak S.A.
update public.pedidos     set proveedor = 'Promak S.A.' where proveedor in ('PROMAK', 'Promak SA');
update public.precios      set proveedor = 'Promak S.A.' where proveedor in ('PROMAK', 'Promak SA');
update public.proveedores  set empresa   = 'Promak S.A.' where empresa   in ('PROMAK', 'Promak SA');

-- Quimica Oriental S.A.
update public.pedidos     set proveedor = 'Quimica Oriental S.A.' where proveedor in ('Química Oriental SA', 'Quimica Oriental S.A', 'QUIMICA ORIENTAL S.A.', 'QUIMICA ORIENTAL');
update public.precios      set proveedor = 'Quimica Oriental S.A.' where proveedor in ('Química Oriental SA', 'Quimica Oriental S.A', 'QUIMICA ORIENTAL S.A.', 'QUIMICA ORIENTAL');
update public.proveedores  set empresa   = 'Quimica Oriental S.A.' where empresa   in ('Química Oriental SA', 'Quimica Oriental S.A', 'QUIMICA ORIENTAL S.A.', 'QUIMICA ORIENTAL');

-- Quimica S.A.
update public.pedidos     set proveedor = 'Quimica S.A.' where proveedor in ('Química SA', 'Quimica S.A', 'Quimica SA', 'QUIMICA S.A.', 'QUIMICA SA');
update public.precios      set proveedor = 'Quimica S.A.' where proveedor in ('Química SA', 'Quimica S.A', 'Quimica SA', 'QUIMICA S.A.', 'QUIMICA SA');
update public.proveedores  set empresa   = 'Quimica S.A.' where empresa   in ('Química SA', 'Quimica S.A', 'Quimica SA', 'QUIMICA S.A.', 'QUIMICA SA');

-- Riverfilco S.A.
update public.pedidos     set proveedor = 'Riverfilco S.A.' where proveedor in ('Riverfilco S.A', 'Riverfilco SA', 'RIVERFILCO');
update public.precios      set proveedor = 'Riverfilco S.A.' where proveedor in ('Riverfilco S.A', 'Riverfilco SA', 'RIVERFILCO');
update public.proveedores  set empresa   = 'Riverfilco S.A.' where empresa   in ('Riverfilco S.A', 'Riverfilco SA', 'RIVERFILCO');

-- Roydel S.A.
update public.pedidos     set proveedor = 'Roydel S.A.' where proveedor in ('Roydel S.A', 'ROYDEL');
update public.precios      set proveedor = 'Roydel S.A.' where proveedor in ('Roydel S.A', 'ROYDEL');
update public.proveedores  set empresa   = 'Roydel S.A.' where empresa   in ('Roydel S.A', 'ROYDEL');

-- Solsire S.A.
update public.pedidos     set proveedor = 'Solsire S.A.' where proveedor in ('Solsire SA', 'Solsire S.A', 'SOLSIRE');
update public.precios      set proveedor = 'Solsire S.A.' where proveedor in ('Solsire SA', 'Solsire S.A', 'SOLSIRE');
update public.proveedores  set empresa   = 'Solsire S.A.' where empresa   in ('Solsire SA', 'Solsire S.A', 'SOLSIRE');

-- Vernol S.A.
update public.pedidos     set proveedor = 'Vernol S.A.' where proveedor in ('Vernol SA', 'Vernol S.A', 'VERNOL S.A.', 'VERNOL');
update public.precios      set proveedor = 'Vernol S.A.' where proveedor in ('Vernol SA', 'Vernol S.A', 'VERNOL S.A.', 'VERNOL');
update public.proveedores  set empresa   = 'Vernol S.A.' where empresa   in ('Vernol SA', 'Vernol S.A', 'VERNOL S.A.', 'VERNOL');

-- Viracross S.A.S
update public.pedidos     set proveedor = 'Viracross S.A.S' where proveedor in ('Viracross SAS', 'Viracross S.A.S.', 'VIRACROSS');
update public.precios      set proveedor = 'Viracross S.A.S' where proveedor in ('Viracross SAS', 'Viracross S.A.S.', 'VIRACROSS');
update public.proveedores  set empresa   = 'Viracross S.A.S' where empresa   in ('Viracross SAS', 'Viracross S.A.S.', 'VIRACROSS');

-- Fusionar filas de proveedores duplicadas (conserva la de menor id)
delete from public.proveedores a using public.proveedores b
  where a.empresa = b.empresa and a.id > b.id;

commit;
