// ============================================================
//  Service worker de Depósitos (PWA)
//
//  Existe para dos cosas: que la app se pueda instalar en el
//  celular y que abra aunque el wifi del depósito se caiga.
//  NO está para acelerar cargas a costa de mostrar datos viejos.
//
//  Por eso la estrategia es distinta según qué se pide:
//
//   · version.json  → SÓLO red, nunca cache. Es el archivo que le
//     dice a la pestaña que hay una versión nueva; si lo sirviera
//     el cache, el chequeo de versión dejaría de funcionar y
//     volveríamos al problema que vino a resolver.
//   · el documento HTML → red primero, cache de respaldo. Un
//     deploy se ve enseguida, y sin señal igual abre la última
//     versión que se vio.
//   · imágenes y JS propios → cache primero y se refrescan de
//     fondo (stale-while-revalidate). Son los que no cambian entre
//     deploys salvo que se bumpee su ?v=.
//   · CDN (three.js, el lector de QR, supabase-js) → se dejan
//     pasar sin tocar. Guardarlos daría respuestas opacas que no
//     se pueden validar, y el navegador ya las cachea bien solo.
//
//  APP_VER lo reescribe bump-version.ps1 en cada publicación: al
//  cambiar el archivo, el navegador instala el worker nuevo y
//  descarta el cache viejo.
// ============================================================
self.APP_VER = '2026-11-28.0137';
var CACHE = 'deposito-' + self.APP_VER;

// Lo mínimo para que la app abra sin señal.
var SHELL = ['./', './index.html', './solicitar.html', './recorrido.html', './movil.css', './deposito-app.js', '../supabase-config.js', '../tema.js',
             './nav.js', './nav.css',
             './icon-192.png', './icon-512.png', '../logo.jpg'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si UNO solo falla; se agregan de a uno para
      // que un archivo movido no deje la app sin service worker.
      .then(function (c) { return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { });
      })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        return k !== CACHE ? caches.delete(k) : null;   // se va el de la versión anterior
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Otro origen (CDN, Supabase): sin intervenir. Las llamadas a la base
  // NUNCA se cachean — mostrarían stock que ya no es.
  if (url.origin !== self.location.origin) return;

  // El archivo que gobierna las actualizaciones: siempre de la red.
  if (url.pathname.indexOf('version.json') >= 0) return;

  // El manifest tampoco: no tiene ?v= que subir, y si se cachea, un
  // cambio ahi (orientacion, nombre, iconos) no llega nunca al telefono.
  if (url.pathname.indexOf('manifest.json') >= 0) return;

  // Documento: red primero, cache si no hay señal.
  //  cache:'no-cache' = siempre se le pregunta al servidor si cambió (si
  //  no cambió contesta 304 y no se baja de nuevo). Sin esto, el navegador
  //  usaba su copia de hasta 10 min (GitHub Pages: max-age=600): después de
  //  un deploy, ir por el menú a otra página abría la versión vieja y el
  //  cartel de "versión nueva" volvía sin parar (25/11/2026).
  //  Una respuesta redirigida no se le puede devolver a una navegación: si
  //  alguna dirección redirige, se repite el pedido original y el navegador
  //  sigue la redirección solo. Eso no se guarda.
  //  Sólo se guarda una página que llegó bien (200): un 404 o un 5xx de un
  //  instante (durante un deploy) pisaría la copia buena para usar sin señal.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) {
        if (r.redirected) return fetch(req);
        if (r.status === 200) {
          var copy = r.clone();
          caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () { });
        }
        return r;
      }).catch(function () {
        return caches.match(req).then(function (m) { return m || caches.match('./index.html'); });
      })
    );
    return;
  }

  // Estático propio: se responde del cache y se refresca de fondo.
  ev.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && r.status === 200) {
          var copy = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
