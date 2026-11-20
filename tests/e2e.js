// Run: (python3 -m http.server 8765 &) ; NODE_PATH=<playwright path> node tests/e2e.js
const { chromium } = require('playwright'); const fs = require('fs');
const URL = 'http://localhost:8765/index.html'; let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL', m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForSelector('.hero');
  ok((await page.textContent('.hero h1')) === 'My Cloth Shop', 'dashboard renders, default settings');
  ok((await page.$$('#nav a')).length === 6, '6 nav items');
  // --- New sale ---
  await page.click('#nav a[data-nav=sale]'); await page.waitForSelector('#catChips');
  const addLine = async (cat, w, unit) => { await page.click(`#catChips .chip:has-text("${cat}")`); if (unit === 'g') await page.click('#unitSeg [data-unit=g]'); else await page.click('#unitSeg [data-unit=kg]'); await page.fill('#bWeight', w); await page.click('[data-act=add-item]'); };
  await addLine('Cotton', '2.500', 'kg'); await addLine('Jeans', '1250', 'g');
  let tot = await page.textContent('#totalsCard'); ok(tot.includes('₹1,312.50') && tot.includes('3.750 KG') && tot.includes('₹325.00'), 'combined total ₹1,312.50, 3.750 KG, profit ₹325.00');
  await page.click('[data-act=add-item]'); ok((await page.$$('.item-row')).length === 2, 'adding with empty weight rejected');
  await page.fill('#bWeight', '-3'); ok((await page.textContent('#linePrev')).length > 0 && (await page.$eval('#linePrev', (e) => e.className)).includes('err'), 'negative weight flagged');
  await page.fill('#bDisc', '12.50'); tot = await page.textContent('#totalsCard'); ok(tot.includes('₹1,300.00'), 'discount applied → ₹1,300.00');
  await page.fill('#bDisc', '9999'); tot = await page.textContent('#totalsCard'); ok(tot.includes('exceed'), 'discount > subtotal rejected');
  await page.fill('#bDisc', '12.50'); await page.click('#payChips [data-pay=UPI]');
  // customer
  await page.click('#custBtn'); await page.click('[data-newcust]'); await page.fill('#cfN', 'Asha Devi'); await page.fill('#cfP', '9876543210'); await page.click('#cfS');
  await page.waitForTimeout(400); ok((await page.textContent('#custBtn')).includes('Asha Devi'), 'customer added & selected');
  // double click save → duplicate prevention
  await page.evaluate(() => { const b = document.getElementById('saveBtn'); b.click(); b.click(); });
  await page.waitForSelector('#invoicePaper'); await page.waitForTimeout(500);
  const paper = await page.textContent('#invoicePaper');
  ok(paper.includes('INV-00001') && paper.includes('₹1,300.00') && paper.includes('Asha Devi'), 'invoice INV-00001 shown');
  const sales1 = await page.evaluate(async () => (await DB.getAll('sales')).length); ok(sales1 === 1, 'double-click created exactly one sale');
  // PDF
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=pdf]')]); await dl.saveAs('/tmp/inv.pdf'); ok(fs.statSync('/tmp/inv.pdf').size > 5000, 'PDF downloaded: ' + dl.suggestedFilename());
  // WhatsApp (capture window.open)
  await page.evaluate(() => { window.__opened = null; window.open = (u) => { window.__opened = u; }; }); await page.click('[data-act=wa]');
  const wa = await page.evaluate(() => window.__opened); ok(wa && wa.startsWith('https://wa.me/919876543210?text='), 'WhatsApp link targets customer phone');
  // --- persistence ---
  await page.reload(); await page.waitForSelector('#invoicePaper'); ok((await page.textContent('#invoicePaper')).includes('INV-00001'), 'invoice survives reload');
  // --- history ---
  await page.click('#nav a[data-nav=history]'); await page.waitForSelector('.row-card');
  await page.fill('#hq', 'asha'); ok((await page.$$('.row-card')).length === 1, 'search by customer'); await page.fill('#hq', 'INV-9'); ok((await page.$$('.row-card')).length === 0, 'search no match'); await page.fill('#hq', '');
  // --- offline sale ---
  await page.waitForTimeout(1500); await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.page');
  ok((await page.$eval('#offline', (e) => !e.classList.contains('hide'))), 'offline banner visible & app loads offline (service worker)');
  await page.click('#nav a[data-nav=sale]'); await page.waitForSelector('#catChips'); await addLine('T-shirts', '0.750', 'kg'); await page.click('#saveBtn'); await page.waitForSelector('#invoicePaper');
  ok((await page.textContent('#invoicePaper')).includes('INV-00002') && (await page.textContent('#invoicePaper')).includes('Guest'), 'guest + offline sale saved as INV-00002');
  await ctx.setOffline(false);
  // --- cancel with reversal ---
  await page.click('#nav a[data-nav=history]'); await page.waitForSelector('.row-card'); await page.click('.row-card:has-text("INV-00002")'); await page.waitForSelector('[data-act=cancel]');
  await page.click('[data-act=cancel]'); await page.fill('#cReason', 'test'); await page.click('#cGo'); await page.waitForTimeout(600);
  const state = await page.evaluate(async () => { const a = await DB.getAll('sales'); return { n: a.length, rev: a.filter((s) => s.kind === 'reversal').length, canc: a.filter((s) => s.status === 'cancelled').length }; });
  ok(state.n === 3 && state.rev === 1 && state.canc === 1, 'cancel keeps original and adds reversal record');
  await page.click('[data-act=cancel]').catch(() => {}); // button must be gone
  // --- dashboard ---
  await page.click('#nav a[data-nav=dashboard]'); await page.waitForSelector('.tiles'); const dash = await page.textContent('.tiles');
  ok(dash.includes('₹1,300.00') && dash.includes('3.750 KG'), 'dashboard net of cancelled sale (₹1,300.00 / 3.750 KG)'); ok(dash.includes('UPI collection₹1,300.00'.replace('UPI collection', 'UPI collection')), 'UPI collection = ₹1,300.00');
  // --- reports + exports ---
  await page.click('#nav a[data-nav=reports]'); await page.waitForSelector('#rOut .tiles'); await page.waitForTimeout(300);
  const [x] = await Promise.all([page.waitForEvent('download'), page.click('[data-x=xlsx]')]); await x.saveAs('/tmp/rep.xlsx'); ok(fs.statSync('/tmp/rep.xlsx').size > 1000, 'Excel report downloaded');
  const [pd] = await Promise.all([page.waitForEvent('download'), page.click('[data-x=pdf]')]); await pd.saveAs('/tmp/rep.pdf'); ok(fs.statSync('/tmp/rep.pdf').size > 5000, 'PDF report downloaded');
  // --- categories ---
  await page.goto(URL + '#/categories'); await page.waitForSelector('.card'); await page.click('[data-act=add]'); await page.fill('#kN', 'Silk'); await page.fill('#kB', '500'); await page.fill('#kS', '650'); await page.click('#kSave'); await page.waitForTimeout(500);
  ok((await page.textContent('#view')).includes('Silk'), 'custom category added');
  // price change doesn't alter old bill
  await page.evaluate(async () => { const c = App.categories.find((x) => x.name === 'Cotton'); c.sellPerKg = 99900; c.buyPerKg = 1; await DB.put('categories', c); });
  const old = await page.evaluate(async () => (await DB.getAll('sales')).find((s) => s.invoiceNo === 'INV-00001').profit); ok(old === 12500 + 20000 - 1250, 'old bill profit unchanged after price change');
  // --- backup / restore ---
  await page.goto(URL + '#/settings'); await page.waitForSelector('[data-act=bk-export]');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=bk-export]')]); await bk.saveAs('/tmp/backup.json'); const bj = JSON.parse(fs.readFileSync('/tmp/backup.json')); ok(bj.data.sales.length === 3 && !JSON.stringify(bj).includes('pinHash'), 'backup JSON has 3 sales');
  await page.evaluate(async () => { await DB.clear('sales'); });
  await page.setInputFiles('#bkFile', '/tmp/backup.json'); await page.waitForSelector('[data-m=replace]'); await page.click('[data-m=replace]'); await page.waitForTimeout(1200);
  const after = await page.evaluate(async () => ({ n: (await DB.getAll('sales')).length, next: await DB.peekNextInvoiceNumber() })); ok(after.n === 3 && after.next === 3, 'restore brings back 3 sales, counter continues at 3');
  // --- PIN ---
  await page.evaluate(async () => { const salt = 's'; const h = await (async (p) => { const d = new TextEncoder().encode(salt + ':' + p); const x = await crypto.subtle.digest('SHA-256', d); return [...new Uint8Array(x)].map((b) => b.toString(16).padStart(2, '0')).join(''); })('1234'); await DB.setSettings({ pinHash: h, pinSalt: salt, pinLen: 4 }); });
  await page.reload(); await page.waitForSelector('#lock:not(.hide) .keypad'); for (const k of '9999') await page.click(`[data-k="${k}"]`); await page.waitForTimeout(300); ok((await page.textContent('#lockMsg')) === 'Wrong PIN', 'wrong PIN rejected');
  for (const k of '1234') await page.click(`[data-k="${k}"]`); await page.waitForTimeout(300); ok(await page.$eval('#lock', (e) => e.classList.contains('hide')), 'correct PIN unlocks');
  await page.screenshot({ path: '/tmp/shot-dash.png' });
  ok(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); console.log(fails ? `${fails} FAILED` : 'ALL E2E PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
