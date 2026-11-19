/* PriceTrail app.js — UI wiring and rendering.
   All user-supplied text is inserted with textContent only, never innerHTML,
   so stored values cannot inject markup. Money uses integer minor units. */

'use strict';

let settings = { currency: 'PKR', theme: 'light' };
let products = [];
let pricesByProduct = new Map();
let currentView = 'dashboard';
let detailProductId = null;
let compareProductId = null;
let filters = { search: '', category: 'all', movement: 'all', sort: 'name', store: 'all', currency: 'all' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function $(id) {
  return document.getElementById(id);
}

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.hidden = true;
  }, 3500);
}

function productCurrency(p) {
  return p.currency || settings.currency;
}

function getPrices(productId) {
  return pricesByProduct.get(productId) || [];
}

async function loadAll() {
  settings.currency = (await DB.getSetting('currency')) || 'PKR';
  settings.theme = (await DB.getSetting('theme')) || 'light';
  products = await DB.getAllProducts();
  const allPrices = await DB.getAllPrices();
  pricesByProduct = new Map();
  for (const r of allPrices) {
    if (!pricesByProduct.has(r.productId)) pricesByProduct.set(r.productId, []);
    pricesByProduct.get(r.productId).push(r);
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme === 'dark' ? 'dark' : 'light');
}

function go(view, arg) {
  currentView = view;
  if (view === 'product') detailProductId = arg;
  if (view === 'compare' && arg) compareProductId = arg;
  if (view !== 'product') detailProductId = null;
  location.hash = view === 'product' ? '#/product/' + detailProductId : '#/' + view;
  render();
}

