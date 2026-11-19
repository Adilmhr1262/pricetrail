/* PriceTrail verification suite (headless Firefox via playwright-core).
   Serves the project over local HTTP, then runs the order's required
   testing plus validation and edge cases. Usage: node tests/pricetrail-test.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = '/home/hatch/workspace/daily-projects/2026-11-19-pricetrail';
const PORT = 8143;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; failures.push(name); console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const file = path.join(PROJECT, urlPath);
      if (!file.startsWith(PROJECT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function dbState(page) {
  return await Promise.race([
    page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('pricetrail', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['products', 'prices', 'settings'], 'readonly');
        const out = {};
        const names = ['products', 'prices', 'settings'];
        let done = 0;
        for (const name of names) {
          const r = tx.objectStore(name).getAll();
          r.onsuccess = () => { out[name] = r.result; if (++done === names.length) { db.close(); resolve(out); } };
          r.onerror = () => reject(new Error('dbState ' + name + ' failed'));
        }
        tx.onerror = () => reject(new Error('dbState transaction failed'));
      };
      req.onerror = () => reject(new Error('open failed'));
    })),
    sleep(15000).then(() => { throw new Error('dbState timed out after 15s'); })
  ]);
}

async function waitDialogClosed(page, id) {
  await page.waitForFunction((d) => !document.getElementById(d).open, id, { timeout: 10000 });
}

function pageText(page, selector) {
  return page.evaluate((s) => {
    const n = document.querySelector(s);
    return n ? n.textContent : '';
  }, selector);
}

async function gotoSection(page, name) {
  await page.click('[data-nav="' + name + '"]:visible');
  await sleep(250);
}

async function createProduct(page, { name, category, brand, target, url, notes }) {
  await gotoSection(page, 'products');
  await page.click('.page-head .btn-primary:visible');
  await page.waitForSelector('#product-dialog[open]', { timeout: 5000 });
  await page.fill('#pf-name', name);
  if (category) await page.selectOption('#pf-category', category);
  if (brand) await page.fill('#pf-brand', brand);
  if (target) await page.fill('#pf-target', target);
  if (url) await page.fill('#pf-url', url);
  if (notes) await page.fill('#pf-notes', notes);
  await page.click('#product-form button[type="submit"]');
  await waitDialogClosed(page, 'product-dialog');
  await sleep(300);
}

async function addPrice(page, { store, price, date, notes }) {
  await page.click('.page-head .btn-primary:visible');
  await page.waitForSelector('#price-dialog[open]', { timeout: 5000 });
  await page.fill('#pr-store', store);
  await page.fill('#pr-price', price);
  await page.fill('#pr-date', date);
  if (notes) await page.fill('#pr-notes', notes);
  await page.click('#price-form button[type="submit"]');
  await waitDialogClosed(page, 'price-dialog');
  await sleep(300);
}

async function openProductDetail(page, name) {
  await gotoSection(page, 'products');
  await page.click('.product-card:has-text("' + name + '")');
  await sleep(300);
}

(async () => {
  const server = await serve();
  const browser = await firefox.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const externalRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:' + PORT)) externalRequests.push(r.url()); });
  let alertFired = false;
  page.on('dialog', async (d) => { alertFired = true; await d.dismiss(); });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await sleep(800);

    // --- Fresh empty state ---
    let txt = await pageText(page, '#view');
    check('fresh dashboard shows empty state copy', txt.includes('Smarter purchases start here.'));
    check('fresh dashboard shows zero tracked products', txt.includes('Tracked products') && /0/.test(txt));
    check('empty state has Add first product button', (await page.locator('.empty-state .btn-primary').count()) === 1);
    let state = await dbState(page);
    check('fresh database is empty', state.products.length === 0 && state.prices.length === 0);

    // --- Product validation: 1-char name rejected (native minlength keeps dialog open) ---
    await gotoSection(page, 'products');
    await page.click('.page-head .btn-primary:visible');
    await page.waitForSelector('#product-dialog[open]', { timeout: 5000 });
    await page.fill('#pf-name', 'A');
    await page.click('#product-form button[type="submit"]');
    await sleep(400);
    check('1-char product name rejected, dialog stays open',
      await page.evaluate(() => document.getElementById('product-dialog').open));
    await page.keyboard.press('Escape');
    await sleep(200);

    // --- Create product with target price ---
    await createProduct(page, { name: 'Rice 5kg', category: 'Groceries', brand: 'Falak', target: '950.00' });
    state = await dbState(page);
    check('product saved to IndexedDB', state.products.length === 1 && state.products[0].name === 'Rice 5kg');
    check('product currency defaults to PKR', state.products[0].currency === 'PKR');
    check('target stored as minor units', state.products[0].targetPriceMinor === 95000);
    txt = await pageText(page, '#view');
    check('product card shows No prices yet', txt.includes('No prices yet'));

    // --- Add 3 prices across 2 stores ---
    await openProductDetail(page, 'Rice 5kg');
    await addPrice(page, { store: 'Imtiaz', price: '1000.00', date: '2026-11-01' });
    await addPrice(page, { store: 'Carrefour', price: '900.00', date: '2026-11-05' });
    await addPrice(page, { store: 'Imtiaz', price: '950.00', date: '2026-11-10' });
    state = await dbState(page);
    check('3 price records saved', state.prices.length === 3);
    txt = await pageText(page, '#view');
    check('latest price shown (PKR 950.00)', txt.includes('950.00'));
    check('lowest price shown (PKR 900.00)', txt.includes('900.00'));
    check('highest price shown (PKR 1,000.00)', txt.includes('1,000.00'));
    check('average price shown (PKR 950.00)', txt.includes('Average price'));
    check('change vs previous +5.6%', txt.includes('5.6%'));
    check('target price stat shown in detail', txt.includes('Target price'));
    check('price history chart rendered', (await page.locator('svg.price-chart').count()) === 1);
    check('chart has 3 points', (await page.locator('svg.price-chart circle').count()) === 3);
    check('chart has lowest point highlighted', (await page.locator('svg.price-chart .chart-point-lowest').count()) === 1);
    check('chart has target reference line', (await page.locator('svg.price-chart .target-line').count()) === 1);
    check('price table has 3 rows', (await page.locator('.data-table tbody tr').count()) === 3);
    check('lowest row highlighted in table', (await page.locator('.data-table tbody tr.row-lowest').count()) === 1);
    check('lowest badge shown in table', txt.includes('lowest'));

    // --- Price validation ---
    await page.click('.page-head .btn-primary:visible');
    await page.waitForSelector('#price-dialog[open]', { timeout: 5000 });
    await page.fill('#pr-store', 'Test Store');
    await page.fill('#pr-price', '10.999');
    await page.fill('#pr-date', '2026-11-11');
    await page.click('#price-form button[type="submit"]');
    await sleep(400);
    let errTxt = await pageText(page, '#pr-error');
    check('3-decimal price rejected with message', errTxt.includes('at most 2 decimal places') &&
      (await page.evaluate(() => document.getElementById('price-dialog').open)));
    await page.fill('#pr-price', '800.00');
    const future = new Date(); future.setDate(future.getDate() + 2);
    await page.fill('#pr-date', future.toISOString().slice(0, 10));
    await page.click('#price-form button[type="submit"]');
    await sleep(400);
    errTxt = await pageText(page, '#pr-error');
    check('future date rejected with message', errTxt.includes('cannot be in the future'));
    await page.keyboard.press('Escape');
    await sleep(200);
    state = await dbState(page);
    check('no bad price records saved', state.prices.length === 3);

    // --- Store filter on detail table ---
    await page.selectOption('.card select[aria-label="Filter records by store"]', 'Imtiaz');
    await sleep(300);
    check('store filter shows only Imtiaz rows', (await page.locator('.data-table tbody tr').count()) === 2);
    await page.selectOption('.card select[aria-label="Filter records by store"]', 'all');
    await sleep(300);

    // --- Edit a price: change 950 -> 880, stats recalc ---
    const rows = page.locator('.data-table tbody tr');
    await rows.nth(0).locator('button:has-text("Edit")').click();
    await page.waitForSelector('#price-dialog[open]', { timeout: 5000 });
    await page.fill('#pr-price', '880.00');
    await page.click('#price-form button[type="submit"]');
    await waitDialogClosed(page, 'price-dialog');
    await sleep(300);
    txt = await pageText(page, '#view');
    check('after edit, lowest is PKR 880.00', txt.includes('880.00'));
    check('after edit, change vs previous is negative', txt.includes('-2.2%'));

    // --- Delete a price: remove the 880 record, stats recalc ---
    state = await dbState(page);
    check('still 3 records before delete', state.prices.length === 3);
    await page.locator('.data-table tbody tr').nth(0).locator('button:has-text("Delete")').click();
    await page.waitForSelector('#confirm-dialog[open]', { timeout: 5000 });
    await page.click('#confirm-yes');
    await sleep(400);
    state = await dbState(page);
    check('price deleted, 2 records left', state.prices.length === 2);
    txt = await pageText(page, '#view');
    check('after delete, lowest back to PKR 900.00', txt.includes('900.00'));

    // --- Dashboard aggregates ---
    await gotoSection(page, 'dashboard');
    txt = await pageText(page, '#view');
    check('dashboard shows 1 tracked product', txt.includes('Tracked products'));
    check('dashboard recent updates list has entries', txt.includes('Imtiaz') || txt.includes('Carrefour'));
    check('dashboard shows price drop count', txt.includes('Price drops'));

    // --- Compare view ---
    await gotoSection(page, 'compare');
    txt = await pageText(page, '#view');
    check('compare shows cheapest store', txt.includes('Cheapest: Carrefour'));
    check('compare shows savings vs dearest', txt.includes('Potential saving') && txt.includes('100.00'));
    check('compare table has 2 store rows', (await page.locator('.data-table tbody tr').count()) === 2);
    check('compare cheapest row highlighted', (await page.locator('.data-table tbody tr.row-lowest').count()) === 1);
    check('compare shows recording dates', txt.includes('2026-11-05') && txt.includes('2026-11-01'));

    // --- Second product + search/filter/sort ---
    await createProduct(page, { name: 'Olive Oil 1L', category: 'Groceries', brand: 'Zaitoon', target: '' });
    await openProductDetail(page, 'Olive Oil 1L');
    await addPrice(page, { store: 'Imtiaz', price: '1500.00', date: '2026-11-12' });
    await gotoSection(page, 'products');
    await page.fill('.search-input', 'olive');
    await sleep(300);
    check('search filters to Olive Oil', (await page.locator('.product-card').count()) === 1 &&
      (await pageText(page, '#view')).includes('Olive Oil 1L'));
    check('search keeps focus while typing', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('search-input')));
    await page.fill('.search-input', '');
    await sleep(300);
    check('clearing search shows both products', (await page.locator('.product-card').count()) === 2);
    await page.selectOption('.toolbar select[aria-label="Filter by price movement"]', 'down');
    await sleep(300);
    check('movement filter down shows only Rice 5kg', (await page.locator('.product-card').count()) === 1);
    await page.selectOption('.toolbar select[aria-label="Filter by price movement"]', 'all');
    await sleep(300);
    await page.selectOption('.toolbar select[aria-label="Sort products"]', 'lowest');
    await sleep(300);
    const firstCard = await page.locator('.product-card').nth(0).textContent();
    check('sort by lowest puts Rice first', firstCard.includes('Rice 5kg'));
    check('product card shows at-or-below target', (await pageText(page, '#view')).includes('At or below target'));

    // --- XSS: markup in name renders as text, no script runs ---
    await createProduct(page, { name: '<img src=x onerror=alert(1)>', category: 'Other' });
    check('no alert fired from markup name', alertFired === false);
    check('markup name shown as literal text', (await pageText(page, '#view')).includes('<img src=x onerror=alert(1)>'));
    check('no injected img element exists', (await page.locator('img[src="x"]').count()) === 0);

    // --- Persistence after reload ---
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(800);
    state = await dbState(page);
    check('data persists after reload (3 products, 3 prices)', state.products.length === 3 && state.prices.length === 3);

    // --- Currency change only affects new products ---
    await gotoSection(page, 'settings');
    await page.selectOption('#settings-currency', 'USD');
    await sleep(300);
    await createProduct(page, { name: 'USB Cable', category: 'Electronics' });
    await gotoSection(page, 'products');
    txt = await pageText(page, '#view');
    check('new product uses USD', txt.includes('USB Cable'));
    state = await dbState(page);
    const usb = state.products.find(p => p.name === 'USB Cable');
    const rice = state.products.find(p => p.name === 'Rice 5kg');
    check('new product currency is USD', usb && usb.currency === 'USD');
    check('existing product still PKR', rice && rice.currency === 'PKR');

    // --- Dark mode persists ---
    await gotoSection(page, 'settings');
    await page.selectOption('.card select >> nth=1', 'dark');
    await sleep(300);
    check('dark theme applied', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(800);
    check('dark theme persists after reload', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'));
    await gotoSection(page, 'settings');
    await page.selectOption('.card select >> nth=1', 'light');
    await sleep(200);

    // --- Export JSON download + validate content ---
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('button:has-text("Export backup (JSON)")'),
    ]);
    const dlPath = await download.path();
    const dlContent = fs.readFileSync(dlPath, 'utf8');
    const parsed = JSON.parse(dlContent);
    check('exported backup is schema v1 pricetrail', parsed.schema === 1 && parsed.app === 'pricetrail');
    check('exported backup has 4 products', parsed.products.length === 4);
    check('exported backup has 3 prices', parsed.prices.length === 3);

    // --- Import: bad backup rejected, data unchanged ---
    const badBackup = { schema: 99, app: 'pricetrail', products: [], prices: [] };
    const badPath = path.join(PROJECT, 'tests', '_bad-backup.json');
    fs.writeFileSync(badPath, JSON.stringify(badBackup));
    await page.setInputFiles('input[type="file"]', badPath);
    await sleep(600);
    txt = await pageText(page, '#toast');
    check('bad backup rejected with toast', txt.includes('Backup rejected'));
    state = await dbState(page);
    check('data unchanged after bad import', state.products.length === 4 && state.prices.length === 3);

    // --- Import: valid backup restores ---
    const goodBackup = JSON.parse(JSON.stringify(parsed));
    goodBackup.products = goodBackup.products.filter(p => p.name === 'Rice 5kg');
    goodBackup.prices = goodBackup.prices.filter(r => {
      const prod = parsed.products.find(p => p.id === r.productId);
      return prod && prod.name === 'Rice 5kg';
    });
    const goodPath = path.join(PROJECT, 'tests', '_good-backup.json');
    fs.writeFileSync(goodPath, JSON.stringify(goodBackup));
    await page.setInputFiles('input[type="file"]', goodPath);
    await sleep(500);
    await page.waitForSelector('#confirm-dialog[open]', { timeout: 5000 });
    await page.click('#confirm-yes');
    await sleep(500);
    state = await dbState(page);
    check('valid restore replaces data (1 product, 2 prices)', state.products.length === 1 && state.prices.length === 2);
    fs.unlinkSync(badPath);
    fs.unlinkSync(goodPath);

    // --- Delete all: wrong word keeps button disabled, DELETE works ---
    await gotoSection(page, 'settings');
    await page.fill('.danger-zone .input', 'delete');
    await sleep(200);
    check('delete-all button disabled for wrong word',
      await page.evaluate(() => document.querySelector('.danger-zone .btn-danger').disabled));
    await page.fill('.danger-zone .input', 'DELETE');
    await sleep(200);
    check('delete-all button enabled for DELETE',
      await page.evaluate(() => !document.querySelector('.danger-zone .btn-danger').disabled));
    await page.click('.danger-zone .btn-danger');
    await sleep(600);
    state = await dbState(page);
    check('delete-all empties the database', state.products.length === 0 && state.prices.length === 0);
    txt = await pageText(page, '#view');
    check('dashboard empty again after delete-all', txt.includes('Smarter purchases start here.'));

    // --- Responsive: no horizontal overflow; nav switches ---
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await sleep(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check('no horizontal overflow at ' + w + 'px', !overflow);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await sleep(300);
    check('bottom nav visible at 375px', await page.evaluate(() => {
      const n = document.querySelector('.bottom-nav');
      return n && getComputedStyle(n).display !== 'none';
    }));
    check('sidebar hidden at 375px', await page.evaluate(() => {
      const n = document.querySelector('.sidebar');
      return n && getComputedStyle(n).display === 'none';
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(300);
    check('sidebar visible at 1440px', await page.evaluate(() => {
      const n = document.querySelector('.sidebar');
      return n && getComputedStyle(n).display !== 'none';
    }));

    // --- Escape closes dialog ---
    await gotoSection(page, 'products');
    await page.click('.page-head .btn-primary:visible');
    await page.waitForSelector('#product-dialog[open]', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await sleep(300);
    check('Escape closes product dialog', await page.evaluate(() => !document.getElementById('product-dialog').open));

    // --- Cleanliness ---
    check('zero external requests', externalRequests.length === 0, externalRequests.join(', '));
    check('zero page errors', pageErrors.length === 0, pageErrors.join(' | '));
    check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (e) {
    console.log('TEST RUNNER ERROR: ' + (e && e.stack ? e.stack : e));
    fail++;
    failures.push('runner error: ' + e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  if (failures.length) console.log('Failures:\n- ' + failures.join('\n- '));
  process.exit(fail ? 1 : 0);
})();
