import xlrd, os, datetime, io

RAIZ = r'C:\Users\alech\Downloads\PREVISION DE CLORO\PREVISION DE CLORO'
TEMPS = [('2024-2025', 2024), ('2025-2026', 2025)]

def excel_a_fecha(n):
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(n))

def lunes_ini(anio):
    d = datetime.date(anio, 8, 1)
    return d - datetime.timedelta(days=d.weekday())

def semana(f, anio):
    return (f - lunes_ini(anio)).days // 7 + 1

productos = {}          # codigo -> nombre
ventas = {}             # (temporada, codigo, semana) -> unidades
rango = {}              # (temporada, codigo) -> (semana_min, semana_max)

for temp, anio in TEMPS:
    for fn in sorted(os.listdir(os.path.join(RAIZ, temp))):
        sh = xlrd.open_workbook(os.path.join(RAIZ, temp, fn)).sheet_by_index(0)
        for r in range(5, sh.nrows):
            v = sh.row(r)
            if not isinstance(v[0].value, float) or v[0].value < 1000:
                continue                      # encabezado y fila de total
            cod = str(v[2].value).strip()
            productos.setdefault(cod, str(v[3].value).strip())
            w = semana(excel_a_fecha(v[0].value), anio)
            ventas[(temp, cod, w)] = ventas.get((temp, cod, w), 0) + float(v[4].value)
            lo, hi = rango.get((temp, cod), (w, w))
            rango[(temp, cod)] = (min(lo, w), max(hi, w))

# Las semanas sin venta dentro del rango del archivo van en CERO. Si se
# saltearan, la pantalla las dibujaria como huecos y el suavizado las
# promediaria como si no existieran, inflando la prevision.
for (temp, cod), (lo, hi) in list(rango.items()):
    for w in range(lo, hi + 1):
        ventas.setdefault((temp, cod, w), 0)

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

out = io.StringIO()
out.write("""-- ============================================================
--  PREVISION CLORO - semilla: productos y las dos temporadas historicas
--
--  Generado desde los .xls del ERP. Las ventas van AGREGADAS POR SEMANA
--  de temporada (semana 1 = el lunes de la semana que contiene el 1/8).
--
--  Las semanas sin venta dentro del rango de cada archivo van en CERO y
--  no salteadas: un hueco lo promediaria el suavizado como si no
--  existiera, e inflaria la prevision de las semanas de al lado.
--
--  OJO: HAY SEMANAS CON CANTIDAD NEGATIVA (11 en estas dos temporadas).
--  No es un error de carga: son semanas donde las devoluciones y notas
--  de credito superaron a las ventas. Se dejan como estan porque el neto
--  es la demanda real; ponerlas en cero inflaria la prevision.
--
--  Los productos quedan SIN materia prima asignada a proposito: nadie
--  puede deducir de estos datos si el Cloro Granulado es hipoclorito o
--  el Cloro Shock es dicloro, y una suposicion ahi se convierte en una
--  compra de toneladas equivocada. Se asignan desde Configuracion.
--
--  Correr DESPUES de cloro_schema.sql.
-- ============================================================

""")

out.write("insert into public.cl_temporadas (nombre, fecha_ini, fecha_fin, activa) values\n")
out.write(",\n".join(
    "  (%s, '%d-08-01', '%d-03-31', false)" % (q(t), a, a + 1) for t, a in TEMPS))
out.write("\non conflict (nombre) do nothing;\n\n")

out.write("insert into public.cl_productos (codigo, nombre, orden) values\n")
out.write(",\n".join(
    "  (%s, %s, %d)" % (q(c), q(productos[c]), i + 1)
    for i, c in enumerate(sorted(productos))))
out.write("\non conflict (codigo) do nothing;\n\n")

out.write("insert into public.cl_ventas (temporada_id, producto_id, semana, unidades, origen)\n"
          "select t.id, p.id, v.semana, v.unidades, 'semilla'\n"
          "  from (values\n")
filas = sorted(ventas.items())
out.write(",\n".join(
    "    (%s, %s, %d, %s)" % (q(t), q(c), w, repr(round(u, 3)))
    for (t, c, w), u in filas))
out.write("\n  ) as v(temporada, codigo, semana, unidades)\n"
          "  join public.cl_temporadas t on t.nombre = v.temporada\n"
          "  join public.cl_productos  p on p.codigo = v.codigo\n"
          "on conflict (temporada_id, producto_id, semana) do nothing;\n\n")

out.write("insert into public.cl_parametros (temporada_id) select id from public.cl_temporadas\n"
          "  where not exists (select 1 from public.cl_parametros x where x.temporada_id = cl_temporadas.id);\n\n")

out.write("-- Control: tienen que dar exactamente estos totales por temporada.\n")
for t, a in TEMPS:
    tot = sum(u for (tt, c, w), u in ventas.items() if tt == t)
    out.write("--   %s = %s unidades\n" % (t, round(tot)))
out.write("""select t.nombre, count(*) as semanas_cargadas, round(sum(v.unidades)) as unidades
  from public.cl_ventas v join public.cl_temporadas t on t.id = v.temporada_id
 group by t.nombre order by t.nombre;

-- Y por producto, contra los .xls del ERP:
""")
for c in sorted(productos):
    linea = "--   %-8s %-46s" % (c, productos[c][:46])
    for t, a in TEMPS:
        linea += " %s=%6d" % (t, round(sum(u for (tt, cc, w), u in ventas.items()
                                           if tt == t and cc == c)))
    out.write(linea + "\n")
out.write("""select p.codigo, p.nombre, t.nombre as temporada, round(sum(v.unidades)) as unidades
  from public.cl_ventas v
  join public.cl_productos  p on p.id = v.producto_id
  join public.cl_temporadas t on t.id = v.temporada_id
 group by p.codigo, p.nombre, t.nombre order by p.codigo, t.nombre;
""")

open(r'C:\SubatirApps\SistemaComprasSubatir\migracion\cloro_seed.sql', 'w',
     encoding='utf-8').write(out.getvalue())
print('filas de venta:', len(filas), ' productos:', len(productos))