function render() {
  applyTheme();
  document.querySelectorAll('[data-nav]').forEach((b) => {
    const v = b.getAttribute('data-nav');
    const active = v === currentView || (v === 'products' && currentView === 'product');
    b.classList.toggle('active', active);
    b.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const view = $('view');
  view.innerHTML = '';
  if (currentView === 'dashboard') renderDashboard(view);
  else if (currentView === 'products') renderProducts(view);
  else if (currentView === 'product') renderProductDetail(view);
  else if (currentView === 'compare') renderCompare(view);
  else if (currentView === 'settings') renderSettings(view);
}

/* ---------- Dashboard ---------- */

function renderDashboard(view) {
  const wrap = el('div', 'page');
  wrap.appendChild(el('h1', 'page-title', 'Dashboard'));
  const stats = dashboardStats(products, pricesByProduct);

  const grid = el('div', 'stat-grid');
  const cards = [
    { label: 'Tracked products', value: String(stats.totalProducts) },
    { label: 'Price drops', value: String(stats.drops), tone: 'good' },
    { label: 'Price rises', value: String(stats.rises), tone: 'bad' },
    { label: 'At or below target', value: String(stats.atOrBelowTarget), tone: 'good' },
  ];
  for (const c of cards) {
    const card = el('div', 'stat-card' + (c.tone ? ' tone-' + c.tone : ''));
    card.appendChild(el('div', 'stat-value', c.value));
    card.appendChild(el('div', 'stat-label', c.label));
    grid.appendChild(card);
  }
  wrap.appendChild(grid);

  const recent = recentUpdates(products, pricesByProduct, 5);
  const section = el('section', 'card');
  section.appendChild(el('h2', 'card-title', 'Recent price updates'));
  if (recent.length === 0) {
    const empty = el('div', 'empty-state');
    empty.appendChild(el('p', 'empty-title', 'Smarter purchases start here.'));
    empty.appendChild(
      el('p', 'empty-text', 'Add your first product to start tracking prices.'),
    );
    const btn = el('button', 'btn btn-primary', '+ Add first product');
    btn.addEventListener('click', () => openProductDialog(null));
    empty.appendChild(btn);
    section.appendChild(empty);
  } else {
    const list = el('ul', 'update-list');
    for (const item of recent) {
      const li = el('li', 'update-item');
      const main = el('div', 'update-main');
      main.appendChild(el('span', 'update-product', item.product.name));
      main.appendChild(el('span', 'update-store', item.price.store + ' · ' + item.price.date));
      li.appendChild(main);
      li.appendChild(el('span', 'update-price', formatMoney(item.price.priceMinor, productCurrency(item.product))));
      list.appendChild(li);
    }
    section.appendChild(list);
  }
  wrap.appendChild(section);
  view.appendChild(wrap);
}

/* ---------- Products list ---------- */

function filteredProducts() {
  const q = filters.search.trim().toLowerCase();
  let list = products.filter((p) => {
    if (q && !(p.name.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q))) return false;
    if (filters.category !== 'all' && p.category !== filters.category) return false;
    if (filters.currency !== 'all' && productCurrency(p) !== filters.currency) return false;
    if (filters.movement !== 'all') {
      const stats = computeStats(getPrices(p.id));
      const m = stats ? stats.movement : 'none';
      if (m !== filters.movement) return false;
    }
    return true;
  });
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (filters.sort === 'name') list.sort(byName);
  else if (filters.sort === 'updated') {
    list.sort((a, b) => {
      const da = latestDateOf(a.id);
      const db = latestDateOf(b.id);
      if (da === db) return byName(a, b);
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? 1 : -1;
    });
  } else if (filters.sort === 'lowest') {
    // Group by currency first: raw amounts in different currencies must
    // never be compared against each other.
    list.sort((a, b) => {
      const ca = productCurrency(a);
      const cb = productCurrency(b);
      if (ca !== cb) return ca < cb ? -1 : 1;
      const sa = computeStats(getPrices(a.id));
      const sb = computeStats(getPrices(b.id));
      const va = sa ? sa.lowest : Infinity;
      const vb = sb ? sb.lowest : Infinity;
      return va - vb || byName(a, b);
    });
  } else if (filters.sort === 'change') {
    list.sort((a, b) => {
      const sa = computeStats(getPrices(a.id));
      const sb = computeStats(getPrices(b.id));
      const va = sa && sa.changePct !== null ? sa.changePct : Infinity;
      const vb = sb && sb.changePct !== null ? sb.changePct : Infinity;
      return va - vb || byName(a, b);
    });
  }
  return list;
}

function latestDateOf(productId) {
  const stats = computeStats(getPrices(productId));
  return stats ? stats.latestDate : '';
}

function movementBadge(stats) {
  if (!stats || stats.movement === 'none') return el('span', 'badge badge-none', 'No prices yet');
  if (stats.movement === 'down') {
    const pct = stats.changePct;
    return el('span', 'badge badge-down', 'Down ' + Math.abs(pct) + '%');
  }
  if (stats.movement === 'up') {
    return el('span', 'badge badge-up', 'Up ' + stats.changePct + '%');
  }
  return el('span', 'badge badge-flat', 'No change');
}

function renderProducts(view) {
  const wrap = el('div', 'page');
  const head = el('div', 'page-head');
  head.appendChild(el('h1', 'page-title', 'My Products'));
  const addBtn = el('button', 'btn btn-primary', '+ Add product');
  addBtn.addEventListener('click', () => openProductDialog(null));
  head.appendChild(addBtn);
  wrap.appendChild(head);

  const toolbar = el('div', 'toolbar');
  const search = el('input', 'input search-input');
  search.type = 'search';
  search.placeholder = 'Search by product name or brand';
  search.value = filters.search;
  search.setAttribute('aria-label', 'Search by product name or brand');
  search.addEventListener('input', () => {
    filters.search = search.value;
    updateProductList();
  });
  toolbar.appendChild(search);

  const cat = el('select', 'input');
  cat.setAttribute('aria-label', 'Filter by category');
  cat.appendChild(el('option', '', 'All categories'));
  cat.options[0].value = 'all';
  for (const c of CATEGORIES) {
    const o = el('option', '', c);
    o.value = c;
    cat.appendChild(o);
  }
  cat.value = filters.category;
  cat.addEventListener('change', () => {
    filters.category = cat.value;
    updateProductList();
  });
  toolbar.appendChild(cat);

  const cur = el('select', 'input');
  cur.setAttribute('aria-label', 'Filter by currency');
  const allCur = el('option', '', 'All currencies');
  allCur.value = 'all';
  cur.appendChild(allCur);
  for (const c of CURRENCIES) {
    const o = el('option', '', c);
    o.value = c;
    cur.appendChild(o);
  }
  cur.value = filters.currency;
  cur.addEventListener('change', () => {
    filters.currency = cur.value;
    updateProductList();
  });
  toolbar.appendChild(cur);

  const mov = el('select', 'input');
  mov.setAttribute('aria-label', 'Filter by price movement');
  for (const [v, label] of [
    ['all', 'Any movement'],
    ['down', 'Price drops'],
    ['up', 'Price rises'],
    ['flat', 'No change'],
    ['none', 'No prices yet'],
  ]) {
    const o = el('option', '', label);
    o.value = v;
    mov.appendChild(o);
  }
  mov.value = filters.movement;
  mov.addEventListener('change', () => {
    filters.movement = mov.value;
    updateProductList();
  });
  toolbar.appendChild(mov);

  const sort = el('select', 'input');
  sort.setAttribute('aria-label', 'Sort products');
  for (const [v, label] of [
    ['name', 'Sort: name'],
    ['updated', 'Sort: latest update'],
    ['lowest', 'Sort: lowest price'],
    ['change', 'Sort: % change'],
  ]) {
    const o = el('option', '', label);
    o.value = v;
    sort.appendChild(o);
  }
  sort.value = filters.sort;
  sort.addEventListener('change', () => {
    filters.sort = sort.value;
    updateProductList();
  });
  toolbar.appendChild(sort);
  wrap.appendChild(toolbar);

  const listContainer = el('div');
  wrap.appendChild(listContainer);

  function updateProductList() {
    listContainer.innerHTML = '';
    const list = filteredProducts();
    if (products.length === 0) {
    const empty = el('div', 'card empty-state');
    empty.appendChild(el('p', 'empty-title', 'Smarter purchases start here.'));
    empty.appendChild(el('p', 'empty-text', 'Add your first product to start tracking prices.'));
    const btn = el('button', 'btn btn-primary', '+ Add first product');
    btn.addEventListener('click', () => openProductDialog(null));
    empty.appendChild(btn);
    listContainer.appendChild(empty);
  } else if (list.length === 0) {
    listContainer.appendChild(el('p', 'muted', 'No products match these filters.'));
  } else {
    const currenciesPresent = new Set(list.map((p) => productCurrency(p)));
    if (filters.sort === 'lowest' && filters.currency === 'all' && currenciesPresent.size > 1) {
      listContainer.appendChild(
        el('p', 'muted', 'Sorted by lowest price within each currency. Prices in different currencies are not compared.'),
      );
    }
    const grid = el('div', 'product-grid');
    for (const p of list) {
      const stats = computeStats(getPrices(p.id));
      const card = el('article', 'card product-card');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      const open = () => go('product', p.id);
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('button')) return;
        open();
      });
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') open();
      });
      const top = el('div', 'product-top');
      top.appendChild(el('h2', 'product-name', p.name));
      top.appendChild(movementBadge(stats));
      card.appendChild(top);
      const meta = [];
      if (p.brand) meta.push(p.brand);
      meta.push(p.category);
      card.appendChild(el('p', 'muted product-meta', meta.join(' · ')));
      if (stats) {
        const row = el('div', 'product-prices');
        row.appendChild(el('span', 'latest-price', formatMoney(stats.latest.priceMinor, productCurrency(p))));
        row.appendChild(el('span', 'muted', 'Lowest ' + formatMoney(stats.lowest, productCurrency(p))));
        card.appendChild(row);
        if (typeof p.targetPriceMinor === 'number' && p.targetPriceMinor > 0) {
          const at = stats.latest.priceMinor <= p.targetPriceMinor;
          card.appendChild(
            el('p', at ? 'target-ok' : 'target-miss', (at ? 'At or below target ' : 'Above target ') + formatMoney(p.targetPriceMinor, productCurrency(p))),
          );
        }
        card.appendChild(el('p', 'muted', stats.count + ' price' + (stats.count === 1 ? '' : 's') + ' · latest ' + stats.latestDate));
      } else {
        card.appendChild(el('p', 'muted', 'No prices recorded yet.'));
      }
      const actions = el('div', 'card-actions');
      const editBtn = el('button', 'btn btn-ghost', 'Edit');
      editBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openProductDialog(p);
      });
      const delBtn = el('button', 'btn btn-ghost btn-danger', 'Delete');
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        confirmDialog('Delete "' + p.name + '" and all its price records? This cannot be undone.', async () => {
          await DB.deleteProduct(p.id);
          await loadAll();
          toast('Product deleted.');
          render();
        });
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      grid.appendChild(card);
    }
    listContainer.appendChild(grid);
  }
  }
  updateProductList();
  view.appendChild(wrap);
}

