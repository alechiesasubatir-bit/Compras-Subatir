# Respuesta al plan de integración de Compras

De: Ale (Compras / Depósitos) · 2026-07-31

El plan está bien. Sobre todo que hayan tomado en serio lo del cruce por texto y
que la migración de "texto" a `insumo_id` sea **gradual** — es exactamente el
punto donde esto se puede romper sin que nadie se entere.

Tres cosas concretas, más una herramienta para la Etapa 6.

---

## 1. Los números de categorías no coinciden, y sé por qué

El plan dice **147** insumos: MP 75, ENV 61, CON 11.
La tabla `inventario` tiene **148**: MP 75, ENV 53, CON 19, **1 sin categoría**.

La diferencia no es un error de conteo. **En Compras hay dos fuentes de categoría
que no coinciden entre sí:**

| Fuente | MP | ENV | CON | Sin categoría |
|---|---:|---:|---:|---:|
| `inventario.ext_id` | 75 | 53 | 19 | 1 |
| tabla `categorias` (178 filas) | 79 | 47 | 22 | 0 |

**13 productos están categorizados distinto** según cuál se mire:

```
DOYPACK BLANCO JACUZZI C/Z 125*70*185      ext_id=ENV   categorias=CON
DOYPACK POUCH PET/PE70 105X110             ext_id=ENV   categorias=CON
Bocha Medidora Jabon Liquido               ext_id=ENV   categorias=MP
Bolsita Aromatización 7 X 15               ext_id=CON   categorias=MP
Bolsa Reutilizable 45x60/70 C/Diseño       ext_id=CON   categorias=ENV
Bolsas de nylon p/ botella alcohol 25x30   ext_id=CON   categorias=ENV
… 7 más
```

Ninguna de las dos fuentes da 61/11, así que en `core.insumos` hay una **tercera
categorización**, hecha a mano. Puede estar bien —quizá corrigieron cosas mal
clasificadas, y de hecho hay casos claros— pero necesito que me pasen:

- **qué 8 productos movieron** de CON a ENV respecto de `ext_id`, y
- **cuál es el que desapareció** (148 → 147).

Si `core.insumos` va a ser la fuente de verdad, esa recategorización tiene que ser
una decisión registrada, no un efecto colateral de la carga. Del lado de Compras,
`ext_id` alimenta filtros y la tabla `categorias` alimenta el chip de categoría en
Stock: si el dato nuevo difiere de los dos, hay que decidir cuál gana y ajustar la
app.

**Lo bueno:** MP da **75 en las tres fuentes**. La categoría que más importa para
Producción coincide sin ambigüedad.

---

## 2. Falta un cambio de código en el plan (rompe callado)

Las suscripciones de realtime tienen el esquema **hardcodeado**:

```js
ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, trigger)
```

- `subatir-app.js:376` (Compras)
- `deposito/deposito-app.js:134` (Depósitos)

Al mover las tablas a un esquema `compras`, esas suscripciones **dejan de recibir
eventos**. Sin error, sin aviso en consola: la app simplemente deja de refrescarse
sola. Nadie lo nota hasta que dos personas ven datos distintos y una pisa el
cambio de la otra.

**La buena noticia:** hay 13 llamadas a `live()` repartidas en 12 archivos, pero
todas pasan por esas dos funciones. **Son 2 líneas.** Lo hago yo cuando reapuntemos
la app, pero tiene que estar en la lista de la Etapa 4 para que no se pase.

Y un detalle de la Etapa 2: no alcanza con recrear las RPC en el esquema nuevo.
**Unas 30 funciones declaran `set search_path = public`** — hay que cambiarlo en
cada una, si no van a seguir buscando las tablas en `public`.

---

## 3. Su pregunta abierta 2: `imp_articulos`

Preguntan si el catálogo de Depósitos (119 filas) también se vincula a
`core.insumos`. Los datos:

- **12 códigos** y **4 descripciones** coinciden con `inventario`.
- **143** productos existen solo en Compras, **115** solo en Depósitos.

