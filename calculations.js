/* PriceTrail calculations.js — pure functions, no DOM.
   Money is stored as integer minor units (e.g. PKR 123.45 = 12345).
   All functions are unit-testable in Node. */

'use strict';

const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'AED'];

const CATEGORIES = [
  'Groceries',
  'Electronics',
  'Home & Garden',
  'Clothing',
  'Health & Beauty',
  'Baby & Kids',
  'Sports',
  'Automotive',
  'Other',
];

const MAX_PRICE_MINOR = 100000000; // 1,000,000.00
const MAX_PRODUCTS = 500;
const MAX_PRICES_PER_PRODUCT = 2000;

/* Parse a user-typed price string into integer minor units.
   Returns the minor-unit integer, or null when invalid.
   Rules: digits with optional 1-2 decimal places, > 0, <= 1,000,000.00.
   String math only, so 0.1 + 0.2 style float error cannot creep in. */
function parseMoneyToMinor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const parts = s.split('.');
  const whole = parts[0].replace(/^0+(?=\d)/, '');
  const cents = (parts[1] || '').padEnd(2, '0');
  const minor = Number(whole) * 100 + Number(cents);
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_PRICE_MINOR) return null;
  return minor;
}

/* Format integer minor units for display in the given currency. */
function formatMoney(minor, currency) {
  const code = CURRENCIES.includes(currency) ? currency : 'PKR';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch (e) {
    return code + ' ' + (minor / 100).toFixed(2);
  }
}

/* Today's local date as YYYY-MM-DD. */
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isFutureDate(s) {
  return isValidDateString(s) && s > todayISO();
}

/* Sort price records chronologically; ties break by createdAt, then id. */
function sortPrices(prices) {
  return [...prices].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/* Statistics for one product from its price records.
   Returns null when the product has no prices. */
function computeStats(prices) {
  if (!prices || prices.length === 0) return null;
  const sorted = sortPrices(prices);
  let lowest = Infinity;
  let highest = -Infinity;
  let sum = 0;
  for (const p of sorted) {
    if (p.priceMinor < lowest) lowest = p.priceMinor;
    if (p.priceMinor > highest) highest = p.priceMinor;
    sum += p.priceMinor;
  }
  const latest = sorted[sorted.length - 1];
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const average = Math.round(sum / sorted.length);
  let changeMinor = null;
  let changePct = null;
  let movement = 'none';
  if (previous) {
    changeMinor = latest.priceMinor - previous.priceMinor;
    changePct = Math.round((changeMinor / previous.priceMinor) * 1000) / 10;
    movement = changeMinor < 0 ? 'down' : changeMinor > 0 ? 'up' : 'flat';
  }
  return {
    count: sorted.length,
    lowest,
    highest,
    average,
    latest,
    previous,
    changeMinor,
    changePct,
    movement,
    firstDate: sorted[0].date,
    latestDate: latest.date,
  };
}

/* Latest recorded price per store for one product.
   Returns rows sorted by price ascending: {store, priceMinor, date, recordId}. */
function latestPerStore(prices) {
  const byStore = new Map();
  for (const p of sortPrices(prices)) {
    byStore.set(p.store, p); // later record overwrites, so the last one wins
  }
  const rows = [...byStore.values()].map((p) => ({
    store: p.store,
    priceMinor: p.priceMinor,
    date: p.date,
    recordId: p.id,
    notes: p.notes || '',
  }));
  rows.sort((a, b) => a.priceMinor - b.priceMinor);
  return rows;
}

/* Store comparison summary for one product, or null when no prices. */
function compareStores(prices) {
  const rows = latestPerStore(prices);
  if (rows.length === 0) return null;
  const cheapest = rows[0];
  const dearest = rows[rows.length - 1];
  return {
    rows,
    cheapest,
    dearest,
    savingsMinor: dearest.priceMinor - cheapest.priceMinor,
    storeCount: rows.length,
  };
}

/* Dashboard aggregates across all products.
   products: [{id, targetPriceMinor, currency, ...}]
   pricesByProduct: Map productId -> price array */
function dashboardStats(products, pricesByProduct) {
  let drops = 0;
  let rises = 0;
  let atOrBelowTarget = 0;
  let withPrices = 0;
  for (const product of products) {
    const prices = pricesByProduct.get(product.id) || [];
    const stats = computeStats(prices);
    if (!stats) continue;
    withPrices++;
    if (stats.movement === 'down') drops++;
    if (stats.movement === 'up') rises++;
    if (
      typeof product.targetPriceMinor === 'number' &&
      product.targetPriceMinor > 0 &&
      stats.latest.priceMinor <= product.targetPriceMinor
    ) {
      atOrBelowTarget++;
    }
  }
  return {
    totalProducts: products.length,
    withPrices,
    drops,
    rises,
    atOrBelowTarget,
  };
}

/* The 5 most recent price records across all products. */
function recentUpdates(products, pricesByProduct, limit) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const all = [];
  for (const [productId, prices] of pricesByProduct.entries()) {
    const product = byId.get(productId);
    if (!product) continue;
    for (const p of prices) {
      all.push({ product, price: p });
    }
  }
  all.sort((a, b) => {
    if (a.price.date !== b.price.date) return a.price.date < b.price.date ? 1 : -1;
    if (a.price.createdAt !== b.price.createdAt) {
      return a.price.createdAt < b.price.createdAt ? 1 : -1;
    }
    return 0;
  });
  return all.slice(0, limit || 5);
}

