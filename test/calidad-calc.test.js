const { test } = require('node:test');
const assert = require('node:assert');
const { CalidadMP } = require('../calidad-calc.js');

// Parte de la lista real de MERO AR (mp_articulos)
const ARTS = [
  { id: 1, nombre: 'Esencia Acqua MEROAR', codigo: '761453' },
  { id: 5, nombre: 'Esencia Bosque MEROAR', codigo: '762504' },
  { id: 12, nombre: 'Esencia Lavanda Limpiador MEROAR', codigo: '653777' },
  { id: 13, nombre: 'Esencia Lavanda Textil MEROAR', codigo: '657191' },
  { id: 14, nombre: 'Esencia Lemmon & Fruit MEROAR', codigo: '761440' },
  { id: 17, nombre: 'Esencia Manzana Verde MEROAR', codigo: '6237' },
  { id: 33, nombre: 'Tirillas 1 kg (350 Unid)', codigo: null }
];
const id = (f) => { const r = CalidadMP.emparejar(f, ARTS); return r.art && r.art.id; };

test('detectarTipo: FT y HDS por las siglas y palabras habituales', () => {
  assert.strictEqual(CalidadMP.detectarTipo('FT Esencia Bosque.pdf'), 'FT');
  assert.strictEqual(CalidadMP.detectarTipo('bosque_TDS.pdf'), 'FT');
  assert.strictEqual(CalidadMP.detectarTipo('Ficha Técnica Acqua.pdf'), 'FT');
  assert.strictEqual(CalidadMP.detectarTipo('HDS-761453.pdf'), 'HDS');
  assert.strictEqual(CalidadMP.detectarTipo('MSDS Bosque.PDF'), 'HDS');
  assert.strictEqual(CalidadMP.detectarTipo('Hoja de seguridad lavanda.pdf'), 'HDS');
});

test('detectarTipo: "ficha de datos de seguridad" es HDS, no FT', () => {
  assert.strictEqual(CalidadMP.detectarTipo('Ficha de datos de seguridad Bosque.pdf'), 'HDS');
});

test('detectarTipo: sin pistas queda vacío (no adivina)', () => {
  assert.strictEqual(CalidadMP.detectarTipo('Bosque.pdf'), '');
  // "SOFT" contiene FT pero no es la palabra FT
  assert.strictEqual(CalidadMP.detectarTipo('Soft Bosque.pdf'), '');
});

test('emparejar: el código del artículo en el nombre manda', () => {
  assert.strictEqual(id('HDS 761453.pdf'), 1);
  assert.strictEqual(id('FT_653777_rev2.pdf'), 12);
  // código corto de 4 dígitos
  assert.strictEqual(id('HDS 6237.pdf'), 17);
});

test('emparejar: por nombre, sin importar ESENCIA / MEROAR', () => {
  assert.strictEqual(id('HDS Esencia Bosque MEROAR.pdf'), 5);
  assert.strictEqual(id('ft-acqua.pdf'), 1);
  assert.strictEqual(id('FT Lavanda Textil.pdf'), 13);
  assert.strictEqual(id('HDS Lemmon Fruit.pdf'), 14);
});

test('emparejar: si empata no elige (Lavanda sola puede ser cualquiera de las dos)', () => {
  assert.strictEqual(id('HDS Lavanda.pdf'), null);
});

test('emparejar: sin coincidencia devuelve null', () => {
  assert.strictEqual(id('HDS Pino.pdf'), null);
  // un año en el nombre no es un código
  assert.strictEqual(id('FT 2024.pdf'), null);
});

test('filasImp: el vigente es el último cargado y la cobertura cuenta FT + HDS', () => {
  const docs = [
    { id: 1, mp_articulo_id: 5, tipo: 'FT', fecha_doc: '2025-01-01', created_at: '2025-01-02' },
    { id: 2, mp_articulo_id: 5, tipo: 'FT', fecha_doc: '2026-03-01', created_at: '2026-03-02' },
    // una HDS con fecha de vencimiento vieja: ya no significa nada
    { id: 3, mp_articulo_id: 5, tipo: 'HDS', vence: '2026-01-01', created_at: '2025-06-01' },
    { id: 4, inventario_id: 9, tipo: 'FT', created_at: '2026-01-01' } // de Stock: no cuenta
  ];
  const fs = CalidadMP.filasImp(ARTS, docs);
  const b = fs.find((f) => f.art.id === 5);
  assert.strictEqual(b.ft.id, 2);
  assert.strictEqual(b.hds.id, 3);
  assert.strictEqual('hdsVto' in b, false);
  const r = CalidadMP.resumenImp(fs);
  assert.strictEqual(r.arts, 7);
  assert.strictEqual(r.completos, 1);
  assert.strictEqual(r.docs, 3);
  // 2 papeles de 14 posibles
  assert.strictEqual(r.cobertura, 14);
});

test('aReemplazar: FT/HDS nueva borra la anterior del mismo artículo importado', () => {
  const docs = [
    { id: 1, mp_articulo_id: 5, tipo: 'FT' },
    { id: 2, mp_articulo_id: 5, tipo: 'HDS' },   // otro tipo: queda
    { id: 3, mp_articulo_id: 6, tipo: 'FT' },    // otro artículo: queda
    { id: 9, mp_articulo_id: 5, tipo: 'FT' }     // la nueva
  ];
  const ids = CalidadMP.aReemplazar(docs, docs[3]).map((d) => d.id);
  assert.deepStrictEqual(ids, [1]);
});

test('aReemplazar: en Stock va por MP y proveedor, sin importar acentos ni mayúsculas', () => {
  const nuevo = { id: 10, inventario_id: 7, tipo: 'HDS', proveedor: 'Química S.A.' };
  const docs = [
    { id: 1, inventario_id: 7, tipo: 'HDS', proveedor: 'QUIMICA S.A.' },   // se va
    { id: 2, inventario_id: 7, tipo: 'HDS', proveedor: 'Nortesur S.A.' },  // otro proveedor: queda
    { id: 3, inventario_id: 8, tipo: 'HDS', proveedor: 'Química S.A.' },   // otra MP: queda
    nuevo
  ];
  assert.deepStrictEqual(CalidadMP.aReemplazar(docs, nuevo).map((d) => d.id), [1]);
});

test('aReemplazar: COA y otros documentos no se reemplazan', () => {
  const docs = [{ id: 1, inventario_id: 7, tipo: 'COA', proveedor: 'X' }];
  assert.deepStrictEqual(CalidadMP.aReemplazar(docs, { id: 2, inventario_id: 7, tipo: 'COA', proveedor: 'X' }), []);
  assert.deepStrictEqual(CalidadMP.aReemplazar(docs, { id: 3, inventario_id: 7, tipo: 'OTRO', proveedor: 'X' }), []);
});
