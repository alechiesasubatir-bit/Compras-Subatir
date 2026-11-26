// Excel sin librerías: el generador (SubatirApp.xlsx) y el lector (xlsx-lite.js)
// tienen que entenderse entre sí, y el lector tiene que aguantar archivos reales
// (comprimidos con deflate) y archivos rotos.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { cargar, plano, RAIZ } = require('./helpers/entorno.js');

const XLSX = cargar({ pagina: 'login.html' }).win.SubatirApp.xlsx;

// xlsx-lite.js declara funciones globales: se cargan en un contexto propio
const lite = vm.createContext({ TextDecoder, DataView, Uint8Array, Response, Blob, DecompressionStream, Promise, Math, parseInt, parseFloat, isNaN, Date, String, Object, Error });
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'xlsx-lite.js'), 'utf8'), lite);

// ZIP mínimo con un archivo, método 0 (stored) u 8 (deflate)
function zipDe(nombre, texto, metodo) {
  const name = Buffer.from(nombre), raw = Buffer.from(texto, 'utf8');
  const data = metodo === 8 ? zlib.deflateRawSync(raw) : raw;
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(metodo, 8);
  loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(metodo, 10);
  cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(0, 42);
  const off = loc.length + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cen.length + name.length, 12); end.writeUInt32LE(off, 16);
  const b = Buffer.concat([loc, name, data, cen, name, end]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

describe('Generador .xlsx (SubatirApp.xlsx)', () => {
  test('colName: A, Z, AA, AZ, BA, ZZ, AAA', () => {
    assert.deepStrictEqual([0, 25, 26, 51, 52, 701, 702].map(XLSX.colName), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  test('ida y vuelta: lo que genera se puede leer con xlsx-lite', async () => {
    const blob = XLSX.build({
      hoja: 'Stock', cols: [{ w: 20 }, { w: 10 }],
      filas: [
        { celdas: [{ v: 'Artículo', s: 'th' }, { v: 'Cant', s: 'th' }] },
        { celdas: [{ v: 'Tapa <28/400> & "rosca"', s: 'td' }, { v: 1234.5, s: 'num' }] },
        { celdas: [{ v: 'ctrl\u0001char' }, { v: '' }, null] }
      ]
    });
    const buf = await blob.arrayBuffer();
    const z = lite.zipAbrir(buf);
    for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      assert.ok(z.idx[f], 'falta ' + f);
    }
    const hoja = await lite.zipTexto(z, 'xl/worksheets/sheet1.xml');
    assert.match(hoja, /Tapa &lt;28\/400&gt; &amp; &quot;rosca&quot;/);   // escapado
    assert.match(hoja, /<c r="B2" s="7"><v>1234.5<\/v><\/c>/);             // número con estilo num
    assert.match(hoja, /ctrlchar/);                                        // sin caracteres de control
    assert.doesNotMatch(hoja, /\u0001/);
    assert.match(await lite.zipTexto(z, 'xl/workbook.xml'), /name="Stock"/);
    assert.strictEqual(await lite.zipTexto(z, 'no/existe.xml'), null);
  });

  test('CRC32 del ZIP es correcto (Excel rechaza el archivo si no)', async () => {
    const buf = Buffer.from(await XLSX.build({ filas: [{ celdas: [{ v: 'x' }] }] }).arrayBuffer());
    let p = 0;
    while (buf.readUInt32LE(p) === 0x04034b50) {
      const crc = buf.readUInt32LE(p + 14), size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26);
      const data = buf.subarray(p + 30 + nl, p + 30 + nl + size);
      assert.strictEqual(zlib.crc32(data), crc, buf.toString('utf8', p + 30, p + 30 + nl));
      p += 30 + nl + size;
    }
    assert.ok(p > 0);
  });

  test('sin opciones genera igual un libro valido', async () => {
    const z = lite.zipAbrir(await XLSX.build().arrayBuffer());
    assert.ok(z.idx['xl/worksheets/sheet1.xml']);
  });
});

describe('Lector .xlsx (xlsx-lite.js)', () => {
  test('lee archivos comprimidos con deflate (los de Excel real)', async () => {
    const txt = '<sheetData>' + 'á'.repeat(500) + '</sheetData>';
    const z = lite.zipAbrir(zipDe('xl/worksheets/sheet1.xml', txt, 8));
    assert.strictEqual(await lite.zipTexto(z, 'xl/worksheets/sheet1.xml'), txt);
  });
  test('rechaza lo que no es un ZIP con un mensaje claro', () => {
    assert.throws(() => lite.zipAbrir(new ArrayBuffer(100)), /No parece un archivo \.xlsx/);
    assert.throws(() => lite.zipAbrir(new ArrayBuffer(0)), /No parece/);
  });
  test('compresion desconocida -> error claro', async () => {
    const z = lite.zipAbrir(zipDe('a.xml', 'hola', 0));
    z.idx['a.xml'].met = 12;  // bzip2
    await assert.rejects(lite.zipTexto(z, 'a.xml'), /compresión/);
  });
});

describe('xlRanking (listado "Ranking por Artículo")', () => {
  const R = (n, c) => ({ n, c });
  const filas = [
    R(1, { A: 'Ranking por Artículo' }),
    R(2, { A: 'Del: 01/01/2026 Al: 30/06/2026' }),
    R(4, { A: 'Cod. Articulo', C: 'Articulo', P: 'Salidas' }),
    R(5, { A: '218851', C: 'Cloro 5L', P: '120' }),
    R(6, { A: 'ABC', C: 'Subtotal', P: '999' }),
    R(7, { A: ' 1001 ', C: 'Esencia', P: '5.89E-2' }),
    R(8, { A: '1002', C: 'Sin dato', P: '' })
  ];
  test('encuentra el encabezado por nombre y el periodo', () => {
    const r = plano(lite.xlRanking(filas));
    assert.strictEqual(r.hayCab, true);
    assert.strictEqual(r.meses, 6);
    assert.deepStrictEqual(r.filas, [
      { interno: '218851', desc: 'Cloro 5L', salidas: 120 },
      { interno: '1001', desc: 'Esencia', salidas: 0.0589 },
      { interno: '1002', desc: 'Sin dato', salidas: 0 }
    ]);
  });
  test('modo ventas toma la columna Cantidad del grupo Ventas', () => {
    const r = lite.xlRanking([
      R(3, { A: 'Del: 01/03/2026 Al: 31/03/2026', F: 'VENTAS MN' }),
      R(4, { A: 'Cod. Articulo', B: 'Articulo', D: 'Cantidad', F: 'Cantidad' }),
      R(5, { A: '7', B: 'X', D: '1', F: '40' })
    ], 'ventas');
    assert.strictEqual(r.filas[0].salidas, 40);
    assert.strictEqual(r.meses, 1);
  });
  test('sin encabezado usa las columnas por defecto (A, B, P) y periodo null', () => {
    const r = lite.xlRanking([R(1, { A: '5', B: 'Uno', P: '3' })]);
    assert.strictEqual(r.hayCab, false);
    assert.strictEqual(r.meses, null);
    assert.strictEqual(r.filas[0].salidas, 3);
  });
  test('lista vacia', () => {
    assert.deepStrictEqual(plano(lite.xlRanking([]).filas), []);
  });
});
