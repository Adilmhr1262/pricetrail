/* PriceTrail live check (headless Firefox via playwright-core).
   Fresh browser profile against the live GitHub Pages site.
   Usage: node tests/pricetrail-live-check.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');

const BASE = 'https://adilmhr1262.github.io/pricetrail/';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; failures.push(name); console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await firefox.launch();
  // This VM's Firefox does not trust the GitHub Pages cert chain; curl
  // already verified the live 200s, so the browser check ignores HTTPS errors.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const externalRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('https://adilmhr1262.github.io/pricetrail/')) externalRequests.push(r.url()); });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1200);
    const txt = await page.evaluate(() => document.querySelector('#view').textContent);
    check('live title', (await page.title()).includes('PriceTrail'));
    check('live empty state + zero counts', txt.includes('Smarter purchases start here.'));
    check('live sidebar renders', await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).display !== 'none'));

    // Create a product + price on the live site.
    await page.click('[data-nav="products"]:visible');
    await sleep(300);
    await page.click('.page-head .btn-primary:visible');
    await page.waitForSelector('#product-dialog[open]', { timeout: 10000 });
    await page.fill('#pf-name', 'Live Test Rice');
    await page.selectOption('#pf-category', 'Groceries');
    await page.click('#product-form button[type="submit"]');
    await page.waitForFunction(() => !document.getElementById('product-dialog').open, null, { timeout: 10000 });
    await sleep(300);
    await page.click('.product-card:has-text("Live Test Rice")');
    await sleep(300);
    await page.click('.page-head .btn-primary:visible');
    await page.waitForSelector('#price-dialog[open]', { timeout: 10000 });
    await page.fill('#pr-store', 'Imtiaz');
    await page.fill('#pr-price', '900.00');
    await page.fill('#pr-date', '2026-11-10');
    await page.click('#price-form button[type="submit"]');
    await page.waitForFunction(() => !document.getElementById('price-dialog').open, null, { timeout: 10000 });
    await sleep(400);
    const detail = await page.evaluate(() => document.querySelector('#view').textContent);
    check('live price shown after add', detail.includes('900.00'));
    check('live chart rendered', (await page.locator('svg.price-chart').count()) === 1);

    // Persistence after reload on the live site.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1000);
    await page.click('[data-nav="products"]:visible');
    await sleep(400);
    check('live data persists after reload', (await page.evaluate(() => document.querySelector('#view').textContent)).includes('Live Test Rice'));

    // Mobile viewport on the live site.
    await page.setViewportSize({ width: 375, height: 800 });
    await sleep(400);
    check('live 375px no horizontal overflow',
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('live bottom nav at 375px', await page.evaluate(() => {
      const n = document.querySelector('.bottom-nav');
      return n && getComputedStyle(n).display !== 'none';
    }));

    check('live zero external requests', externalRequests.length === 0, externalRequests.join(', '));
    check('live zero page errors', pageErrors.length === 0, pageErrors.join(' | '));
    check('live zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (e) {
    console.log('LIVE CHECK ERROR: ' + (e && e.stack ? e.stack : e));
    fail++;
    failures.push('runner error: ' + e.message);
  } finally {
    await browser.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  if (failures.length) console.log('Failures:\n- ' + failures.join('\n- '));
  process.exit(fail ? 1 : 0);
})();