/* ---------- Product detail ---------- */

function renderProductDetail(view) {
  const p = products.find((x) => x.id === detailProductId);
  if (!p) {
    view.appendChild(el('p', 'muted', 'Product not found.'));
    const back = el('button', 'btn btn-ghost', 'Back to My Products');
    back.addEventListener('click', () => go('products'));
    view.appendChild(back);
    return;
  }
  const wrap = el('div', 'page');
  const back = el('button', 'btn btn-ghost', '← My Products');
  back.addEventListener('click', () => go('products'));
  wrap.appendChild(back);

  const head = el('div', 'page-head');
  const titleBox = el('div');
  titleBox.appendChild(el('h1', 'page-title', p.name));
  const meta = [];
  if (p.brand) meta.push(p.brand);
  meta.push(p.category);
  if (p.url) meta.push(p.url);
  titleBox.appendChild(el('p', 'muted', meta.join(' · ')));
  if (p.notes) titleBox.appendChild(el('p', '', p.notes));
  head.appendChild(titleBox);
  const headActions = el('div', 'card-actions');
  const editBtn = el('button', 'btn btn-ghost', 'Edit product');
  editBtn.addEventListener('click', () => openProductDialog(p));
  const addPriceBtn = el('button', 'btn btn-primary', '+ Add price');
  addPriceBtn.addEventListener('click', () => openPriceDialog(p, null));
  headActions.appendChild(editBtn);
  headActions.appendChild(addPriceBtn);
  head.appendChild(headActions);
  wrap.appendChild(head);

  const prices = sortPrices(getPrices(p.id));
  const stats = computeStats(prices);
  const currency = productCurrency(p);

  if (!stats) {
    const empty = el('div', 'card empty-state');
    empty.appendChild(el('p', 'empty-title', 'No prices recorded yet.'));
    empty.appendChild(el('p', 'empty-text', 'Record the first price for this product.'));
    const btn = el('button', 'btn btn-primary', '+ Add first price');
    btn.addEventListener('click', () => openPriceDialog(p, null));
    empty.appendChild(btn);
    wrap.appendChild(empty);
    view.appendChild(wrap);
    return;
  }

  const grid = el('div', 'stat-grid');
  const statItems = [
    { label: 'Latest price', value: formatMoney(stats.latest.priceMinor, currency) },
    { label: 'Lowest price', value: formatMoney(stats.lowest, currency), tone: 'good' },
    { label: 'Highest price', value: formatMoney(stats.highest, currency) },
    { label: 'Average price', value: formatMoney(stats.average, currency) },
    {
      label: 'Change vs previous',
      value:
        stats.changeMinor === null
          ? '—'
          : (stats.changeMinor > 0 ? '+' : '') + formatMoney(Math.abs(stats.changeMinor), currency) + ' (' + (stats.changePct > 0 ? '+' : '') + stats.changePct + '%)',
      tone: stats.movement === 'down' ? 'good' : stats.movement === 'up' ? 'bad' : undefined,
    },
  ];
  if (typeof p.targetPriceMinor === 'number' && p.targetPriceMinor > 0) {
    statItems.push({
      label: 'Target price',
      value: formatMoney(p.targetPriceMinor, currency),
      tone: stats.latest.priceMinor <= p.targetPriceMinor ? 'good' : undefined,
    });
  }
  for (const s of statItems) {
    const card = el('div', 'stat-card' + (s.tone ? ' tone-' + s.tone : ''));
    card.appendChild(el('div', 'stat-value', s.value));
    card.appendChild(el('div', 'stat-label', s.label));
    grid.appendChild(card);
  }
  wrap.appendChild(grid);

  const chartCard = el('section', 'card');
  chartCard.appendChild(el('h2', 'card-title', 'Price history'));
  chartCard.appendChild(
    buildPriceChart(prices, { targetMinor: p.targetPriceMinor, currency, formatMoney }),
  );
  wrap.appendChild(chartCard);

  const tableCard = el('section', 'card');
  tableCard.appendChild(el('h2', 'card-title', 'Price records'));
  const stores = [...new Set(prices.map((r) => r.store))].sort();
  if (filters.store !== 'all' && !stores.includes(filters.store)) filters.store = 'all';
  const storeFilter = el('select', 'input');
  storeFilter.setAttribute('aria-label', 'Filter records by store');
  const allOpt = el('option', '', 'All stores');
  allOpt.value = 'all';
  storeFilter.appendChild(allOpt);
  for (const s of stores) {
    const o = el('option', '', s);
    o.value = s;
    storeFilter.appendChild(o);
  }
  storeFilter.value = filters.store;
  storeFilter.addEventListener('change', () => {
    filters.store = storeFilter.value;
    render();
  });
  tableCard.appendChild(storeFilter);

  const shown = prices.filter((r) => filters.store === 'all' || r.store === filters.store);
  const tableWrap = el('div', 'table-wrap');
  const table = el('table', 'data-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Date', 'Store', 'Price', 'Change', 'Notes', '']) hr.appendChild(el('th', '', h));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  const byDate = [...prices].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const r of [...shown].reverse()) {
    const tr = el('tr');
    if (r.priceMinor === stats.lowest) tr.classList.add('row-lowest');
    tr.appendChild(el('td', '', r.date));
    tr.appendChild(el('td', '', r.store));
    const priceCell = el('td', 'num', formatMoney(r.priceMinor, currency));
    if (r.priceMinor === stats.lowest) {
      const tag = el('span', 'badge badge-down', 'lowest');
      priceCell.appendChild(document.createTextNode(' '));
      priceCell.appendChild(tag);
    }
    tr.appendChild(priceCell);
    const idx = byDate.indexOf(r);
    const prev = idx > 0 ? byDate[idx - 1] : null;
    let changeText = '—';
    if (prev) {
      const diff = r.priceMinor - prev.priceMinor;
      const pct = Math.round((diff / prev.priceMinor) * 1000) / 10;
      changeText = (diff > 0 ? '+' : '') + formatMoney(Math.abs(diff), currency) + ' (' + (pct > 0 ? '+' : '') + pct + '%)';
    }
    tr.appendChild(el('td', 'num', changeText));
    tr.appendChild(el('td', '', r.notes || '—'));
    const actions = el('td', 'row-actions');
    const eBtn = el('button', 'btn btn-ghost btn-small', 'Edit');
    eBtn.addEventListener('click', () => openPriceDialog(p, r));
    const dBtn = el('button', 'btn btn-ghost btn-small btn-danger', 'Delete');
    dBtn.addEventListener('click', () => {
      confirmDialog('Delete this price record from ' + r.store + '?', async () => {
        await DB.deletePrice(r.id);
        await loadAll();
        toast('Price record deleted.');
        render();
      });
    });
    actions.appendChild(eBtn);
    actions.appendChild(dBtn);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  tableCard.appendChild(tableWrap);
  wrap.appendChild(tableCard);
  view.appendChild(wrap);
}

