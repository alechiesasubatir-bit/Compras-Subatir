-- ============================================================
--  MP IMPORTACIÓN  ·  previsión y control de compra de materia prima
--
--  Traducción de la planilla "Esencias Mero Ar" a la base, para poder
--  actualizarla seguido sin pelearse con celdas y para guardar el
--  historial de cada pedido en vez de pisarlo.
--
--  LO QUE SE INGRESA (3 columnas, igual que en la planilla):
--    consumo_3m     kg consumidos en los últimos 3 meses
--    stock_actual   kg en stock al momento de pedir
--    prom_anual     kg/mes promedio del año (consumo anual ÷ 12)
--  Y una cuarta que es la decisión humana:
--    compra_confirmada  lo que finalmente se pide, que puede diferir
--                       del cálculo (en la planilla difiere seguido)
--
--  TODO LO DEMÁS SE CALCULA, y se calcula en la pantalla —no acá—
--  para que se vea moverse al tocar un parámetro. Las fórmulas están
--  en mp-importacion.html y son las mismas de la planilla:
--
--    prom_3m     = consumo_3m / 3
--    ponderado   = 0,6 × prom_3m + 0,4 × prom_anual
--    proyectado  = ponderado × (1 + crecimiento)
--    necesidad   = proyectado × meses_cobertura
--    stock_seg   = proyectado × (semanas_seguridad / 4,333)
--    total_nec   = necesidad + stock_seg
--    a_pedir     = max(0, total_nec − stock_actual)
--    bultos      = techo(a_pedir / kg_bulto)
--    pedido      = bultos × kg_bulto
--
--  Verificado contra la planilla fila por fila (Acqua, Frasco 120ml,
--  Erba Pura) antes de escribir esto.
--
--  Correr en Supabase → SQL Editor.
-- ============================================================