Son catálogos **casi disjuntos**, y tiene sentido: Depósitos mueve producto
terminado y de reventa (Intex, Enjoy, envases para venta), no las materias primas
que compra Producción.

**Mi recomendación: no lo fuercen en esta migración.** Vincularlo es un proyecto
aparte, con su propia tabla de equivalencias y sus propias decisiones de negocio.
Meterlo acá multiplica el riesgo sin beneficio inmediato — y la Etapa 7 ya deja la
puerta abierta para hacerlo después, con calma.

Sobre los 12 códigos compartidos: hay que mirarlos uno por uno antes de asumir que
son el mismo insumo físico. Con 6 códigos duplicados dentro de `inventario`, que
un código coincida entre catálogos no prueba nada por sí solo.

---

## 4. Para la Etapa 6: hay una herramienta para verificar

El plan dice *"verificar que los cruces difusos sigan cuadrando"*. **Eso no se
puede verificar a ojo**: son 148 artículos × stock en tránsito, proveedores,
cobertura, estado y comparación de precios.

Armé **`verificar.html`**, en la raíz del repo de Compras. Hace dos cosas:

**Sacar una foto** — lee la base y congela en un `.json` todo lo que la app
*calcula* (no lo que guarda):

- por artículo: stock, mínimo, consumo, **cuánto tiene en tránsito**, **el valor de
  eso**, **el último proveedor**, **la lista completa de proveedores que lo
  proveen**, cobertura, estado (crítico/medio/óptimo) y categoría;
- los pares (artículo, proveedor) de la lista de precios, normalizados;
- cuántos artículos tiene cada proveedor;
- el stock y los pallets de Depósitos;
- los conteos de todas las tablas.

**Comparar dos fotos** — se cargan la de antes y la de después y lista **solo lo
que cambió**. Si todo da igual, dice *"SIN DIFERENCIAS"*.

### Cómo usarla

1. **Antes de migrar**, con la app apuntando al proyecto actual: abrir
   `verificar.html` → *Sacar foto*. Guarda `foto-wbbscaitwdwhuufiiwsw-….json`.
2. **Después de migrar**, con `supabase-config.js` ya apuntando a la plataforma:
   abrir `verificar.html` → *Sacar foto* otra vez.
3. Cargar las dos en *Comparar*.

Ya la probé plantando roturas a propósito (un artículo que pierde sus proveedores,
uno que pierde su stock en tránsito, una cobertura que cambia, pares de precio que
desaparecen, una fila de menos). Las detectó todas y las mostró así:

```
CONTEOS POR TABLA
  ✗ inventario: 148 → 147  (-1)

ARTÍCULOS — valores calculados
  ✗ 2 artículos cambiaron:
    · Acetato de Butilo
        proveedores: [DIU,EMILIOBENZO,NORTESUR] → []
    · Acido Sulfonico 99 % TYPOL Labrex 200
        cobertura: 0.44 → 9
        estado: MEDIO → OPTIMO

OTROS CONJUNTOS
  ✗ pares (artículo, proveedor) de precios: 3 desaparecieron, 0 aparecieron
      − ACETATO DE BUTILO B1 L | EMILIOBENZO | 0 | 247.21
```

**Advertencia sobre la herramienta:** las funciones de cruce difuso están
*copiadas* de `stock.html` y así está anotado en el archivo. Si se tocan allá, hay
que tocarlas acá: si divergen, el verificador estaría midiendo una realidad
distinta de la que ve la app, que es peor que no verificar.

---

## Lo que queda igual

De acuerdo con el resto: esquema propio, `codigo_legacy` para rastrear, conservar
las descripciones durante la transición, migración gradual a `insumo_id`. El orden
de las etapas tiene sentido.

Una sola cosa sobre la Etapa 6: **no apaguen `wbbscaitwdwhuufiiwsw` el mismo día**.
Dejarlo prendido en solo lectura una o dos semanas cuesta nada y permite volver a
sacar una foto si aparece una diferencia que no se explica.