/* ---------- Compare ---------- */

function renderCompare(view) {
  const wrap = el('div', 'page');
  wrap.appendChild(el('h1', 'page-title', 'Compare stores'));

  if (products.length === 0) {
    const empty = el('div', 'card empty-state');
    empty.appendChild(el('p', 'empty-title', 'Smarter purchases start here.'));
    empty.appendChild(el('p', 'empty-text', 'Add your first product to start tracking prices.'));
    const btn = el('button', 'btn btn-primary', '+ Add first product');
    btn.addEventListener('click', () => openProductDialog(null));
    empty.appendChild(btn);
    wrap.appendChild(empty);
    view.appendChild(wrap);
    return;
  }

  if (!compareProductId || !products.find((p) => p.id === compareProductId)) {
    compareProductId = products[0].id;
  }
  const select = el('select', 'input');
  select.setAttribute('aria-label', 'Choose a product to compare');
  for (const p of products) {
    const o = el('option', '', p.name);
    o.value = p.id;
    select.appendChild(o);
  }
  select.value = compareProductId;
  select.addEventListener('change', () => {
    compareProductId = select.value;
    render();
  });
  wrap.appendChild(select);

  const p = products.find((x) => x.id === compareProductId);
  const comparison = compareStores(getPrices(p.id));
  if (!comparison) {
    wrap.appendChild(el('p', 'muted', 'No prices recorded for this product yet.'));
    view.appendChild(wrap);
    return;
  }
  const currency = productCurrency(p);
  const summary = el('div', 'card');
  summary.appendChild(
    el('p', '', 'Cheapest: ' + comparison.cheapest.store + ' at ' + formatMoney(comparison.cheapest.priceMinor, currency) + ' (recorded ' + comparison.cheapest.date + ').'),
  );
  if (comparison.storeCount > 1) {
    summary.appendChild(
      el('p', '', 'Potential saving vs the most expensive store (' + comparison.dearest.store + '): ' + formatMoney(comparison.savingsMinor, currency) + '.'),
    );
  } else {
    summary.appendChild(el('p', 'muted', 'Only one store recorded so far. Add prices from other stores to compare.'));
  }
  summary.appendChild(
    el('p', 'muted', 'Dates shown so older prices are not mistaken for current offers.'),
  );
  wrap.appendChild(summary);

  const tableWrap = el('div', 'table-wrap card');
  const table = el('table', 'data-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Store', 'Latest price', 'Recorded on', 'Notes']) hr.appendChild(el('th', '', h));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const row of comparison.rows) {
    const tr = el('tr');
    if (row.store === comparison.cheapest.store) tr.classList.add('row-lowest');
    tr.appendChild(el('td', '', row.store));
    const priceCell = el('td', 'num', formatMoney(row.priceMinor, currency));
    if (row.store === comparison.cheapest.store) {
      priceCell.appendChild(document.createTextNode(' '));
      priceCell.appendChild(el('span', 'badge badge-down', 'cheapest'));
    }
    tr.appendChild(priceCell);
    tr.appendChild(el('td', '', row.date));
    tr.appendChild(el('td', '', row.notes || '—'));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);
  view.appendChild(wrap);
}

