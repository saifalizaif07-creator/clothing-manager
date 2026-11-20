// Run: node tests/unit.test.js   (pure logic: money/weight maths, xlsx/zip, pdf assembly, reports aggregation)
const assert = require('assert');
global.window = undefined;
const B = require('../billing.js');
const Backup = require('../backup.js');
const Invoice = require('../invoice.js');
const Reports = require('../reports.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

t('parseMoney / parseGrams', () => {
  assert.strictEqual(B.parseMoney('300'), 30000); assert.strictEqual(B.parseMoney('562.5'), 56250); assert.ok(Number.isNaN(B.parseMoney('-5')));
  assert.ok(Number.isNaN(B.parseMoney('1.234'))); assert.ok(Number.isNaN(B.parseMoney('abc')));
  assert.strictEqual(B.parseGrams('2.500', 'kg'), 2500); assert.strictEqual(B.parseGrams('0.250', 'kg'), 250); assert.strictEqual(B.parseGrams('.5', 'kg'), 500);
  assert.strictEqual(B.parseGrams('750', 'g'), 750); assert.ok(Number.isNaN(B.parseGrams('7.5', 'g'))); assert.ok(Number.isNaN(B.parseGrams('-1', 'kg'))); assert.ok(Number.isNaN(B.parseGrams('1.2345', 'kg')));
  assert.strictEqual(B.parseGrams('0.1', 'kg') + B.parseGrams('0.2', 'kg'), 300);   // no float drift
});
t('Cotton example: 2.500 KG @ 300/220', () => { const r = B.lineTotals(2500, 22000, 30000); assert.deepStrictEqual(r, { revenue: 75000, cost: 55000, profit: 20000 }); });
t('Jeans example: 1.250 KG @ 450/350', () => { const r = B.lineTotals(1250, 35000, 45000); assert.deepStrictEqual(r, { revenue: 56250, cost: 43750, profit: 12500 }); });
t('Combined bill', () => {
  const b = B.computeBill([{ grams: 2500, buyPerKg: 22000, sellPerKg: 30000 }, { grams: 1250, buyPerKg: 35000, sellPerKg: 45000 }], {});
  assert.strictEqual(b.totalGrams, 3750); assert.strictEqual(b.subtotal, 131250); assert.strictEqual(b.cost, 98750); assert.strictEqual(b.profit, 32500); assert.strictEqual(b.total, 131250);
  assert.strictEqual(B.fmtMoney(b.subtotal), '₹1,312.50'); assert.strictEqual(B.fmtMoney(b.cost), '₹987.50'); assert.strictEqual(B.fmtKg(b.totalGrams), '3.750 KG');
});
t('Discounts (amount & percent) and extra charges', () => {
  const it = [{ grams: 2500, buyPerKg: 22000, sellPerKg: 30000 }];
  let b = B.computeBill(it, { discountMode: 'amount', discountInput: 5000, extra: 2000 }); assert.strictEqual(b.total, 75000 - 5000 + 2000); assert.strictEqual(b.profit, 20000 - 5000 + 2000);
  b = B.computeBill(it, { discountMode: 'percent', discountInput: B.parsePercent('10') }); assert.strictEqual(b.discount, 7500); assert.strictEqual(b.total, 67500); assert.strictEqual(b.profit, 12500);
  b = B.computeBill(it, { discountMode: 'amount', discountInput: 80000 }); assert.ok(b.errors.length);
});
t('Gram-to-KG conversion & rounding', () => { assert.strictEqual(B.lineTotals(333, 0, 10000).revenue, 3330); assert.strictEqual(B.lineTotals(1, 0, 30000).revenue, 30); assert.strictEqual(B.fmtKg(250), '0.250 KG'); assert.strictEqual(B.fmtMoney(-12345), '-₹123.45'); });
t('validateCategory', () => {
  assert.ok(B.validateCategory('', 1, 1, []).length); assert.ok(B.validateCategory('A', 100, 0, []).length); assert.ok(B.validateCategory('Cotton', 1, 2, [{ id: 'x', name: 'cotton' }]).length); assert.strictEqual(B.validateCategory('Cotton', 0, 2, []).length, 0);
});
function mkSale() {
  const items = [{ categoryId: 'c', name: 'Cotton', grams: 2500, buyPerKg: 22000, sellPerKg: 30000, revenue: 75000, cost: 55000, profit: 20000 }];
  return { id: 'a', kind: 'sale', status: 'completed', invoiceNo: 'INV-00001', day: '2026-11-19', createdAt: '2026-11-19T10:00:00.000Z', items, totalGrams: 2500, subtotal: 75000, discount: 5000, extra: 0, total: 70000, cost: 55000, profit: 15000, payment: 'Cash', customerName: 'Guest' };
}
t('validateSale integrity', () => { const s = mkSale(); assert.deepStrictEqual(B.validateSale(s), []); s.total = 1; assert.ok(B.validateSale(s).length); const z = mkSale(); z.items[0].grams = -5; assert.ok(B.validateSale(z).length); });
t('Reports aggregation incl. reversal nets to zero', () => {
  const s = mkSale(); const r = Object.assign(JSON.parse(JSON.stringify(s)), { id: 'b', kind: 'reversal', invoiceNo: 'INV-00001-R' });
  r.items.forEach((i) => { i.grams = -i.grams; i.revenue = -i.revenue; i.cost = -i.cost; i.profit = -i.profit; }); ['totalGrams', 'subtotal', 'discount', 'extra', 'total', 'cost', 'profit'].forEach((k) => { r[k] = -r[k]; });
  assert.deepStrictEqual(B.validateSale(r), []);
  const a1 = Reports.aggregate([s]); assert.strictEqual(a1.total.sales, 70000); assert.strictEqual(a1.total.pay.Cash, 70000); assert.strictEqual(a1.total.bills, 1);
  const a2 = Reports.aggregate([s, r]); assert.strictEqual(a2.total.sales, 0); assert.strictEqual(a2.total.profit, 0); assert.strictEqual(a2.total.grams, 0); assert.strictEqual(a2.total.bills, 0);
  assert.deepStrictEqual(Reports.rangeFor('week', '2026-11-19'), { from: '2026-11-16', to: '2026-11-22', label: 'Week 2026-11-16 to 2026-11-22' });
  assert.strictEqual(Reports.rangeFor('month', '2026-02').to, '2026-02-28');
});
t('XLSX zip structure + CRC', () => {
  assert.strictEqual(Backup.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = Backup.buildXlsx([{ name: 'A/B:C', rows: [[{ v: 'H', s: 'head' }], ['x & <y>', { v: 12.5, s: 'money' }]] }]);
  require('fs').writeFileSync('/tmp/t.xlsx', bytes); assert.strictEqual(bytes[0], 0x50);
});
t('PDF assembly', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); const pdf = Invoice.assemblePdf([{ jpeg: jpg, w: 10, h: 10 }, { jpeg: jpg, w: 10, h: 10 }], 420, 595);
  require('fs').writeFileSync('/tmp/t.pdf', pdf); assert.ok(Buffer.from(pdf).toString('latin1').includes('%%EOF'));
});
console.log(`${n} unit tests passed`);
