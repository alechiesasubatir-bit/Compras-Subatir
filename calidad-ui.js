// ============================================================
//  CALIDAD MP — piezas de pantalla compartidas por calidad.html y
//  calidad-imp.html:
//
//   · Miniaturas: la primera hoja de cada PDF (o la foto) dibujada con
//     pdf.js. Se piden sólo cuando la tarjeta entra en pantalla, de a
//     tres por vez, y quedan en memoria: al filtrar no se vuelven a
//     bajar.
//   · Visor: el documento adentro de la app, con sus versiones al
//     costado. Se dibuja con pdf.js y no con un <iframe> porque el
//     Chrome del celular no muestra PDFs dentro de un iframe.
//   · countUp: los números de los KPI suben en vez de aparecer.
//
//  El bucket es privado: todo pasa por URLs firmadas de 5 minutos.
// ============================================================
(function () {
  'use strict';

  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var BUCKET = 'calidad-mp';
  var QUIETO = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function aviso(msg, tipo) { if (typeof window.toast === 'function') window.toast(msg, tipo); }
  function fechaCorta(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); }

  // ── pdf.js: se carga la primera vez que hace falta ──────────
  var _pdf = null;
  function pdfjs() {
    if (_pdf) return _pdf;
    _pdf = new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        ok(window.pdfjsLib);
      };
      s.onerror = function () { _pdf = null; mal(new Error('No se pudo cargar el lector de PDF')); };
      document.head.appendChild(s);
    });
    return _pdf;
  }

  function esImagen(x) {
    var n = String((x && (x.nombre_archivo || x.name || x.archivo)) || '').toLowerCase();
    return (x && /^image\//.test(x.type || '')) || /\.(jpe?g|png|webp)$/.test(n);
  }

  // ── URLs firmadas (duran 5 min; se reusan 4) ────────────────
  var _urls = {};
  function firmada(doc) {
    var c = _urls[doc.archivo];
    if (c && c.hasta > Date.now()) return Promise.resolve(c.url);
    return SB.storage.from(BUCKET).createSignedUrl(doc.archivo, 300).then(function (r) {
      if (r.error || !r.data) throw new Error(r.error ? r.error.message : 'sin URL');
      _urls[doc.archivo] = { url: r.data.signedUrl, hasta: Date.now() + 240000 };
      return r.data.signedUrl;
    });
  }

  // ── Miniaturas ──────────────────────────────────────────────
  // Una cola de a 3: con 70 tarjetas en pantalla, pedir todo junto
  // traba la conexión del celular y las primeras tardan más.
  var cola = [], activos = 0, MAX = 3;
  function encolar(fn) {
    return new Promise(function (ok, mal) { cola.push({ fn: fn, ok: ok, mal: mal }); correr(); });
  }
  function correr() {
    while (activos < MAX && cola.length) {
      var t = cola.shift(); activos++;
      t.fn().then(t.ok, t.mal).then(function () { activos--; correr(); });
    }
  }

  function primeraHoja(src, ancho) {
    return pdfjs().then(function (lib) {
      // Para la miniatura alcanza con la primera hoja: sin esto pdf.js
      // baja el PDF entero (hay fichas de varios MB) y la cola se arrastra
      if (typeof src === 'string') src = { url: src, disableAutoFetch: true, disableStream: true };
      return lib.getDocument(src).promise.then(function (pdf) {
        return pdf.getPage(1).then(function (pg) {
          var v = pg.getViewport({ scale: 1 });
          var vp = pg.getViewport({ scale: ancho / v.width });
          var cv = document.createElement('canvas');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () {
            var url = cv.toDataURL('image/jpeg', 0.82);
            pdf.destroy();
            return url;
          });
        });
      });
    });
  }

  // Las miniaturas de PDF quedan guardadas en el equipo: un documento no
  // cambia nunca con el mismo id (reemplazarlo es borrar y cargar otro),
  // así que la segunda vez aparecen al instante. Si el almacenamiento se
  // llena o no está, se sigue sin guardar.
  var LS_MINI = 'calidadMP.mini.';
  function miniGuardada(id) { try { return localStorage.getItem(LS_MINI + id); } catch (e) { return null; } }
  function guardarMini(id, url) {
    try { localStorage.setItem(LS_MINI + id, url); }
    catch (e) {   // lleno: se vacían las miniaturas guardadas y se reintenta una vez
      try {
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf(LS_MINI) === 0) localStorage.removeItem(k); });
        localStorage.setItem(LS_MINI + id, url);
      } catch (e2) { }
    }
  }
  function borrarMini(id) { delete _mini[id]; try { localStorage.removeItem(LS_MINI + id); } catch (e) { } }

  var _mini = {};   // id del documento → Promise<url de la imagen>
  function miniDoc(doc) {
    if (!_mini[doc.id]) {
      var g = !esImagen(doc) && miniGuardada(doc.id);
      _mini[doc.id] = g ? Promise.resolve(g) : encolar(function () {
        return firmada(doc).then(function (url) {
          if (esImagen(doc)) return url;   // la foto se muestra tal cual (la URL firmada vence: no se guarda)
          return primeraHoja(url, 280).then(function (img) { guardarMini(doc.id, img); return img; });
        });
      });
      _mini[doc.id].catch(function () { delete _mini[doc.id]; });
    }
    return _mini[doc.id];
  }
  function miniArchivo(file) {
    if (esImagen(file)) return Promise.resolve(URL.createObjectURL(file));
    return encolar(function () {
      return file.arrayBuffer().then(function (buf) { return primeraHoja({ data: new Uint8Array(buf) }, 200); });
    });
  }

  function pintar(el, prom) {
    prom.then(function (url) {
      var img = new Image();
      img.alt = '';
      img.onload = function () { el.classList.add('ok'); };
      img.onerror = function () { el.classList.add('err'); el.textContent = '📄'; };
      img.src = url;
      el.innerHTML = ''; el.appendChild(img);
    }, function () { el.classList.add('err'); el.textContent = '📄'; });
  }

  // Busca .thumb[data-doc] dentro de root y las llena al verse.
  // docDe(id) devuelve el documento (cada página tiene el suyo).
  var _io = null, _docDe = null;
  function miniaturas(root, docDe) {
    _docDe = docDe;
    var els = (root || document).querySelectorAll('.thumb[data-doc]:not([data-v])');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { cargarEl(el, docDe); });
      return;
    }
    if (!_io) {
      _io = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) {
          if (e.isIntersecting) { _io.unobserve(e.target); cargarEl(e.target, e.target._docDe); }
        });
      }, { rootMargin: '200px' });
    }
    els.forEach(function (el) { el.setAttribute('data-v', '1'); el._docDe = docDe; _io.observe(el); });
  }
  function cargarEl(el, docDe) {
    var d = (docDe || _docDe) && (docDe || _docDe)(+el.getAttribute('data-doc'));
    if (!d) { el.classList.add('err'); el.textContent = '📄'; return; }
    pintar(el, miniDoc(d));
  }
  function thumbHtml(doc, extra) {
    return '<div class="thumb ' + (extra || '') + '" data-doc="' + doc.id + '"></div>';
  }

  // ── Números que suben ───────────────────────────────────────
  function countUp(el, fin, sufijo) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    sufijo = sufijo || '';
    fin = +fin || 0;
    var desde = +(el.getAttribute('data-n') || 0);
    el.setAttribute('data-n', fin);
    if (QUIETO || desde === fin) { el.textContent = fin + sufijo; return; }
    var t0 = performance.now(), dur = 700;
    (function paso(t) {
      var k = Math.min(1, Math.max(0, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(desde + (fin - desde) * e) + sufijo;
      if (k < 1) requestAnimationFrame(paso);
    })(t0);
  }

  // ── Abrir en otra pestaña / bajar ───────────────────────────
  // La ventana se abre ANTES de pedir la URL, dentro del click: si se
  // abre después de esperar, el navegador la toma por popup y la bloquea.
  function pestana(doc) {
    var w = window.open('', '_blank');
    if (w) w.document.write('<p style="font-family:sans-serif;color:#555">Abriendo ' + esc(doc.nombre_archivo || 'documento') + '…</p>');
    firmada(doc).then(function (url) { if (w) w.location.href = url; else location.href = url; },
      function (e) { if (w) w.close(); aviso('No se pudo abrir: ' + e.message, 'err'); });
  }
  function bajar(doc) {
    firmada(doc).then(function (url) { return fetch(url); }).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = doc.nombre_archivo || 'documento';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }).catch(function (e) { aviso('No se pudo bajar: ' + (e && e.message || e), 'err'); });
  }

  // ── Visor ───────────────────────────────────────────────────
  var TIPO = { FT: 'Ficha técnica', HDS: 'Hoja de seguridad', COA: 'COA', OTRO: 'Documento' };
  var V = { lista: [], i: 0, op: {}, turno: 0, borrar: null };

  function armarVisor() {
    if (document.getElementById('vis')) return;
    var d = document.createElement('div');
    d.id = 'vis'; d.className = 'vis'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML =
      '<div class="vis-top">'
      + '<span class="vis-tag" id="vis-tag"></span>'
      + '<div class="vis-tt"><b id="vis-t"></b><span id="vis-s"></span></div>'
      + '<div class="vis-nav">'
      + '<button class="vis-ib" id="vis-prev" title="Anterior (←)" aria-label="Anterior">‹</button>'
      + '<span class="vis-pos" id="vis-pos"></span>'
      + '<button class="vis-ib" id="vis-next" title="Siguiente (→)" aria-label="Siguiente">›</button>'
      + '<button class="vis-ib" id="vis-ext" title="Abrir en otra pestaña" aria-label="Abrir en otra pestaña">↗</button>'
      + '<button class="vis-ib" id="vis-x" title="Cerrar (Esc)" aria-label="Cerrar">✕</button>'
      + '</div></div>'
      + '<div class="vis-main"><div class="vis-pages" id="vis-pages"></div>'
      + '<aside class="vis-side" id="vis-side"></aside></div>';
    document.body.appendChild(d);
    document.getElementById('vis-prev').onclick = function () { mover(-1); };
    document.getElementById('vis-next').onclick = function () { mover(1); };
    document.getElementById('vis-x').onclick = cerrarVisor;
    document.getElementById('vis-ext').onclick = function () { pestana(V.lista[V.i]); };
    d.addEventListener('click', function (e) { if (e.target === d || e.target.id === 'vis-pages') cerrarVisor(); });
    // En captura: el Escape del visor no tiene que cerrar además el
    // modal que quedó abajo
    document.addEventListener('keydown', function (e) {
      if (!d.classList.contains('open')) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); cerrarVisor(); }
      else if (e.key === 'ArrowLeft') mover(-1);
      else if (e.key === 'ArrowRight') mover(1);
    }, true);
  }

  /**
   * @param {Array} lista  documentos que se recorren con ← →
   * @param {number} i     el que se abre
   * @param {Object} op    { titulo(doc), sub(doc), versiones(doc):Array,
   *                         puedeBorrar:bool, onBorrar(doc):Promise }
   */
  function abrirVisor(lista, i, op) {
    armarVisor();
    V.lista = (lista || []).slice(); V.i = Math.max(0, Math.min(i || 0, V.lista.length - 1)); V.op = op || {};
    document.getElementById('vis').classList.add('open');
    document.body.style.overflow = 'hidden';
    mostrar();
  }
  function cerrarVisor() {
    var d = document.getElementById('vis'); if (!d) return;
    d.classList.remove('open'); document.body.style.overflow = '';
    V.turno++;   // corta un dibujo a medias
    document.getElementById('vis-pages').innerHTML = '';
  }
  function mover(k) {
    var n = V.i + k;
    if (n < 0 || n >= V.lista.length) return;
    V.i = n; mostrar();
  }
  // Cambiar a otra versión del mismo papel sin perder la lista
  function verVersion(id) {
    var ds = (V.op.versiones ? V.op.versiones(V.lista[V.i]) : []).filter(function (d) { return d.id === id; });
    if (!ds.length) return;
    V.lista[V.i] = ds[0]; mostrar();
  }

  function mostrar() {
    var d = V.lista[V.i]; if (!d) { cerrarVisor(); return; }
    var op = V.op, turno = ++V.turno;
    var tag = document.getElementById('vis-tag');
    tag.className = 'vis-tag ' + d.tipo; tag.textContent = d.tipo === 'OTRO' ? 'DOC' : d.tipo;
    document.getElementById('vis-t').textContent = op.titulo ? op.titulo(d) : (d.articulo || d.nombre_archivo);
    document.getElementById('vis-s').textContent = op.sub ? op.sub(d) : (d.nombre_archivo || '');
    document.getElementById('vis-pos').textContent = V.lista.length > 1 ? (V.i + 1) + ' / ' + V.lista.length : '';
    document.getElementById('vis-prev').disabled = V.i <= 0;
    document.getElementById('vis-next').disabled = V.i >= V.lista.length - 1;
    lateral(d);

    var pg = document.getElementById('vis-pages');
    pg.innerHTML = '<div class="vis-msg"><span class="spin"></span> Abriendo ' + esc(d.nombre_archivo || 'documento') + '…</div>';
    pg.scrollTop = 0;
    firmada(d).then(function (url) {
      if (turno !== V.turno) return;
      if (esImagen(d)) {
        var img = new Image(); img.alt = d.nombre_archivo || '';
        img.onload = function () { if (turno === V.turno) { pg.innerHTML = ''; pg.appendChild(img); } };
        img.src = url;
        return;
      }
      return pdfjs().then(function (lib) { return lib.getDocument(url).promise; }).then(function (pdf) {
        if (turno !== V.turno) { pdf.destroy(); return; }
        pg.innerHTML = '';
        var ancho = Math.max(240, Math.min(pg.clientWidth - 24, 920)), n = Math.min(pdf.numPages, 40);
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        // De a una hoja: la primera se ve enseguida y las demás llegan
        var hoja = function (k) {
          if (k > n || turno !== V.turno) return Promise.resolve();
          return pdf.getPage(k).then(function (p) {
            var v = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: ancho / v.width * dpr });
            var cv = document.createElement('canvas');
            cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
            cv.style.width = Math.round(vp.width / dpr) + 'px';
            pg.appendChild(cv);
            return p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          }).then(function () { return hoja(k + 1); });
        };
        return hoja(1).then(function () {
          if (pdf.numPages > n && turno === V.turno)
            pg.insertAdjacentHTML('beforeend', '<div class="vis-msg">Se muestran ' + n + ' de ' + pdf.numPages + ' hojas · abrilo en otra pestaña para verlo entero</div>');
          pdf.destroy();
        });
      });
    }).catch(function (e) {
      if (turno !== V.turno) return;
      pg.innerHTML = '<div class="vis-msg">⚠ No se pudo mostrar (' + esc(e && e.message || e) + '). '
        + '<button class="btn btn-ghost btn-sm" id="vis-ext2">Abrir en otra pestaña</button></div>';
      document.getElementById('vis-ext2').onclick = function () { pestana(d); };
    });
  }

  function lateral(d) {
    var op = V.op, fe = d.fecha_doc || d.mes || '';
    var filas = [
      ['Tipo', d.tipo === 'OTRO' ? (d.titulo || 'Documento') : TIPO[d.tipo]],
      ['Proveedor', d.proveedor || 'todos'],
      ['Revisión', d.revision], ['Lote', d.lote],
      ['Fecha', fe ? fechaCorta(fe) : ''],
      ['Archivo', d.nombre_archivo],
      ['Tamaño', d.bytes ? (d.bytes / 1024 / 1024).toFixed(2) + ' MB' : ''],
      ['Subió', (d.subido_por || '—') + ' · ' + fechaCorta(d.created_at)],
      ['Obs.', d.observaciones]
    ].filter(function (r) { return r[1]; });
    var vers = op.versiones ? op.versiones(d) : [];
    var h = '<h4>Detalle</h4><dl class="vis-meta">'
      + filas.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
    if (vers.length > 1) {
      h += '<h4>Versiones · ' + vers.length + '</h4>' + vers.map(function (v, k) {
        return '<button class="vis-v' + (v.id === d.id ? ' on' : '') + '" data-v="' + v.id + '">'
          + thumbHtml(v) + '<div class="vv"><b>' + (k === 0 ? 'Vigente' : 'Anterior') + (v.revision ? ' · ' + esc(v.revision) : '') + '</b>'
          + '<span>' + esc(fechaCorta(v.fecha_doc || v.created_at)) + '</span></div></button>';
      }).join('');
    }
    h += '<div class="vis-acts">'
      + '<button class="btn btn-teal" id="vis-dl">⬇ Descargar</button>'
      + (op.puedeBorrar ? '<button class="btn btn-ghost" id="vis-del">🗑 Borrar este documento</button>' : '')
      + '</div>';
    var side = document.getElementById('vis-side');
    side.innerHTML = h;
    side.querySelectorAll('.vis-v').forEach(function (b) { b.onclick = function () { verVersion(+b.getAttribute('data-v')); }; });
    miniaturas(side, function (id) { return vers.filter(function (v) { return v.id === id; })[0]; });
    document.getElementById('vis-dl').onclick = function () { bajar(d); };
    var del = document.getElementById('vis-del');
    if (del) del.onclick = function () {
      // Dos toques sobre el mismo botón (sin confirm() nativo)
      if (V.borrar !== d.id) {
        V.borrar = d.id; del.textContent = '¿Seguro? Tocá de nuevo para borrar'; del.style.color = '#fca5a5';
        setTimeout(function () { if (V.borrar === d.id) { V.borrar = null; del.textContent = '🗑 Borrar este documento'; del.style.color = ''; } }, 5000);
        return;
      }
      V.borrar = null; del.disabled = true;
      op.onBorrar(d).then(function () { cerrarVisor(); }, function () { del.disabled = false; });
    };
  }

  // ── Tarjetas y lista: una sola forma para todo Calidad MP ───
  // Las dos pantallas (MP de Stock y MP importadas) dibujan cada
  // documento con estas funciones, así una ficha se ve y se toca igual
  // en las dos. Cada página decide qué hace al tocar (en(): abrir,
  // subir, soltar) y qué "clave" identifica a su fila.

  // Vista (tarjetas o lista): una para todo el módulo. Siempre arranca
  // en Tarjetas (pedido del usuario); si se elige Lista, dura mientras
  // la pestaña esté abierta y se pasa de una pantalla a la otra.
  var SS_VISTA = 'calidadMP.vista';
  try { localStorage.removeItem(SS_VISTA); } catch (e) { }   // la guardaba la versión anterior
  var vista = {
    get: function () { try { return sessionStorage.getItem(SS_VISTA) === 'list' ? 'list' : 'grid'; } catch (e) { return 'grid'; } },
    set: function (v) { try { sessionStorage.setItem(SS_VISTA, v); } catch (e) { } vista.pintar(); },
    // Enciende el botón que corresponde en el selector (#v-grid / #v-list)
    pintar: function () {
      var v = vista.get(), g = document.getElementById('v-grid'), l = document.getElementById('v-list');
      if (g) g.classList.toggle('on', v === 'grid');
      if (l) l.classList.toggle('on', v === 'list');
    }
  };

  // Color de la tarjeta: verde con FT y HDS, rojo sin ninguna, ámbar con
  // una sola. FT y HDS no vencen; el COA no cuenta: no se reclama.
  function estado(f) {
    if (f.ft && f.hds) return 'ok';
    return (!f.ft && !f.hds) ? 'bad' : 'mid';
  }
  function detalle(doc) {
    if (!doc) return 'falta';
    return fechaCorta(doc.fecha_doc || doc.mes || doc.created_at);
  }

  /**
   * Una ficha de la tarjeta.
   * @param {Object} o { doc, tipo:'FT'|'HDS'|'COA', clave, nombre (para el
   *   lector de pantalla), n (versiones), det (texto de abajo), can (puede subir),
   *   neutro (vacío no es "falta": el COA) }
   */
  function tile(o) {
    var doc = o.doc, can = !!o.can, t = TIPO[o.tipo] || o.tipo;
    var cls = 'dtile' + (can ? ' can' : '') + (!doc && !can ? ' nada' : '');
    var body = doc
      ? thumbHtml(doc) + '<span class="zoom" aria-hidden="true">🔍</span>'
        + (o.n > 1 ? '<span class="badge-n" title="' + o.n + ' cargados">×' + o.n + '</span>' : '')  // COA: se guardan todos
      : '<div class="dempty">' + (can ? '<big>＋</big>Subir ' + o.tipo + '<small>o soltá el archivo</small>'
        : '<big>—</big>Sin ' + o.tipo) + '</div>';
    var tt = (doc ? 'Ver ' : can ? 'Subir ' : 'Sin ') + t.toLowerCase();
    var det = o.det != null ? o.det : (doc ? detalle(doc) : (o.neutro ? 'sin cargar' : 'falta'));
    return '<button class="' + cls + '" data-k="' + esc(o.clave) + '" data-t="' + o.tipo + '" data-d="' + (doc ? doc.id : '') + '"'
      + ' title="' + esc(tt) + '" aria-label="' + esc(tt + (o.nombre ? ' · ' + o.nombre : '')) + '"'
      + (!doc && !can ? ' tabindex="-1"' : '') + '>'
      + body + '<div class="dt-l"><span>' + o.tipo + '</span><span>' + esc(det) + '</span></div></button>';
  }

  // Botón chico para subir (una versión nueva o la primera)
  function botonSubir(clave, tipo) {
    var t = 'Subir ' + (TIPO[tipo] || tipo).toLowerCase();
    return '<button class="up" data-k="' + esc(clave) + '" data-up="' + tipo + '" title="' + esc(t) + '" aria-label="' + esc(t) + '">⬆</button>';
  }

  /** Celda de la vista lista: miniatura + chip, con los mismos datos que tile() */
  function celda(o) {
    var up = o.can ? botonSubir(o.clave, o.tipo) : '';
    if (!o.doc) return '<div class="cell">' + (o.neutro ? '<span class="dc dc-mut">sin cargar</span>'
      : '<span class="dc dc-red">✕ falta</span>') + up + '</div>';
    var det = o.det != null ? o.det : detalle(o.doc);
    return '<div class="cell lchip">' + thumbHtml(o.doc)
      + '<button class="dc dc-ok" data-open="' + o.doc.id + '" title="Ver ' + esc(o.doc.nombre_archivo || '') + '">📄 ver'
      + (det ? ' <small>' + esc(det) + '</small>' : '')
      + (o.n > 1 ? ' <small>· ' + o.n + '</small>' : '') + '</button>' + up + '</div>';
  }

  /**
   * Engancha fichas, chips y miniaturas de un contenedor.
   * @param {Object} en { abrir(idDoc), subir(clave, tipo), soltar(clave, tipo, files), puede:bool }
   */
  function enganchar(cont, en) {
    cont.querySelectorAll('.dtile[data-k]').forEach(function (el) {
      var k = el.getAttribute('data-k'), t = el.getAttribute('data-t'), d = +el.getAttribute('data-d');
      el.onclick = function () { if (d) en.abrir(d); else if (en.puede) en.subir(k, t); };
      if (!en.puede) return;
      el.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); el.classList.add('drag'); });
      el.addEventListener('dragleave', function () { el.classList.remove('drag'); });
      el.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation(); el.classList.remove('drag');
        var fs = e.dataTransfer && e.dataTransfer.files;
        if (fs && fs.length) en.soltar(k, t, fs);
      });
    });
    cont.querySelectorAll('[data-up]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); en.subir(b.getAttribute('data-k'), b.getAttribute('data-up')); };
    });
    cont.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { en.abrir(+b.getAttribute('data-open')); }; });
    cont.querySelectorAll('.lchip .thumb').forEach(function (th) { th.onclick = function () { en.abrir(+th.getAttribute('data-doc')); }; });
  }

  // ── FT / HDS nueva: reemplaza a la anterior ─────────────────
  // FT y HDS no guardan versiones: cuando se carga una nueva, la
  // anterior del mismo lugar (MP + proveedor, o artículo importado) se
  // borra, fila y archivo. Se hace DESPUÉS de insertar la nueva: si algo
  // falla a mitad, lo peor que queda es una de más, nunca ninguna.
  // Qué se borra lo decide CalidadMP.aReemplazar (con tests).
  // @returns Promise<number> cuántas se reemplazaron
  function reemplazar(nuevo) {
    if (nuevo.tipo !== 'FT' && nuevo.tipo !== 'HDS') return Promise.resolve(0);
    var q = SB.from('mp_documentos').select('id,tipo,inventario_id,mp_articulo_id,proveedor,archivo').eq('tipo', nuevo.tipo);
    q = nuevo.mp_articulo_id != null ? q.eq('mp_articulo_id', nuevo.mp_articulo_id) : q.eq('inventario_id', nuevo.inventario_id);
    return q.then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var viejos = CalidadMP.aReemplazar(r.data || [], nuevo);
      if (!viejos.length) return 0;
      var ids = viejos.map(function (d) { return d.id; });
      // Por la función de la base: así también reemplaza quien sube sin
      // ser admin (calidad_subir_permiso.sql), sin darle "borrar" en general
      if (nuevo.id != null) {
        return SB.rpc('mp_doc_reemplazar', { p_nuevo: nuevo.id, p_viejos: ids }).then(function (r) {
          if (r.error && (r.error.code === 'PGRST202' || /could not find the function/i.test(r.error.message || ''))) return borrarDirecto(ids, viejos);
          if (r.error) throw new Error(r.error.message);
          var arch = r.data || [];
          viejos.filter(function (d) { return arch.indexOf(d.archivo) >= 0; }).forEach(function (d) { borrarMini(d.id); });
          if (arch.length) SB.storage.from(BUCKET).remove(arch);
          return arch.length;
        });
      }
      return borrarDirecto(ids, viejos);
    });
  }
  // Sin la función en la base (SQL sin correr): como antes, sólo anda para el admin
  function borrarDirecto(ids, viejos) {
      return SB.from('mp_documentos').delete().in('id', ids).select('id').then(function (del) {
        if (del.error) throw new Error(del.error.message);
        var ok = (del.data || []).map(function (d) { return d.id; });
        var arch = viejos.filter(function (d) { return ok.indexOf(d.id) >= 0; }).map(function (d) { return d.archivo; });
        ok.forEach(borrarMini);
        if (arch.length) SB.storage.from(BUCKET).remove(arch);
        return ok.length;
      });
  }

  window.CalidadUI = {
    esc: esc, esImagen: esImagen, firmada: firmada, pestana: pestana, bajar: bajar,
    miniaturas: miniaturas, miniArchivo: miniArchivo, pintar: pintar, thumbHtml: thumbHtml,
    countUp: countUp, visor: { abrir: abrirVisor, cerrar: cerrarVisor },
    vista: vista, estado: estado, detalle: detalle, tile: tile, celda: celda,
    botonSubir: botonSubir, enganchar: enganchar, reemplazar: reemplazar,
    olvidar: borrarMini
  };
})();