/* ---------- Settings ---------- */

function renderSettings(view) {
  const wrap = el('div', 'page');
  wrap.appendChild(el('h1', 'page-title', 'Settings'));

  const card = el('section', 'card');
  card.appendChild(el('h2', 'card-title', 'Currency and appearance'));
  const note = el(
    'p',
    'muted',
    'One currency per dataset. Changing the default currency only affects products you add afterwards. Existing prices are never converted or relabelled.',
  );
  card.appendChild(note);
  const curLabel = el('label', 'field-label', 'Default currency for new products');
  const cur = el('select', 'input');
  cur.id = 'settings-currency';
  for (const c of CURRENCIES) {
    const o = el('option', '', c);
    o.value = c;
    cur.appendChild(o);
  }
  cur.value = settings.currency;
  cur.addEventListener('change', async () => {
    settings.currency = cur.value;
    await DB.setSetting('currency', cur.value);
    toast('Default currency set to ' + cur.value + '. Existing products keep their currency.');
  });
  curLabel.appendChild(cur);
  card.appendChild(curLabel);

  const themeLabel = el('label', 'field-label', 'Theme');
  const theme = el('select', 'input');
  for (const [v, label] of [
    ['light', 'Light'],
    ['dark', 'Dark'],
  ]) {
    const o = el('option', '', label);
    o.value = v;
    theme.appendChild(o);
  }
  theme.value = settings.theme;
  theme.addEventListener('change', async () => {
    settings.theme = theme.value;
    await DB.setSetting('theme', theme.value);
    applyTheme();
    toast('Theme set to ' + theme.value + '.');
  });
  themeLabel.appendChild(theme);
  card.appendChild(themeLabel);
  wrap.appendChild(card);

  const dataCard = el('section', 'card');
  dataCard.appendChild(el('h2', 'card-title', 'Data and backups'));
  dataCard.appendChild(
    el('p', 'muted', 'Your data stays in this browser (IndexedDB). Export a backup before clearing browser data.'),
  );
  const btnRow = el('div', 'btn-row');
  const expJson = el('button', 'btn btn-primary', 'Export backup (JSON)');
  expJson.addEventListener('click', async () => {
    const all = await DB.getAllPrices();
    const backup = buildBackup(products, all, settings.currency);
    downloadFile('pricetrail-backup-' + todayISO() + '.json', JSON.stringify(backup, null, 2), 'application/json');
    toast('Backup exported.');
  });
  const expCsv = el('button', 'btn btn-ghost', 'Export prices (CSV)');
  expCsv.addEventListener('click', async () => {
    const all = await DB.getAllPrices();
    const csv = buildCsv(products, all, null, settings.currency);
    downloadFile('pricetrail-prices-' + todayISO() + '.csv', csv, 'text/csv');
    toast('CSV exported.');
  });
  const impBtn = el('button', 'btn btn-ghost', 'Restore backup (JSON)');
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = validateBackup(parsed, { CURRENCIES, validateProduct, validatePrice });
      if (!result.ok) {
        toast('Backup rejected: ' + result.errors[0]);
        return;
      }
      confirmDialog(
        'Restore this backup? It replaces all current products and prices (' +
          result.products.length +
          ' products, ' +
          result.prices.length +
          ' prices).',
        async () => {
          await DB.replaceAll(result.products, result.prices, result.currency);
          await loadAll();
          toast('Backup restored.');
          render();
        },
      );
    } catch (e) {
      toast('Could not read that file: ' + e.message);
    } finally {
      fileInput.value = '';
    }
  });
  impBtn.addEventListener('click', () => fileInput.click());
  btnRow.appendChild(expJson);
  btnRow.appendChild(expCsv);
  btnRow.appendChild(impBtn);
  btnRow.appendChild(fileInput);
  dataCard.appendChild(btnRow);
  wrap.appendChild(dataCard);

  const danger = el('section', 'card danger-zone');
  danger.appendChild(el('h2', 'card-title', 'Delete all data'));
  danger.appendChild(el('p', 'muted', 'Removes every product, price record and setting. Type DELETE to confirm.'));
  const delInput = el('input', 'input');
  delInput.placeholder = 'Type DELETE to confirm';
  delInput.setAttribute('aria-label', 'Type DELETE to confirm deletion');
  const delBtn = el('button', 'btn btn-danger', 'Delete all data');
  delBtn.disabled = true;
  delInput.addEventListener('input', () => {
    delBtn.disabled = delInput.value.trim() !== 'DELETE';
  });
  delBtn.addEventListener('click', async () => {
    await DB.clearAll();
    await loadAll();
    filters = { search: '', category: 'all', movement: 'all', sort: 'name', store: 'all', currency: 'all' };
    compareProductId = null;
    toast('All data deleted.');
    go('dashboard');
  });
  const delRow = el('div', 'btn-row');
  delRow.appendChild(delInput);
  delRow.appendChild(delBtn);
  danger.appendChild(delRow);
  wrap.appendChild(danger);
  view.appendChild(wrap);
}