/* Validate a product object. Returns an array of error messages (empty = valid). */
function validateProduct(p) {
  const errors = [];
  if (typeof p !== 'object' || p === null) return ['Product must be an object.'];
  if (typeof p.id !== 'string' || p.id.length === 0) errors.push('Product id is required.');
  if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.trim().length > 100) {
    errors.push('Product name must be 2 to 100 characters.');
  }
  if (!CATEGORIES.includes(p.category)) errors.push('Category is not recognised.');
  if (p.brand !== undefined && p.brand !== null && p.brand !== '') {
    if (typeof p.brand !== 'string' || p.brand.length > 100) {
      errors.push('Brand must be at most 100 characters.');
    }
  }
  if (p.targetPriceMinor !== undefined && p.targetPriceMinor !== null) {
    if (!Number.isInteger(p.targetPriceMinor) || p.targetPriceMinor <= 0 || p.targetPriceMinor > MAX_PRICE_MINOR) {
      errors.push('Target price must be a whole minor-unit amount above 0.');
    }
  }
  if (p.url !== undefined && p.url !== null && p.url !== '') {
    if (typeof p.url !== 'string' || p.url.length > 500 || !/^https?:\/\/\S+$/.test(p.url)) {
      errors.push('Product URL must start with http:// or https://.');
    }
  }
  if (p.notes !== undefined && p.notes !== null && p.notes !== '') {
    if (typeof p.notes !== 'string' || p.notes.length > 500) {
      errors.push('Notes must be at most 500 characters.');
    }
  }
  if (p.currency !== undefined && p.currency !== null && !CURRENCIES.includes(p.currency)) {
    errors.push('Currency is not recognised.');
  }
  return errors;
}

/* Validate a price record object. Returns an array of error messages. */
function validatePrice(r) {
  const errors = [];
  if (typeof r !== 'object' || r === null) return ['Price record must be an object.'];
  if (typeof r.id !== 'string' || r.id.length === 0) errors.push('Price id is required.');
  if (typeof r.productId !== 'string' || r.productId.length === 0) {
    errors.push('Price record needs a product.');
  }
  if (typeof r.store !== 'string' || r.store.trim().length < 1 || r.store.trim().length > 60) {
    errors.push('Store name must be 1 to 60 characters.');
  }
  if (!Number.isInteger(r.priceMinor) || r.priceMinor <= 0 || r.priceMinor > MAX_PRICE_MINOR) {
    errors.push('Price must be above 0 and at most 1,000,000.00.');
  }
  if (!isValidDateString(r.date)) errors.push('Date must be a real date (YYYY-MM-DD).');
  else if (isFutureDate(r.date)) errors.push('Date cannot be in the future.');
  if (r.notes !== undefined && r.notes !== null && r.notes !== '') {
    if (typeof r.notes !== 'string' || r.notes.length > 500) {
      errors.push('Notes must be at most 500 characters.');
    }
  }
  return errors;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CURRENCIES,
    CATEGORIES,
    MAX_PRICE_MINOR,
    MAX_PRODUCTS,
    MAX_PRICES_PER_PRODUCT,
    parseMoneyToMinor,
    formatMoney,
    todayISO,
    isValidDateString,
    isFutureDate,
    sortPrices,
    computeStats,
    latestPerStore,
    compareStores,
    dashboardStats,
    recentUpdates,
    validateProduct,
    validatePrice,
  };
}