-- ── 1. Proveedor ────────────────────────────────────────────
create table if not exists public.mp_proveedores (
  id         bigint generated always as identity primary key,
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 2. Artículos del proveedor ──────────────────────────────
create table if not exists public.mp_articulos (
  id           bigint generated always as identity primary key,
  proveedor_id bigint not null references public.mp_proveedores(id) on delete cascade,
  grupo        text not null default 'Esencias',   -- separa los bloques de la planilla
  nombre       text not null,
  codigo       text,
  orden        int  not null default 0,
  activo       boolean not null default true,
  nota         text,
  unique (proveedor_id, nombre)
);
create index if not exists idx_mp_art_prov on public.mp_articulos(proveedor_id);

-- ── 3. Parámetros, uno por proveedor ────────────────────────
create table if not exists public.mp_parametros (
  proveedor_id       bigint primary key references public.mp_proveedores(id) on delete cascade,
  crecimiento_pct    numeric not null default 20,    -- P1
  meses_cobertura    numeric not null default 3,     -- P2
  semanas_seguridad  numeric not null default 3,     -- P3
  kg_bulto           numeric not null default 30,    -- P4 (tarrina)
  semanas_leadtime   numeric not null default 4,     -- P5
  -- P6: NO está en la planilla. Ahí el corte entre "compra moderada" y
  -- "compra grande" no se puede deducir de los datos (los moderados
  -- llegan a 210 kg y los grandes arrancan en 300), así que se deja
  -- configurable en vez de adivinarlo. 300 es el valor que respeta
  -- exactamente la clasificación que hoy tiene la planilla.
  umbral_grande_kg   numeric not null default 300,
  updated_at         timestamptz not null default now()
);

-- ── 4. Corridas: una foto por cada vez que se hace el pedido ─
--  La planilla se pisa a sí misma en cada importación y se pierde con
--  qué números se decidió la anterior. Acá cada una queda guardada.
create table if not exists public.mp_corridas (
  id           bigint generated always as identity primary key,
  proveedor_id bigint not null references public.mp_proveedores(id) on delete cascade,
  nombre       text not null,
  fecha        date not null default current_date,
  nota         text,
  cerrada      boolean not null default false,   -- cerrada = ya se pidió, no se toca más
  created_at   timestamptz not null default now(),
  created_by   text
);
create index if not exists idx_mp_corr_prov on public.mp_corridas(proveedor_id, fecha desc);

-- ── 5. Los datos de cada artículo en cada corrida ───────────
create table if not exists public.mp_datos (
  id                bigint generated always as identity primary key,
  corrida_id        bigint not null references public.mp_corridas(id) on delete cascade,
  articulo_id       bigint not null references public.mp_articulos(id) on delete cascade,
  consumo_3m        numeric not null default 0,
  stock_actual      numeric not null default 0,
  prom_anual        numeric not null default 0,
  compra_confirmada numeric,     -- null = todavía no se decidió
  nota              text,
  unique (corrida_id, articulo_id)
);
create index if not exists idx_mp_datos_corr on public.mp_datos(corrida_id);

-- ── 6. RLS: igual criterio que el resto ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['mp_proveedores','mp_articulos','mp_parametros','mp_corridas','mp_datos'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_%I_read on public.%I;', t, t);
    execute format('create policy p_%I_read on public.%I for select using (auth.role()=''authenticated'');', t, t);
    execute format('drop policy if exists p_%I_write on public.%I;', t, t);
    execute format('create policy p_%I_write on public.%I for all using (public.has_module(''mp_importacion'')) with check (public.has_module(''mp_importacion''));', t, t);
  end loop;
end $$;

-- ── 7. Semilla: MERO AR con los datos de la planilla ────────
insert into public.mp_proveedores (nombre)
select 'MERO AR' where not exists (select 1 from public.mp_proveedores where nombre='MERO AR');

insert into public.mp_parametros (proveedor_id)
select id from public.mp_proveedores where nombre='MERO AR'
  and not exists (select 1 from public.mp_parametros p where p.proveedor_id = mp_proveedores.id);

-- Artículos + la corrida inicial con los números que hoy tiene la planilla.
do $$
declare v_prov bigint; v_corr bigint; r record; v_art bigint;
begin
  select id into v_prov from public.mp_proveedores where nombre='MERO AR';

  -- grupo, nombre, codigo, orden, consumo_3m, stock_actual, prom_anual, confirmada, nota
  for r in
    select * from (values
      ('Esencias','Esencia Acqua MEROAR','761453',1,36.8,30.0,11.8,30.0,null),
      ('Esencias','Esencia Arpegge MEROAR','761409',2,134.1,60.0,34.8,90.0,null),
      ('Esencias','Esencia Beatifull Clothes MEROAR','761412',3,38.0,60.0,8.9,0.0,null),
      ('Esencias','Esencia Blemix MEORAR','656221',4,9.6,30.0,3.5,0.0,null),
      ('Esencias','Esencia Bosque MEROAR','762504',5,386.2,150.0,136.8,630.0,null),
      ('Esencias','Esencia Chicle MEROAR','761450',6,64.3,60.0,23.1,210.0,null),
      ('Esencias','Esencia Citrico Limpiador MEROAR','761396',7,189.9,90.0,69.3,330.0,null),
      ('Esencias','Esencia Citrico Textil MEROAR','761410',8,230.8,220.0,72.4,150.0,null),
      ('Esencias','Esencia Coniglio Bebe MEROAR','654500',9,152.1,30.0,51.0,240.0,null),
      ('Esencias','Esencia DIALUX MEROAR','655843',10,535.5,210.0,171.7,690.0,'500 KGS ERESUR YA DISPONIBLES'),
      ('Esencias','Esencia Eucalipto MEROAR','761407',11,117.5,16.0,45.0,210.0,null),
      ('Esencias','Esencia Lavanda Limpiador MEROAR','653777',12,321.8,120.0,123.1,510.0,null),
      ('Esencias','Esencia Lavanda Textil MEROAR','657191',13,16.0,50.0,6.0,0.0,null),
      ('Esencias','Esencia Lemmon & Fruit MEROAR','761440',14,92.0,90.0,22.2,0.0,null),
      ('Esencias','Esencia Lenin MEROAR','761395',15,287.5,120.0,93.2,330.0,null),
      ('Esencias','Esencia Limon TEXTIL Y DETER MEROAR','761441',16,198.7,125.0,67.5,240.0,null),
      ('Esencias','Esencia Manzana Verde MEROAR','6237',17,48.0,210.0,24.2,0.0,null),
      ('Esencias','Esencia Nivea MEROAR','654606',18,43.2,60.0,14.2,0.0,null),
      ('Esencias','Esencia SKIP MEROAR','656270',19,255.2,240.0,94.0,240.0,null),
      ('Esencias','Esencia Tentación de moras MEROAR','762753',20,280.5,240.0,99.8,240.0,null),
      ('Esencias','Esencia Uva MEROAR','761413',21,54.8,60.0,15.9,30.0,null),
      ('Esencias','Esencia Vainilla MEROAR','655717',22,52.5,60.0,17.8,30.0,null),
      ('Esencias','Esencia Vivex MEROAR','654363',23,18.0,30.0,8.5,30.0,null),
      ('Esencias','Esencia Erba Pura 2RB1 P5R1','762928',24,80.0,0.0,6.7,90.0,'Nuevo'),
      ('Esencias','Esencia Yara Y1R1','763042',25,88.0,0.0,7.3,90.0,'Nuevo'),
      ('Esencias','Esencia Asad 1S1D','762950',26,88.0,0.0,7.3,90.0,'Nuevo'),
      ('Esencias','Esencia Naranja Pimienta','762853',27,47.1,0.0,3.9,60.0,'Nuevo'),
      ('Esencia y Potes','Frasco Plastico 120 ml con tapa','151005',28,750.0,1000.0,102.0,0.0,null),
      ('Esencia y Potes','Esencia Frutilla AV NEW','762866',29,12.0,0.0,2.5,60.0,null),
      ('Esencia y Potes','Esencia Chicle AV NEW','762865',30,18.2,35.0,6.1,30.0,null),
      ('Esencia y Potes','Esencia Citrico AV NEW','762863',31,35.5,16.0,14.5,60.0,null),
      ('Esencia y Potes','Esencia UVA AV NEW','762869',32,10.6,6.0,4.8,30.0,null),
      ('Esencia y Potes','Esencia Limon AV NEW','762864',33,14.0,18.0,8.2,30.0,null),
      ('Esencia y Potes','Tirillas 1 kg (350 Unid)',null,34,750.0,1050.0,102.0,0.0,null)
    ) as t(grupo,nombre,codigo,orden,c3m,stk,anual,conf,nota)
  loop
    insert into public.mp_articulos (proveedor_id,grupo,nombre,codigo,orden,nota)
      values (v_prov,r.grupo,r.nombre,r.codigo,r.orden,r.nota)
      on conflict (proveedor_id,nombre) do nothing;
  end loop;

  -- La corrida inicial sólo se crea si no hay ninguna
  if not exists (select 1 from public.mp_corridas where proveedor_id=v_prov) then
    insert into public.mp_corridas (proveedor_id,nombre,fecha,nota,created_by)
      values (v_prov,'Importación base','2026-06-08',
              'Los números con los que estaba la planilla al pasarla al sistema.','migración')
      returning id into v_corr;

    for r in
      select * from (values
        ('Esencia Acqua MEROAR',36.8,30.0,11.8,30.0),
        ('Esencia Arpegge MEROAR',134.1,60.0,34.8,90.0),
        ('Esencia Beatifull Clothes MEROAR',38.0,60.0,8.9,0.0),
        ('Esencia Blemix MEORAR',9.6,30.0,3.5,0.0),
        ('Esencia Bosque MEROAR',386.2,150.0,136.8,630.0),
        ('Esencia Chicle MEROAR',64.3,60.0,23.1,210.0),
        ('Esencia Citrico Limpiador MEROAR',189.9,90.0,69.3,330.0),
        ('Esencia Citrico Textil MEROAR',230.8,220.0,72.4,150.0),
        ('Esencia Coniglio Bebe MEROAR',152.1,30.0,51.0,240.0),
        ('Esencia DIALUX MEROAR',535.5,210.0,171.7,690.0),
        ('Esencia Eucalipto MEROAR',117.5,16.0,45.0,210.0),
        ('Esencia Lavanda Limpiador MEROAR',321.8,120.0,123.1,510.0),
        ('Esencia Lavanda Textil MEROAR',16.0,50.0,6.0,0.0),
        ('Esencia Lemmon & Fruit MEROAR',92.0,90.0,22.2,0.0),
        ('Esencia Lenin MEROAR',287.5,120.0,93.2,330.0),
        ('Esencia Limon TEXTIL Y DETER MEROAR',198.7,125.0,67.5,240.0),
        ('Esencia Manzana Verde MEROAR',48.0,210.0,24.2,0.0),
        ('Esencia Nivea MEROAR',43.2,60.0,14.2,0.0),
        ('Esencia SKIP MEROAR',255.2,240.0,94.0,240.0),
        ('Esencia Tentación de moras MEROAR',280.5,240.0,99.8,240.0),
        ('Esencia Uva MEROAR',54.8,60.0,15.9,30.0),
        ('Esencia Vainilla MEROAR',52.5,60.0,17.8,30.0),
        ('Esencia Vivex MEROAR',18.0,30.0,8.5,30.0),
        ('Esencia Erba Pura 2RB1 P5R1',80.0,0.0,6.7,90.0),
        ('Esencia Yara Y1R1',88.0,0.0,7.3,90.0),
        ('Esencia Asad 1S1D',88.0,0.0,7.3,90.0),
        ('Esencia Naranja Pimienta',47.1,0.0,3.9,60.0),
        ('Frasco Plastico 120 ml con tapa',750.0,1000.0,102.0,0.0),
        ('Esencia Frutilla AV NEW',12.0,0.0,2.5,60.0),
        ('Esencia Chicle AV NEW',18.2,35.0,6.1,30.0),
        ('Esencia Citrico AV NEW',35.5,16.0,14.5,60.0),
        ('Esencia UVA AV NEW',10.6,6.0,4.8,30.0),
        ('Esencia Limon AV NEW',14.0,18.0,8.2,30.0),
        ('Tirillas 1 kg (350 Unid)',750.0,1050.0,102.0,0.0)
      ) as t(nombre,c3m,stk,anual,conf)
    loop
      select id into v_art from public.mp_articulos
       where proveedor_id=v_prov and nombre=r.nombre;
      if v_art is not null then
        insert into public.mp_datos (corrida_id,articulo_id,consumo_3m,stock_actual,prom_anual,compra_confirmada)
          values (v_corr,v_art,r.c3m,r.stk,r.anual,r.conf)
          on conflict (corrida_id,articulo_id) do nothing;
      end if;
    end loop;
  end if;
end $$;

-- ── Controles ───────────────────────────────────────────────
select (select count(*) from public.mp_articulos) as articulos,
       (select count(*) from public.mp_corridas)  as corridas,
       (select count(*) from public.mp_datos)     as filas_de_datos;

-- Tienen que dar: 3.563,0 kg de consumo y 2.361,0 kg de stock, igual
-- que los totales de la planilla (las esencias, sin el bloque de potes).
select round(sum(d.consumo_3m),1) as consumo_3m, round(sum(d.stock_actual),1) as stock
  from public.mp_datos d
  join public.mp_articulos a on a.id=d.articulo_id
 where a.grupo='Esencias';