/* ---------- Dialogs ---------- */

function openProductDialog(product) {
  const dlg = $('product-dialog');
  $('product-dialog-title').textContent = product ? 'Edit product' : 'Add product';
  $('pf-id').value = product ? product.id : '';
  $('pf-name').value = product ? product.name : '';
  $('pf-category').value = product ? product.category : CATEGORIES[0];
  $('pf-brand').value = product ? product.brand || '' : '';
  $('pf-target').value =
    product && typeof product.targetPriceMinor === 'number' ? (product.targetPriceMinor / 100).toFixed(2) : '';
  $('pf-url').value = product ? product.url || '' : '';
  $('pf-notes').value = product ? product.notes || '' : '';
  $('pf-error').textContent = '';
  dlg.showModal();
  $('pf-name').focus();
}

function openPriceDialog(product, record) {
  const dlg = $('price-dialog');
  $('price-dialog-title').textContent = record ? 'Edit price' : 'Add price for ' + product.name;
  $('pr-product-id').value = product.id;
  $('pr-id').value = record ? record.id : '';
  $('pr-store').value = record ? record.store : '';
  $('pr-price').value = record ? (record.priceMinor / 100).toFixed(2) : '';
  $('pr-date').value = record ? record.date : todayISO();
  $('pr-notes').value = record ? record.notes || '' : '';
  $('pr-error').textContent = '';
  dlg.showModal();
  $('pr-store').focus();
}

