/* PriceTrail regression suite for ChatGPT review round 1 findings:
   A. currency-aware sorting (no cross-currency lowest-price comparison)
   B. CSV formula-injection protection
   Plus: chart touch/keyboard access, backup/restore preserving currencies.
   Usage: node tests/pricetrail-regression.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = '/home/hatch/workspace/daily-projects/2026-11-19-pricetrail';
const PORT = 8144;
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

async function createProduct(page, { name, category, target }) {
  await gotoSection(page, 'products');
  await page.click('.page-head .btn-primary:visible');
  await page.waitForSelector('#product-dialog[open]', { timeout: 5000 });
  await page.fill('#pf-name', name);
  if (category) await page.selectOption('#pf-category', category);
  if (target) await page.fill('#pf-target', target);
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

(async () => {
  const server = await serve();
  const browser = await firefox.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await sleep(800);

    // --- Setup: PKR product (lowest 900.00) and USD product (5.00, numerically lower) ---
    await createProduct(page, { name: 'Rice 5kg', category: 'Groceries', target: '950.00' });
    await page.click('.product-card:has-text("Rice 5kg")');
    await sleep(300);
    await addPrice(page, { store: 'Imtiaz', price: '1000.00', date: '2026-11-01' });
    await addPrice(page, { store: 'Carrefour', price: '900.00', date: '2026-11-05' });
    await addPrice(page, { store: 'Imtiaz', price: '950.00', date: '2026-11-10' });

    await gotoSection(page, 'settings');
    await page.selectOption('#settings-currency', 'USD');
    await sleep(300);
    await createProduct(page, { name: 'USB Cable', category: 'Electronics' });
    await page.click('.product-card:has-text("USB Cable")');
    await sleep(300);
    await addPrice(page, { store: 'Amazon', price: '5.00', date: '2026-11-12' });

    // --- A1: lowest-price sort groups by currency, never compares across it ---
    await gotoSection(page, 'products');
    await page.selectOption('.toolbar select[aria-label="Sort products"]', 'lowest');
    await sleep(300);
    const order = await page.locator('.product-card .product-name').allTextContents();
    check('lowest sort keeps PKR product before USD product (no raw cross-currency compare)',
      order[0] === 'Rice 5kg' && order[1] === 'USB Cable', order.join(' | '));
    check('grouping notice shown when sorting mixed currencies by lowest price',
      (await pageText(page, '#view')).includes('Prices in different currencies are not compared'));

    // --- A2: currency filter limits the list and the sort to one currency ---
    await page.selectOption('.toolbar select[aria-label="Filter by currency"]', 'USD');
    await sleep(300);
    check('currency filter USD shows only the USD product',
      (await page.locator('.product-card').count()) === 1 &&
      (await pageText(page, '#view')).includes('USB Cable'));
    check('no grouping notice needed inside one currency',
      !(await pageText(page, '#view')).includes('Prices in different currencies are not compared'));
    await page.selectOption('.toolbar select[aria-label="Filter by currency"]', 'PKR');
    await sleep(300);
    check('currency filter PKR shows only the PKR product',
      (await page.locator('.product-card').count()) === 1 &&
      (await pageText(page, '#view')).includes('Rice 5kg'));
    await page.selectOption('.toolbar select[aria-label="Filter by currency"]', 'all');
    await sleep(300);

    // --- Chart access: keyboard focus and tap/click show the tooltip ---
    await page.click('.product-card:has-text("Rice 5kg")');
    await sleep(300);
    await page.locator('svg.price-chart circle').first().focus();
    await sleep(200);
    check('keyboard focus on a chart point shows the tooltip',
      await page.evaluate(() => {
        const t = document.querySelector('.chart-tooltip');
        return t && !t.hidden && t.textContent.includes('Imtiaz');
      }));
    await page.locator('svg.price-chart circle').nth(1).click();
    await sleep(200);
    check('click/tap on a chart point shows the tooltip',
      await page.evaluate(() => {
        const t = document.querySelector('.chart-tooltip');
        return t && !t.hidden && t.textContent.includes('Carrefour');
      }));

    // --- B: malicious values in product/store/notes, then CSV export ---
    await createProduct(page, { name: "=2+5+cmd|' /C calc'!A0", category: 'Other' });
    await page.click('.product-card:has-text("2+5")');
    await sleep(300);
    await addPrice(page, { store: '@SUM(A1:A10)', price: '10.00', date: '2026-11-13', notes: '=HYPERLINK("http://evil.example", "click")' });
    await gotoSection(page, 'settings');
    const [csvDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('button:has-text("Export prices (CSV)")'),
    ]);
    const csvPath = await csvDownload.path();
    const csv = fs.readFileSync(csvPath, 'utf8');
    check('CSV neutralises formula product name', csv.includes("\"'=2+5+cmd|' /C calc'!A0\""), csv.split('\n').find(l => l.includes('2+5')) || '');
    check('CSV neutralises formula store', csv.includes("\"'@SUM(A1:A10)\""));
    check('CSV neutralises formula note', csv.includes("\"'=HYPERLINK"));
    check('CSV has no un-neutralised formula cell', !csv.split('\n').some(l => /(^|,)\"[=+\-@]/.test(l)));
    check('CSV carries currency per record (PKR and USD rows)',
      csv.includes(',"PKR",') && csv.includes(',"USD",'));

    // --- Backup/restore preserves each product's currency ---
    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('button:has-text("Export backup (JSON)")'),
    ]);
    const jsonPath = await jsonDownload.path();
    const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const byName = {};
    for (const p of backup.products) byName[p.name] = p.currency;
    check('backup stores PKR for Rice and USD for USB Cable',
      byName['Rice 5kg'] === 'PKR' && byName['USB Cable'] === 'USD', JSON.stringify(byName));
    await page.fill('.danger-zone .input', 'DELETE');
    await sleep(200);
    await page.click('.danger-zone .btn-danger');
    await sleep(600);
    let state = await dbState(page);
    check('delete-all emptied database before restore', state.products.length === 0 && state.prices.length === 0);
    await gotoSection(page, 'settings');
    await page.setInputFiles('input[type="file"]', jsonPath);
    await sleep(500);
    await page.waitForSelector('#confirm-dialog[open]', { timeout: 5000 });
    await page.click('#confirm-yes');
    await sleep(500);
    state = await dbState(page);
    const restored = {};
    for (const p of state.products) restored[p.name] = p.currency;
    check('restore preserves mixed currencies',
      state.products.length === 3 && restored['Rice 5kg'] === 'PKR' && restored['USB Cable'] === 'USD',
      JSON.stringify(restored));
    check('restore preserves all price records', state.prices.length === 5);

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
