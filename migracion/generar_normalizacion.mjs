// Genera propuesta de normalización de proveedores + SQL.
// Uso: node migracion/generar_normalizacion.mjs
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(new URL('./sheet_backup.json', import.meta.url), 'utf8'));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

// clave de agrupación: sin acentos/mayúsc, sin puntos/comas, sin sufijos legales
const groupKey = s => norm(s).replace(/[.,]/g, ' ')
  .replace(/\b(S\s*A\s*S|SAS|S\s*R\s*L|SRL|S\s*A|SA|LTDA)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

// nombres crudos de las 3 fuentes
const names = new Set();
(d.pedidos   || []).forEach(r => { const v = (r['Proveedor'] || '').trim(); if (v) names.add(v); });
(d.precios   || []).forEach(r => { const v = (r['PROVEEDOR'] || '').trim(); if (v) names.add(v); });
(d.contactos || []).forEach(r => { const v = (r['EMPRESA']   || '').trim(); if (v) names.add(v); });

// Overrides definidos por el usuario (por clave de grupo)
const OVERRIDES = { 'IRMARI': 'Irmari LTDA', 'LIDERQUIM': 'Liderquim S.A.S' };

const LOW = new Set(['y', 'de', 'del', 'la', 'el', 'los', 'las']);
const titleCase = s => s.toLowerCase().split(/\s+/)
  .map(w => LOW.has(w) ? w : (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

function detectSuffix(variants) {
  const found = new Set();
  variants.forEach(v => {
    const u = norm(v);
    if (/\bS\.?A\.?S\.?\b/.test(u) || /\bSAS\b/.test(u)) found.add('SAS');
    else if (/\bS\.?R\.?L\.?\b/.test(u) || /\bSRL\b/.test(u)) found.add('SRL');
    else if (/\bLTDA\b/.test(u)) found.add('LTDA');
    else if (/\bS\.?A\.?\b/.test(u) || /\bSA\b/.test(u)) found.add('S.A.');
  });
  return found;
}

// agrupar
const groups = {};
[...names].forEach(n => { const k = groupKey(n); (groups[k] = groups[k] || []).push(n); });

const mapping = [];   // {canonical, variants:[...]}
const ambiguous = [];
Object.entries(groups).forEach(([k, variants]) => {
  if (variants.length < 2) return; // sin duplicados
  const suf = detectSuffix(variants);
  let suffix = '';
  if (suf.size === 1) suffix = [...suf][0];
  else if (suf.size > 1) { ambiguous.push({ k, variants, suf: [...suf] }); suffix = suf.has('S.A.') ? 'S.A.' : [...suf][0]; }
  if (suffix === 'SAS') suffix = 'S.A.S';        // formato uruguayo
  let canonical = (titleCase(k) + (suffix ? ' ' + suffix : '')).trim();
  if (OVERRIDES[k]) canonical = OVERRIDES[k];    // definición manual del usuario
  mapping.push({ canonical, variants });
});
mapping.sort((a, b) => a.canonical.localeCompare(b.canonical));

// ── Propuesta legible ──
console.log('=== PROPUESTA DE NOMBRES CANÓNICOS (' + mapping.length + ' grupos) ===\n');
mapping.forEach(m => console.log('  ' + m.canonical.padEnd(28) + ' ⟵  ' + m.variants.join('  ·  ')));
if (ambiguous.length) {
  console.log('\n⚠ Grupos con sufijo legal inconsistente (revisá cuál es el correcto):');
  ambiguous.forEach(a => console.log('  ' + titleCase(a.k) + ':  ' + a.suf.join(' / ') + '  →  variantes: ' + a.variants.join(' · ')));
}

// ── SQL ──
const esc = s => s.replace(/'/g, "''");
let sql = '-- Normalización de nombres de proveedores — generado automáticamente\nbegin;\n\n';
mapping.forEach(m => {
  const variantsToFix = m.variants.filter(v => v !== m.canonical);
  if (!variantsToFix.length) return;
  const inList = variantsToFix.map(v => `'${esc(v)}'`).join(', ');
  sql += `-- ${m.canonical}\n`;
  sql += `update public.pedidos     set proveedor = '${esc(m.canonical)}' where proveedor in (${inList});\n`;
  sql += `update public.precios      set proveedor = '${esc(m.canonical)}' where proveedor in (${inList});\n`;
  sql += `update public.proveedores  set empresa   = '${esc(m.canonical)}' where empresa   in (${inList});\n\n`;
});
sql += `-- Fusionar filas de proveedores duplicadas (conserva la de menor id)\n`;
sql += `delete from public.proveedores a using public.proveedores b\n  where a.empresa = b.empresa and a.id > b.id;\n\n`;
sql += 'commit;\n';
fs.writeFileSync(new URL('./normalizar_proveedores.sql', import.meta.url), sql, 'utf8');

// Mapa JSON (solo variantes que cambian) para aplicar desde la app
const jsonMap = mapping.map(m => ({ canonical: m.canonical, variants: m.variants.filter(v => v !== m.canonical) }))
  .filter(m => m.variants.length);
fs.writeFileSync(new URL('./normalizar_mapping.json', import.meta.url), JSON.stringify(jsonMap), 'utf8');
console.log('\nSQL en migracion/normalizar_proveedores.sql · JSON en migracion/normalizar_mapping.json');
