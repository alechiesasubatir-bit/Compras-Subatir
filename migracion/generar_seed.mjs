// Genera migracion/seed.sql a partir de migracion/sheet_backup.json
// Uso:  node migracion/generar_seed.mjs
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(new URL('./sheet_backup.json', import.meta.url), 'utf8'));

// ── Limpieza de valores ──────────────────────────────────────
function txt(v){
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function num(v){
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s === '') return null;
  s = s.replace(/[^\d.,-]/g, '');           // saca U$S, $, %, espacios, letras
  if (s === '' || s === '-' || s === '.' || s === ',') return null;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma)      s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56 → 1234.56
  else if (hasComma)           s = s.replace(',', '.');                     // 1,06 → 1.06
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function date(v){
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ── SQL helpers ──────────────────────────────────────────────
const S  = v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`; // texto/fecha
const N  = v => v === null ? 'NULL' : String(v);                            // numérico

// ── Mapeos hoja → tabla ──────────────────────────────────────
const TABLES = {
  proveedores: {
    cols: ['empresa','nombre_contacto','puesto','email','celular'],
    map: r => [ txt(r['EMPRESA']), txt(r['NOMBRE']), txt(r['PUESTO']), txt(r['MAIL']), txt(r['CELULAR']) ],
    kinds:['t','t','t','t','t'],
    skip: r => !txt(r['EMPRESA']),
    src: 'contactos'
  },
  precios: {
    cols: ['fecha_actualizado','codigo','articulo','cod_prov','proveedor','precio_usd','precio_pesos','atencion','calidad','demora','modalidad_pago'],
    map: r => [ date(r['FECHA ACTUALIZADO']), txt(r['CODIGO']), txt(r['ARTICULO']), txt(r['Cod Prov']), txt(r['PROVEEDOR']),
                num(r['PRECIO S/IVA U$S']), num(r['PRECIO S/IVA $']), txt(r['ATENCION DE VENTA']), txt(r['CALIDAD']),
                txt(r['DEMORA DE ENTREGA']), txt(r['MODALIDAD DE PAGO']) ],
    kinds:['d','t','t','t','t','n','n','t','t','t','t'],
    skip: r => !txt(r['ARTICULO']) && !txt(r['PROVEEDOR']),
    src: 'precios'
  },
  pedidos: {
    cols: ['fecha','n_orden','proveedor','cantidad','descripcion','moneda','precio_un','s_iva','c_iva','f_recepcion','f_vto','lote','coa','conforme'],
    map: r => [ date(r['Fecha']), txt(r['N° Orden']), txt(r['Proveedor']), num(r['Cantidad']), txt(r['Descripción']),
                txt(r['$/U$S']), num(r['Precio un']), num(r['s/iva']), num(r['c/iva']), date(r['F.Recepción']),
                date(r['F. Vto']), txt(r['Lote']), txt(r['COA']), txt(r['Conforme']) ],
    kinds:['d','t','t','n','t','t','n','n','n','d','d','t','t','t'],
    skip: r => !txt(r['Descripción']) && !txt(r['Proveedor']) && !txt(r['N° Orden']),
    src: 'pedidos'
  },
  inventario: {
    cols: ['codigo','descripcion','unidad','presentacion','consumo_mensual','stock_minimo','inventario','solicitar','compra_sugerencia','proveedor_sugerido','pendiente_entrega','proveedor','ext_id'],
    map: r => [ txt(r['CODIGO']), txt(r['DESCRIPCIÓN']), txt(r['Unid.']), txt(r['PRES.']), num(r['CONSUMO MENSUAL']),
                num(r['STOCK MÍNIMO']), num(r['INVENTARIO']), txt(r['SOLICITAR']), num(r['COMPRA SUGERENCIA']),
                txt(r['PROOVEDOR SUGERIDO']), num(r['PENDIENTE DE ENTREGA']), txt(r['PROVEEDOR']), txt(r['ID']) ],
    kinds:['t','t','t','t','n','n','n','t','n','t','n','t','t'],
    skip: r => !txt(r['DESCRIPCIÓN']),
    src: 'inventario'
  },
  contingencia: {
    cols: ['articulo','unidad','stock_inicial','consumido','stock_disponible','pct_restante','precio_usd_kg','consumo_mensual_est','meses_cobertura','estado','motivo','observaciones'],
    map: r => [ txt(r['Artículo (Materia Prima)']), txt(r['Unidad']), num(r['Stock Inicial (KG/UN)']), num(r['Consumido hasta hoy']),
                num(r['Stock Disponible']), num(r['% Restante']), num(r['Precio Compra USD/KG']), num(r['Consumo Mensual Est.']),
                num(r['Meses Cobertura']), txt(r['Estado']), txt(r['Motivo']), txt(r['Observaciones']) ],
    kinds:['t','t','n','n','n','n','n','n','n','t','t','t'],
    skip: r => !txt(r['Artículo (Materia Prima)']),
    src: 'contingencia'
  }
};

let out = '-- Datos migrados desde el Google Sheet — generado automáticamente\nbegin;\n\n';
let totals = {};

for (const [tbl, cfg] of Object.entries(TABLES)) {
  const rows = (d[cfg.src] || []).filter(r => !cfg.skip(r));
  totals[tbl] = rows.length;
  if (!rows.length) continue;
  out += `-- ${tbl}: ${rows.length} filas\n`;
  const values = rows.map(r => {
    const vals = cfg.map(r).map((v, i) => cfg.kinds[i] === 'n' ? N(v) : S(v));
    return '  (' + vals.join(', ') + ')';
  });
  out += `insert into public.${tbl} (${cfg.cols.join(', ')}) values\n${values.join(',\n')};\n\n`;
}

out += 'commit;\n';
fs.writeFileSync(new URL('./seed.sql', import.meta.url), out, 'utf8');
console.log('seed.sql generado.');
Object.entries(totals).forEach(([k, v]) => console.log('  ' + k + ': ' + v + ' filas'));
