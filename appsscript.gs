// ============================================================
//  SUBATIR — Dashboard Compras  |  Google Apps Script Backend
//  v3 — con CONTINGENCIA
//  Spreadsheet ID: 1wAH9xj48JuA_nHcihIqMrFXWd2ShVZVMW_k8yfy8WNM
// ============================================================

var SPREADSHEET_ID = '1wAH9xj48JuA_nHcihIqMrFXWd2ShVZVMW_k8yfy8WNM';
var IVA_RATE = 1.22; // Uruguay IVA 22%

// ── Punto de entrada ─────────────────────────────────────────
function doGet(e) {
  try {
    var params   = e ? (e.parameter || {}) : {};
    var action   = params.action   || 'getData';
    var callback = params.callback || ''; // JSONP support (para file://)
    var ss       = SpreadsheetApp.openById(SPREADSHEET_ID);

    var result;
    if      (action === 'getData')              result = buildPayload(ss);
    else if (action === 'getContingencia')      result = getContingencia(ss);
    else if (action === 'updateContingencia')   result = updateContingencia(ss, params);
    else if (action === 'updatePedido')         result = updatePedido(ss, params);
    else if (action === 'addPedido')            result = addPedido(ss, params);
    else if (action === 'deletePedido')         result = deletePedido(ss, params);
    // ── Acciones genéricas de escritura (Precios, Proveedores, Stock, Contingencia) ──
    else if (action === 'updateRow')            result = updateRow(ss, params);
    else if (action === 'addRow')               result = addRow(ss, params);
    else if (action === 'deleteRow')            result = deleteRow(ss, params);
    else result = { error: 'Acción desconocida: ' + action };

    var jsonStr = JSON.stringify(result);
    if (callback) {
      // JSONP: el navegador lo ejecuta como <script>, sin restricciones CORS
      return ContentService
        .createTextOutput(callback + '(' + jsonStr + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return json(result);
  } catch (err) {
    return json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════
//  LECTURA
// ══════════════════════════════════════════════════════════════

function buildPayload(ss) {
  var sheets = ss.getSheets();
  var names  = sheets.map(function(s){ return s.getName(); });

  function findAndLog(label, keywords) {
    var sheet = findSheet(sheets, keywords);
    Logger.log(label + ': ' + (sheet ? sheet.getName() : 'NO ENCONTRADA'));
    return sheet ? parseSheet(sheet) : [];
  }

  var contSheet = ss.getSheetByName('CONTINGENCIA');

  return {
    timestamp    : new Date().toISOString(),
    sheetNames   : names,
    pedidos      : findAndLog('PEDIDOS',    ['OC', 'RECEPC', 'PEDIDO', 'ORDEN']),
    inventario   : findAndLog('INVENTARIO', ['COMPRA', 'INVENTARIO', 'GESTI']),
    stock        : findAndLog('STOCK',      ['INVENTAR', 'CONTROL', 'STOCK']),
    precios      : findAndLog('PRECIOS',    ['PRECIO', 'COMPARATIV', 'LISTA', 'CATALOGO']),
    historial    : findAndLog('HISTORIAL',  ['AVANCE', 'HISTOR', 'TRACKING']),
    contactos    : findAndLog('CONTACTOS',  ['CONTACT', 'DIREC']),
    contingencia : contSheet ? parseSheet(contSheet) : []
  };
}

function getContingencia(ss) {
  var sheet = ss.getSheetByName('CONTINGENCIA');
  if (!sheet) return { error: 'Hoja CONTINGENCIA no encontrada' };
  return { contingencia: parseSheet(sheet) };
}

function updateContingencia(ss, params) {
  var sheet = ss.getSheetByName('CONTINGENCIA');
  if (!sheet) return { error: 'Hoja CONTINGENCIA no encontrada' };

  var rowNum = parseInt(params.row);
  if (!rowNum || isNaN(rowNum)) return { error: 'Número de fila inválido' };

  var fields;
  try { fields = JSON.parse(params.fields || '{}'); }
  catch(e) { return { error: 'JSON inválido: ' + e.message }; }

  var data      = sheet.getDataRange().getValues();
  var headerIdx = findHeaderRow(data);
  var headers   = data[headerIdx].map(function(h){ return String(h).trim().replace(/\r?\n/g,' ').replace(/\s+/g,' '); });

  var updated = [];
  Object.keys(fields).forEach(function(col) {
    var idx = headers.indexOf(col);
    if (idx >= 0) {
      sheet.getRange(rowNum, idx + 1).setValue(fields[col]);
      updated.push(col);
    }
  });

  if (updated.length > 0) SpreadsheetApp.flush();
  return { success: true, row: rowNum, updated: updated };
}

function parseNamedSheet(sheets, keywords) {
  var sheet = findSheet(sheets, keywords);
  return sheet ? parseSheet(sheet) : [];
}

function findSheet(sheets, keywords) {
  for (var i = 0; i < sheets.length; i++) {
    var name = normalize(sheets[i].getName());
    for (var k = 0; k < keywords.length; k++) {
      if (name.indexOf(keywords[k]) >= 0) return sheets[i];
    }
  }
  return null;
}

function parseSheet(sheet) {
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  var headerIdx = findHeaderRow(data);
  var headers   = data[headerIdx].map(function(h){
    return String(h).trim().replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
  });

  var rows = [];
  for (var r = headerIdx + 1; r < data.length; r++) {
    var row = data[r];
    if (row.every(function(c){ return c === '' || c === null; })) continue;
    var obj = {};
    headers.forEach(function(h, i){
      var v = row[i];
      obj[h] = (v instanceof Date)
        ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : (v === null || v === undefined ? '' : v);
    });
    obj['__row'] = r + 1; // número de fila en Sheets (1-indexed)
    rows.push(obj);
  }
  return rows;
}

function findHeaderRow(data) {
  for (var i = 0; i < Math.min(8, data.length); i++) {
    var filled = data[i].filter(function(c){ return c !== '' && c !== null; }).length;
    if (filled >= 3) return i;
  }
  return 0;
}

// ══════════════════════════════════════════════════════════════
//  ESCRITURA — Actualizar pedido existente
// ══════════════════════════════════════════════════════════════

function updatePedido(ss, params) {
  var sheet = findSheet(ss.getSheets(), ['OC', 'RECEPC', 'PEDIDO', 'ORDEN']);
  if (!sheet) return { error: 'Hoja de pedidos no encontrada' };

  var data      = sheet.getDataRange().getValues();
  var headerIdx = findHeaderRow(data);
  var headers   = data[headerIdx].map(function(h){ return String(h).trim().replace(/\r?\n/g,' '); });

  var colOrden  = colIdx(headers, ['N° Orden','N Orden','Orden']);
  if (colOrden < 0) return { error: 'Columna N° Orden no encontrada' };

  var targetRow = -1;
  for (var r = headerIdx + 1; r < data.length; r++) {
    if (String(data[r][colOrden]).trim() === String(params.orden).trim()) {
      targetRow = r + 1; // 1-indexed para Sheets
      break;
    }
  }
  if (targetRow < 0) return { error: 'Orden ' + params.orden + ' no encontrada en la hoja' };

  var updated = [];
  setCell(sheet, targetRow, headers, ['F.Recepción','F. Recepción','Recepcion','RECEPCION'], params.recepcion, updated);
  setCell(sheet, targetRow, headers, ['Lote','LOTE','lote'],                                  params.lote,      updated);
  setCell(sheet, targetRow, headers, ['COA','coa'],                                           params.coa,       updated);
  setCell(sheet, targetRow, headers, ['Conforme','CONFORME','conforme'],                      params.conforme,  updated);
  setCell(sheet, targetRow, headers, ['Observaciones','OBSERVACIONES','Obs.'],                params.obs,       updated);

  SpreadsheetApp.flush();
  return { success: true, orden: params.orden, row: targetRow, updated: updated };
}

// ══════════════════════════════════════════════════════════════
//  ESCRITURA — Agregar nuevo pedido
// ══════════════════════════════════════════════════════════════

function addPedido(ss, params) {
  var sheet = findSheet(ss.getSheets(), ['OC', 'RECEPC', 'PEDIDO', 'ORDEN']);
  if (!sheet) return { error: 'Hoja de pedidos no encontrada' };

  var data      = sheet.getDataRange().getValues();
  var headerIdx = findHeaderRow(data);
  var headers   = data[headerIdx].map(function(h){ return String(h).trim().replace(/\r?\n/g,' '); });

  var colOrden = colIdx(headers, ['N° Orden','N Orden','Orden']);
  var maxOrden = 500;
  if (colOrden >= 0) {
    for (var r = headerIdx + 1; r < data.length; r++) {
      var n = parseInt(data[r][colOrden]);
      if (!isNaN(n) && n > maxOrden) maxOrden = n;
    }
  }
  var newOrden = maxOrden + 1;

  var newRow = new Array(headers.length).fill('');

  function setCol(candidates, value) {
    var idx = colIdx(headers, candidates);
    if (idx >= 0 && value !== undefined && value !== null && value !== '') newRow[idx] = value;
  }

  var cantidad = parseFloat(params.cantidad) || 0;
  var precio   = parseFloat(params.precio)   || 0;
  var siva     = cantidad * precio;
  var civa     = siva * IVA_RATE;

  setCol(['N° Orden','N Orden','Orden'],                                    newOrden);
  setCol(['Fecha','FECHA'],                                                  params.fecha || formatToday());
  setCol(['Proveedor','PROVEEDOR'],                                          params.proveedor);
  setCol(['Cantidad','CANTIDAD'],                                            cantidad);
  setCol(['Descripción','Descripcion','DESCRIPCION','DESCRIPCIÓN'],          params.descripcion);
  setCol(['Precio un','PRECIO UN','precio un'],                              precio);
  setCol(['s/iva','S/IVA','s/IVA'],                                          siva.toFixed(2));
  setCol(['c/iva','C/IVA','c/IVA'],                                          civa.toFixed(2));
  setCol(['F. Vto','F.Vto','VTO','vto'],                                     params.vto);
  setCol(['Observaciones','OBSERVACIONES','Obs.'],                           params.obs);

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
  SpreadsheetApp.flush();

  return { success: true, orden: newOrden, row: lastRow + 1 };
}

// ══════════════════════════════════════════════════════════════
//  ESCRITURA — Eliminar pedido (limpia la fila)
// ══════════════════════════════════════════════════════════════

function deletePedido(ss, params) {
  var sheet = findSheet(ss.getSheets(), ['OC', 'RECEPC', 'PEDIDO', 'ORDEN']);
  if (!sheet) return { error: 'Hoja de pedidos no encontrada' };

  var data      = sheet.getDataRange().getValues();
  var headerIdx = findHeaderRow(data);
  var headers   = data[headerIdx].map(function(h){ return String(h).trim().replace(/\r?\n/g,' '); });
  var colOrden  = colIdx(headers, ['N° Orden','N Orden','Orden']);

  for (var r = headerIdx + 1; r < data.length; r++) {
    if (String(data[r][colOrden]).trim() === String(params.orden).trim()) {
      sheet.deleteRow(r + 1);
      SpreadsheetApp.flush();
      return { success: true, orden: params.orden };
    }
  }
  return { error: 'Orden ' + params.orden + ' no encontrada' };
}

// ══════════════════════════════════════════════════════════════
//  ESCRITURA GENÉRICA — por hoja + fila (Precios, Proveedores, Stock…)
//  Reutilizable por cualquier módulo. La hoja se identifica con
//  sheetKey (mismas palabras clave que buildPayload) o nombre exacto.
// ══════════════════════════════════════════════════════════════

// Mismas palabras clave que usa buildPayload para localizar cada hoja,
// así la escritura apunta EXACTAMENTE a la hoja de la que se leyó.
function sheetKeywords(key) {
  var map = {
    pedidos      : ['OC', 'RECEPC', 'PEDIDO', 'ORDEN'],
    inventario   : ['COMPRA', 'INVENTARIO', 'GESTI'],
    stock        : ['INVENTAR', 'CONTROL', 'STOCK'],
    precios      : ['PRECIO', 'COMPARATIV', 'LISTA', 'CATALOGO'],
    historial    : ['AVANCE', 'HISTOR', 'TRACKING'],
    contactos    : ['CONTACT', 'DIREC'],
    proveedores  : ['CONTACT', 'DIREC', 'PROVEEDOR']
  };
  return map[String(key).toLowerCase()] || null;
}

function resolveSheet(ss, sheetKey) {
  if (!sheetKey) return null;
  if (String(sheetKey).toUpperCase() === 'CONTINGENCIA')
    return ss.getSheetByName('CONTINGENCIA');
  var kws = sheetKeywords(sheetKey);
  if (kws) return findSheet(ss.getSheets(), kws);
  return ss.getSheetByName(sheetKey); // fallback: nombre exacto
}

// Devuelve {sheet, headers, headerIdx} o null
function sheetHeaders(sheet) {
  var data      = sheet.getDataRange().getValues();
  var headerIdx = findHeaderRow(data);
  var headers   = data[headerIdx].map(function(h){
    return String(h).trim().replace(/\r?\n/g,' ').replace(/\s+/g,' ');
  });
  return { data: data, headers: headers, headerIdx: headerIdx };
}

// Localiza el índice de una columna: exacto primero, luego difuso (colIdx)
function headerIndex(headers, col) {
  var idx = headers.indexOf(col);
  if (idx < 0) idx = colIdx(headers, [col]);
  return idx;
}

// ── Actualizar celdas de una fila existente ──────────────────────
// params: sheetKey, row (nº fila en Sheets, 1-indexed), fields (JSON {columna:valor})
function updateRow(ss, params) {
  var sheet = resolveSheet(ss, params.sheetKey);
  if (!sheet) return { error: 'Hoja no encontrada: ' + params.sheetKey };

  var rowNum = parseInt(params.row);
  if (!rowNum || isNaN(rowNum)) return { error: 'Número de fila inválido' };

  var fields;
  try { fields = JSON.parse(params.fields || '{}'); }
  catch(e) { return { error: 'JSON inválido: ' + e.message }; }

  var h = sheetHeaders(sheet);
  var updated = [], missing = [];
  Object.keys(fields).forEach(function(col) {
    var idx = headerIndex(h.headers, col);
    if (idx >= 0) { sheet.getRange(rowNum, idx + 1).setValue(fields[col]); updated.push(col); }
    else missing.push(col);
  });

  if (updated.length > 0) SpreadsheetApp.flush();
  return { success: true, sheet: sheet.getName(), row: rowNum, updated: updated, missing: missing };
}

// ── Agregar una fila nueva ───────────────────────────────────────
// params: sheetKey, fields (JSON {columna:valor})
function addRow(ss, params) {
  var sheet = resolveSheet(ss, params.sheetKey);
  if (!sheet) return { error: 'Hoja no encontrada: ' + params.sheetKey };

  var fields;
  try { fields = JSON.parse(params.fields || '{}'); }
  catch(e) { return { error: 'JSON inválido: ' + e.message }; }

  var h = sheetHeaders(sheet);
  var newRow = new Array(h.headers.length).fill('');
  var setCols = [], missing = [];
  Object.keys(fields).forEach(function(col) {
    var idx = headerIndex(h.headers, col);
    if (idx >= 0) { newRow[idx] = fields[col]; setCols.push(col); }
    else missing.push(col);
  });

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
  SpreadsheetApp.flush();
  return { success: true, sheet: sheet.getName(), row: lastRow + 1, set: setCols, missing: missing };
}

// ── Eliminar una fila ────────────────────────────────────────────
// params: sheetKey, row (nº fila en Sheets)
// Vacía las celdas en lugar de borrar la fila físicamente: así los
// números de fila de otros cambios pendientes del MISMO lote no se
// desplazan. parseSheet ignora las filas totalmente vacías, por lo
// que desaparece de la app y de los cálculos.
function deleteRow(ss, params) {
  var sheet = resolveSheet(ss, params.sheetKey);
  if (!sheet) return { error: 'Hoja no encontrada: ' + params.sheetKey };

  var rowNum = parseInt(params.row);
  if (!rowNum || isNaN(rowNum)) return { error: 'Número de fila inválido' };

  var lastCol = sheet.getLastColumn();
  if (lastCol > 0) sheet.getRange(rowNum, 1, 1, lastCol).clearContent();
  SpreadsheetApp.flush();
  return { success: true, sheet: sheet.getName(), row: rowNum };
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function colIdx(headers, candidates) {
  for (var c = 0; c < candidates.length; c++) {
    for (var h = 0; h < headers.length; h++) {
      if (headers[h].indexOf(candidates[c]) >= 0 || candidates[c].indexOf(headers[h]) >= 0) return h;
    }
  }
  return -1;
}

function setCell(sheet, row, headers, candidates, value, updated) {
  if (value === undefined || value === null) return;
  var idx = colIdx(headers, candidates);
  if (idx < 0) return;
  sheet.getRange(row, idx + 1).setValue(value);
  updated.push(candidates[0]);
}

function normalize(s) {
  return String(s).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'');
}

function formatToday() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Test local ────────────────────────────────────────────────
function testLocal() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var p  = buildPayload(ss);
  Logger.log('═══ HOJAS DISPONIBLES ═══');
  Logger.log(p.sheetNames.join(' | '));
  Logger.log('═══ RESULTADO ═══');
  Logger.log('Pedidos:      ' + p.pedidos.length      + ' filas');
  Logger.log('Inventario:   ' + p.inventario.length   + ' filas (COMPRAS)');
  Logger.log('Stock:        ' + p.stock.length        + ' filas');
  Logger.log('Precios:      ' + p.precios.length      + ' filas');
  Logger.log('Historial:    ' + p.historial.length    + ' filas');
  Logger.log('Contactos:    ' + p.contactos.length    + ' filas');
  Logger.log('Contingencia: ' + p.contingencia.length + ' filas');
  if (p.pedidos.length > 0)       Logger.log('COLS pedidos: '       + Object.keys(p.pedidos[0]).join(' | '));
  if (p.inventario.length > 0)    Logger.log('COLS inventario: '    + Object.keys(p.inventario[0]).join(' | '));
  if (p.precios.length > 0)       Logger.log('COLS precios: '       + Object.keys(p.precios[0]).join(' | '));
  if (p.contingencia.length > 0)  Logger.log('COLS contingencia: '  + Object.keys(p.contingencia[0]).join(' | '));
}
