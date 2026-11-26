// Integridad del sitio publicado: lo que rompe la app entera sin que ningún
// cálculo falle. Scripts inline que no parsean, archivos que no existen,
// versiones desparejas (el cartel de "versión nueva" en bucle), permisos
// que se declaran en dos lugares y se separan.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RAIZ } = require('./helpers/entorno.js');

const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const existe = (f) => fs.existsSync(path.join(RAIZ, f));
const paginas = fs.readdirSync(RAIZ).filter(f => f.endsWith('.html'))
  .concat(fs.readdirSync(path.join(RAIZ, 'deposito')).filter(f => f.endsWith('.html')).map(f => 'deposito/' + f));
const VERSION = JSON.parse(leer('version.json')).v;
const VERSION_DEP = JSON.parse(leer('deposito/version.json')).v;

describe('Paginas HTML', () => {
  for (const pg of paginas) {
    const html = leer(pg);
    const dir = path.dirname(pg);

    test(pg + ': todos los <script> inline parsean', () => {
      const re = /<script>([\s\S]*?)<\/script>/g; let m, i = 0;
      while ((m = re.exec(html))) {
        i++;
        assert.doesNotThrow(() => new vm.Script(m[1], { filename: pg + '#script' + i }), pg + ' script inline #' + i);
      }
    });

    test(pg + ': los scripts y estilos locales existen', () => {
      const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g; let m;
      while ((m = re.exec(html))) {
        const url = m[1];
        if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('#')) continue;
        const archivo = path.posix.normalize(path.posix.join(dir, url.split('?')[0]));
        assert.ok(existe(archivo), pg + ' referencia ' + url + ' y no existe');
      }
    });

    test(pg + ': ?v= de los scripts propios = version.json', () => {
      const re = /src="([^"]+\.js)\?v=([^"]+)"/g; let m;
      while ((m = re.exec(html))) assert.strictEqual(m[2], VERSION, pg + ' ' + m[1]);
    });

    if (pg !== 'login.html' && pg !== 'deposito/login.html') {
      test(pg + ': APP_VER = version.json', () => {
        const m = /window\.APP_VER\s*=\s*'([^']+)'/.exec(html);
        assert.ok(m, pg + ' no declara APP_VER: nunca se va a enterar de un deploy');
        assert.strictEqual(m[1], pg.startsWith('deposito/') ? VERSION_DEP : VERSION);
      });
    }
  }
});

describe('Service workers', () => {
  for (const [sw, ver] of [['sw.js', VERSION], ['deposito/sw.js', VERSION_DEP]]) {
    const src = leer(sw);
    test(sw + ': APP_VER = version.json', () => {
      assert.strictEqual(/self\.APP_VER\s*=\s*'([^']+)'/.exec(src)[1], ver);
    });
    test(sw + ': cada archivo del SHELL existe', () => {
      const lista = /var SHELL = \[([\s\S]*?)\];/.exec(src)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
      for (const u of lista) {
        if (u === './') continue;
        const f = path.posix.normalize(path.posix.join(path.posix.dirname(sw), u));
        assert.ok(existe(f), sw + ': ' + u + ' no existe');
      }
    });
    test(sw + ': parsea', () => { assert.doesNotThrow(() => new vm.Script(src)); });
  }
});

describe('Permisos declarados en dos lugares', () => {
  const lista = (src, nombre) => JSON.parse(new RegExp('var ' + nombre + '\\s*=\\s*(\\[[^\\]]*\\])').exec(src)[1].replace(/'/g, '"'));
  test('MODULOS_DEPOSITO es la misma lista en Compras y en Depositos', () => {
    assert.deepStrictEqual(lista(leer('subatir-app.js'), 'MODULOS_DEPOSITO').sort(),
                           lista(leer('deposito/deposito-app.js'), 'MODULOS_DEPOSITO').sort());
  });
  test('cada pagina de Compras tiene modulo en PAGE_MODULE (si no, cae en dashboard)', () => {
    const bloque = /var PAGE_MODULE = \{([\s\S]*?)\};/.exec(leer('subatir-app.js'))[1];
    const mapeadas = (bloque.match(/'([\w.-]+\.html)'/g) || []).map(s => s.slice(1, -1));
    for (const pg of paginas.filter(p => !p.includes('/') && p !== 'login.html')) {
      assert.ok(mapeadas.includes(pg), pg + ' no está en PAGE_MODULE');
    }
  });
  test('cada link del menu (nav.js) apunta a una pagina que existe', () => {
    const hrefs = (leer('nav.js').match(/href:\s*'([^']+)'/g) || []).map(s => /'([^']+)'/.exec(s)[1]);
    assert.ok(hrefs.length > 5);
    for (const h of hrefs) assert.ok(existe(h), 'nav.js -> ' + h);
  });
});

describe('Modulos JS sueltos', () => {
  const js = fs.readdirSync(RAIZ).filter(f => f.endsWith('.js'))
    .concat(['deposito/deposito-app.js', 'deposito/nav.js', 'deposito/sw.js']);
  for (const f of js) {
    test(f + ' parsea', () => { assert.doesNotThrow(() => new vm.Script(leer(f), { filename: f })); });
  }
});
