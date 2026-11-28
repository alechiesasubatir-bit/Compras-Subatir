// Panel de traslados entre depósitos (traslados.js): qué se muestra,
// qué se oculta y cómo se pinta el avance.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { cargar, drenar } = require('./helpers/entorno.js');

const hoy = new Date().toISOString();
const ayer = new Date(Date.now() - 2 * 86400000).toISOString();
const sol = (o) => Object.assign({ id: 1, estado: 'PENDIENTE', created_at: hoy, unidades: 1200, items: 2,
  origen: 'Furriol', destino: 'Artigas', articulos: [{ art: 'Cloro 5L', cod: '218851' }] }, o);

async function montar(filas, opts) {
  const e = cargar(Object.assign({ pagina: 'deposito/index.html',
    scripts: ['supabase-config.js', 'traslados.js'] }, opts,
    { tablas: Object.assign({ imp_solicitud_resumen: filas }, opts && opts.tablas) }));
  const host = { innerHTML: '' }, cnt = { textContent: '' }, btn = { style: {}, onclick: null };
  e.win.document.querySelector = () => host;
  e.win.document.getElementById = (id) => (id === 'tr-cnt' ? cnt : id === 'tr-limpiar' ? btn : null);
  const panel = e.win.Traslados.montar('#tr');
  await drenar();
  return { e, host, cnt, btn, panel };
}

describe('Traslados', () => {
  test('barra: paso actual y final', () => {
    const T = cargar({ pagina: 'login.html', scripts: ['supabase-config.js', 'traslados.js'] }).win.Traslados;
    assert.match(T.barra('PENDIENTE'), /paso 1 de 4/);
    assert.match(T.barra('EN_TRANSITO'), /paso 3 de 4/);
    assert.match(T.barra('ENTREGADA'), /paso 4 de 4/);
    assert.match(T.barra('ENTREGADA'), /c-fin/);
    assert.match(T.barra('RARO'), /paso 1 de 4/);   // estado desconocido no rompe
  });

  test('muestra los en curso y los entregados hoy; no cancelados ni entregados viejos', async () => {
    const { host, cnt, btn } = await montar([
      sol({ id: 1 }),
      sol({ id: 2, estado: 'CANCELADA' }),
      sol({ id: 3, estado: 'ENTREGADA', entregada_at: hoy }),
      sol({ id: 4, estado: 'ENTREGADA', entregada_at: ayer }),
      sol({ id: 5, estado: 'ENTREGADA' })                          // sin fecha de entrega
    ]);
    assert.match(host.innerHTML, /#1/);
    assert.match(host.innerHTML, /#3/);
    assert.doesNotMatch(host.innerHTML, /#2|#4|#5/);
    assert.strictEqual(cnt.textContent, '2 traslados');
    assert.strictEqual(btn.style.display, 'inline-flex');
  });

  test('"limpiar" oculta los entregados en este dispositivo', async () => {
    const { host, cnt, btn } = await montar([sol({ id: 1 }), sol({ id: 3, estado: 'ENTREGADA', entregada_at: hoy })]);
    btn.onclick();
    await drenar();
    assert.doesNotMatch(host.innerHTML, /#3/);
    assert.strictEqual(cnt.textContent, '1 traslado');
    assert.strictEqual(btn.style.display, 'none');
  });

  test('escapa el HTML de los nombres (no se puede inyectar marcado)', async () => {
    const { host } = await montar([sol({ articulos: [{ art: '<img src=x onerror=alert(1)>' }], pedido_por: '<b>x</b>' })]);
    assert.doesNotMatch(host.innerHTML, /<img/);
    assert.match(host.innerHTML, /&lt;img/);
  });

  test('varios articulos: uno por linea con su cantidad; sin articulos, los bultos', async () => {
    const { host } = await montar([
      sol({ id: 1, articulos: [{ art: 'A', un: 300 }, { art: 'B', un: 20 }] }),
      sol({ id: 2, articulos: null, items: 1 })
    ]);
    assert.match(host.innerHTML, /<b>300<\/b> A[\s\S]*<b>20<\/b> B/);
    assert.match(host.innerHTML, /1 pallet</);
  });

  // Renglones por tipo (28/11/2026)
  test('agrupa por el tipo del maestro de articulos, en orden Infraestructura / Consumo / Venta', async () => {
    const { host } = await montar([
      sol({ id: 1, articulos: [{ art: 'Botella', cod: '220034' }] }),
      sol({ id: 2, articulos: [{ art: 'Estante', cod: '490079' }], sueltos: 1, items: 1 }),
      sol({ id: 3, articulos: [{ art: 'Gatillo', cod: '220106' }] })
    ], { tablas: { imp_articulos: [
      { codigo: '220034', descripcion: 'Botella', tipo: 'Venta' },
      { codigo: '490079', descripcion: 'Estante', tipo: 'Infraestructura' },
      { codigo: '220106', descripcion: 'Gatillo', tipo: 'Consumo' }] } });
    const h = host.innerHTML;
    assert.ok(h.indexOf('Infraestructura') < h.indexOf('Consumo') && h.indexOf('Consumo') < h.indexOf('Venta'));
    assert.ok(h.indexOf('#2') < h.indexOf('#3') && h.indexOf('#3') < h.indexOf('#1'));
  });

  test('lo suelto no se cuenta como pallet, y sin cruce de tipo va a Infraestructura', async () => {
    const { host } = await montar([sol({ id: 72, items: 3, sueltos: 3, articulos: [{ art: 'Chapa', cod: '1', un: 8 }] })]);
    assert.match(host.innerHTML, /3 sueltos/);
    assert.doesNotMatch(host.innerHTML, /pallet/);
    assert.match(host.innerHTML, /Infraestructura/);
  });

  test('no se pierde ningun dato: responsable, preparo, motivo y nota', async () => {
    const { host } = await montar([sol({ pedido_por: 'ale', responsable: 'Rosario', operario: 'Diego',
      motivo: 'Obra nueva', nota: 'urgente', destino: 'Maldonado' })]);
    for (const t of ['ale', 'Rosario', 'Diego', 'Obra nueva', 'urgente', 'Furriol', 'Maldonado', '1.200']) {
      assert.match(host.innerHTML, new RegExp(t));
    }
  });

  test('si el motivo repite el destino no se muestra dos veces', async () => {
    const { host } = await montar([sol({ motivo: 'Artigas', destino: 'Artigas' })]);
    assert.strictEqual(host.innerHTML.split('Artigas').length - 1, 1);
  });

  test('sin datos -> mensaje vacio; error de la base -> aviso', async () => {
    assert.match((await montar([])).host.innerHTML, /Sin traslados en curso/);
    const r = await montar([sol()], { errores: { imp_solicitud_resumen: true } });
    assert.match(r.host.innerHTML, /No se pudieron leer/);
  });
});
