/* PriceTrail backup.js — JSON backup export/restore and CSV export.
   Backup schema v1. Restore is strict and all-or-nothing: every record is
   validated before anything is replaced, and a bad file leaves data untouched. */

'use strict';

const BACKUP_SCHEMA = 1;
const BACKUP_APP = 'pricetrail';

/* Build a backup object from the current dataset. */
function buildBackup(products, prices, currency) {
  return {
    schema: BACKUP_SCHEMA,
    app: BACKUP_APP,
    exportedAt: new Date().toISOString(),
    currency,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      brand: p.brand || '',
      targetPriceMinor: typeof p.targetPriceMinor === 'number' ? p.targetPriceMinor : null,
      url: p.url || '',
      notes: p.notes || '',
      currency: p.currency || currency,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    prices: prices.map((r) => ({
      id: r.id,
      productId: r.productId,
      store: r.store,
      priceMinor: r.priceMinor,
      date: r.date,
      notes: r.notes || '',
      createdAt: r.createdAt,
    })),
  };
}

/* Strictly validate a parsed backup object.
   Returns { ok: true, products, prices, currency } or { ok: false, errors }. */
function validateBackup(data, calc) {
  const errors = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['Backup file is not a valid object.'] };
  }
  if (data.schema !== BACKUP_SCHEMA) errors.push('Unsupported backup schema (expected 1).');
  if (data.app !== BACKUP_APP) errors.push('This backup is not from PriceTrail.');
  if (!Array.isArray(data.products)) errors.push('Backup has no products list.');
  if (!Array.isArray(data.prices)) errors.push('Backup has no prices list.');
  if (data.currency !== undefined && data.currency !== null && !calc.CURRENCIES.includes(data.currency)) {
    errors.push('Backup currency is not recognised.');
  }
  if (errors.length > 0) return { ok: false, errors };

  const productIds = new Set();
  const cleanProducts = [];
  for (const p of data.products) {
    const errs = calc.validateProduct(p);
    if (errs.length > 0) {
      errors.push('Product "' + (p && p.name ? p.name : '?') + '": ' + errs.join(' '));
      continue;
    }
    if (productIds.has(p.id)) {
      errors.push('Duplicate product id: ' + p.id);
      continue;
    }
    productIds.add(p.id);
    cleanProducts.push({
      id: p.id,
      name: p.name.trim(),
      category: p.category,
      brand: (p.brand || '').trim(),
      targetPriceMinor: typeof p.targetPriceMinor === 'number' ? p.targetPriceMinor : null,
      url: (p.url || '').trim(),
      notes: (p.notes || '').trim(),
      currency: p.currency || data.currency || 'PKR',
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
    });
  }

  const priceIds = new Set();
  const cleanPrices = [];
  for (const r of data.prices) {
    const errs = calc.validatePrice(r);
    if (errs.length > 0) {
      errors.push('Price record for store "' + (r && r.store ? r.store : '?') + '": ' + errs.join(' '));
      continue;
    }
    if (!productIds.has(r.productId)) {
      errors.push('Price record references unknown product: ' + r.productId);
      continue;
    }
    if (priceIds.has(r.id)) {
      errors.push('Duplicate price id: ' + r.id);
      continue;
    }
    priceIds.add(r.id);
    cleanPrices.push({
      id: r.id,
      productId: r.productId,
      store: r.store.trim(),
      priceMinor: r.priceMinor,
      date: r.date,
      notes: (r.notes || '').trim(),
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    products: cleanProducts,
    prices: cleanPrices,
    currency: data.currency || 'PKR',
  };
}

/* CSV export of all price records, one row per record.
   Every cell is quoted (so commas, quotes and newlines are safe) and any
   value that could be read as a spreadsheet formula is neutralised: a
   leading ', +, -, @, tab or carriage return gets a leading single quote,
   so Excel/Sheets show the text instead of running it. */
function sanitizeCsvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  const first = s.replace(/^[\s]+/, '').charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r' || first === '\n') {
    return "'" + s;
  }
  return s;
}

function buildCsv(products, prices, calc, currency) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const esc = (v) => '"' + sanitizeCsvCell(v).replace(/"/g, '""') + '"';
  const lines = [
    'product,category,brand,store,price,currency,date,notes',
  ];
  const sorted = [...prices].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return 0;
  });
  for (const r of sorted) {
    const p = byId.get(r.productId);
    if (!p) continue;
    lines.push(
      [
        esc(p.name),
        esc(p.category),
        esc(p.brand || ''),
        esc(r.store),
        esc((r.priceMinor / 100).toFixed(2)),
        esc(p.currency || currency),
        esc(r.date),
        esc(r.notes || ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BACKUP_SCHEMA, BACKUP_APP, buildBackup, validateBackup, buildCsv, sanitizeCsvCell, downloadFile };
}