let confirmAction = null;
function confirmDialog(message, action) {
  $('confirm-message').textContent = message;
  confirmAction = action;
  $('confirm-dialog').showModal();
}

function bindDialogs() {
  $('product-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('pf-error');
    const id = $('pf-id').value || uuid();
    const targetRaw = $('pf-target').value.trim();
    let targetMinor = null;
    if (targetRaw !== '') {
      targetMinor = parseMoneyToMinor(targetRaw);
      if (targetMinor === null) {
        err.textContent = 'Target price must be a number above 0 with at most 2 decimal places.';
        return;
      }
    }
    const existing = products.find((p) => p.id === id);
    const product = {
      id,
      name: $('pf-name').value.trim(),
      category: $('pf-category').value,
      brand: $('pf-brand').value.trim(),
      targetPriceMinor: targetMinor,
      url: $('pf-url').value.trim(),
      notes: $('pf-notes').value.trim(),
      currency: existing ? existing.currency : settings.currency,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const errors = validateProduct(product);
    if (errors.length > 0) {
      err.textContent = errors[0];
      return;
    }
    if (products.length >= MAX_PRODUCTS && !existing) {
      err.textContent = 'You have reached the limit of ' + MAX_PRODUCTS + ' products.';
      return;
    }
    try {
      await DB.putProduct(product);
      await loadAll();
      $('product-dialog').close();
      toast(existing ? 'Product updated.' : 'Product added.');
      render();
    } catch (e) {
      err.textContent = 'Could not save: ' + e.message;
    }
  });

  $('price-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('pr-error');
    const productId = $('pr-product-id').value;
    const priceMinor = parseMoneyToMinor($('pr-price').value);
    if (priceMinor === null) {
      err.textContent = 'Price must be a number above 0 with at most 2 decimal places.';
      return;
    }
    const existing = getPrices(productId).find((r) => r.id === $('pr-id').value);
    const record = {
      id: $('pr-id').value || uuid(),
      productId,
      store: $('pr-store').value.trim(),
      priceMinor,
      date: $('pr-date').value,
      notes: $('pr-notes').value.trim(),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    const errors = validatePrice(record);
    if (errors.length > 0) {
      err.textContent = errors[0];
      return;
    }
    if (getPrices(productId).length >= MAX_PRICES_PER_PRODUCT && !existing) {
      err.textContent = 'This product already has the maximum number of price records.';
      return;
    }
    try {
      await DB.putPrice(record);
      await loadAll();
      $('price-dialog').close();
      toast(existing ? 'Price updated.' : 'Price recorded.');
      render();
    } catch (e) {
      err.textContent = 'Could not save: ' + e.message;
    }
  });

  $('confirm-yes').addEventListener('click', async () => {
    const action = confirmAction;
    confirmAction = null;
    $('confirm-dialog').close();
    if (action) await action();
  });
  $('confirm-no').addEventListener('click', () => {
    confirmAction = null;
    $('confirm-dialog').close();
  });
  document.querySelectorAll('[data-close-dialog]').forEach((b) => {
    b.addEventListener('click', () => b.closest('dialog').close());
  });
}

/* ---------- Init ---------- */

function routeFromHash() {
  const hash = location.hash || '#/dashboard';
  const m = hash.match(/^#\/product\/(.+)$/);
  if (m && products.find((p) => p.id === decodeURIComponent(m[1]))) {
    currentView = 'product';
    detailProductId = decodeURIComponent(m[1]);
    return;
  }
  const v = hash.replace('#/', '');
  currentView = ['dashboard', 'products', 'compare', 'settings'].includes(v) ? v : 'dashboard';
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => go(b.getAttribute('data-nav')));
  });
  bindDialogs();
  try {
    await loadAll();
  } catch (e) {
    toast('Could not open the local database: ' + e.message);
  }
  routeFromHash();
  render();
  window.addEventListener('hashchange', () => {
    routeFromHash();
    render();
  });
});
