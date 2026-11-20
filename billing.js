/* billing.js – money/weight maths (pure, testable) + the New Sale (POS billing) screen.
 * RULES: weights are integer grams, money is integer paise. No floating-point money anywhere. */
'use strict';
(function (root) {
  const MAX_GRAMS = 1000000;        // 1000 kg per line – sanity limit
  const MAX_PAISE = 100000000;      // ₹10,00,000 per KG / per amount – sanity limit
  const PAYMENTS = ['Cash', 'UPI', 'Card'];

  // ---------- parsing ----------
  /** "250.5" -> 25050 paise. Returns NaN when invalid (negative, letters, >2 decimals). */
  function parseMoney(str) {
    const s = String(str == null ? '' : str).trim().replace(/,/g, '');
    if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(s)) return NaN;
    const [w, f = ''] = s.split('.');
    return (parseInt(w || '0', 10) * 100) + parseInt((f + '00').slice(0, 2), 10);
  }
  /** unit 'kg': "2.5" -> 2500 g (max 3 decimals). unit 'g': "250" -> 250 (whole grams only). */
  function parseGrams(str, unit) {
    const s = String(str == null ? '' : str).trim();
    if (unit === 'g') return /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
    if (!/^(\d+\.?\d{0,3}|\.\d{1,3})$/.test(s)) return NaN;
    const [w, f = ''] = s.split('.');
    return parseInt(w || '0', 10) * 1000 + parseInt((f + '000').slice(0, 3), 10);
  }
  /** percent with up to 2 decimals -> hundredths of a percent (12.5 -> 1250) */
  function parsePercent(str) {
    const s = String(str == null ? '' : str).trim();
    if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(s)) return NaN;
    const [w, f = ''] = s.split('.');
    return parseInt(w || '0', 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
  }

  // ---------- formatting ----------
  function fmtMoney(paise, opts) {
    paise = Math.round(paise || 0);
    const neg = paise < 0; const a = Math.abs(paise);
    const r = Math.trunc(a / 100), p = a % 100;
    const rs = r.toLocaleString('en-IN');
    const out = `₹${rs}.${String(p).padStart(2, '0')}`;
    if (neg) return `-${out}`;
    return opts && opts.plus && paise > 0 ? `+${out}` : out;
  }
  function fmtPlain(paise) { // no symbol, for Excel/PDF text
    const neg = paise < 0; const a = Math.abs(Math.round(paise || 0));
    return `${neg ? '-' : ''}${Math.trunc(a / 100).toLocaleString('en-IN')}.${String(a % 100).padStart(2, '0')}`;
  }
  function fmtKg(grams, withUnit) {
    grams = Math.round(grams || 0);
    const neg = grams < 0; const a = Math.abs(grams);
    const out = `${Math.trunc(a / 1000)}.${String(a % 1000).padStart(3, '0')}`;
    return `${neg ? '-' : ''}${out}${withUnit === false ? '' : ' KG'}`;
  }
  const moneyNum = (paise) => Math.round(paise) / 100;   // for Excel numeric cells only
  const kgNum = (g) => Math.round(g) / 1000;

  // ---------- core calculations ----------
  const divRound = (n, d) => Math.floor((n + Math.floor(d / 2)) / d);   // n >= 0 integers
  function lineTotals(grams, buyPerKg, sellPerKg) {
    const revenue = divRound(grams * sellPerKg, 1000);
    const cost = divRound(grams * buyPerKg, 1000);
    return { revenue, cost, profit: revenue - cost };
  }
  /**
   * items: [{grams, buyPerKg, sellPerKg}], opts: {discountMode:'amount'|'percent', discountInput: paise | hundredths-of-percent, extra: paise}
   * Grand Total = Subtotal - Discount + Extra.  Profit = Grand Total - Cost  (= Gross Profit - Discount + Extra).
   */
  function computeBill(items, opts) {
    opts = opts || {};
    let subtotal = 0, cost = 0, totalGrams = 0;
    const lines = items.map((it) => {
      const t = lineTotals(it.grams, it.buyPerKg, it.sellPerKg);
      subtotal += t.revenue; cost += t.cost; totalGrams += it.grams;
      return t;
    });
    let discount = 0;
    const di = opts.discountInput || 0;
    if (opts.discountMode === 'percent') discount = divRound(subtotal * di, 10000); else discount = di;
    const extra = opts.extra || 0;
    const errors = [];
    if (discount > subtotal) errors.push('Discount cannot exceed the subtotal');
    if (opts.discountMode === 'percent' && di > 10000) errors.push('Discount cannot exceed 100%');
    const total = subtotal - discount + extra;
    return { lines, subtotal, discount, extra, total, cost, grossProfit: subtotal - cost, profit: total - cost, totalGrams, errors };
  }

  // ---------- validation ----------
  function validateCategory(name, buy, sell, existing, selfId) {
    const errs = [];
    const n = String(name || '').trim();
    if (!n) errs.push('Category name is required');
    if (n.length > 40) errs.push('Category name is too long (max 40)');
    if ((existing || []).some((c) => !c.deleted && c.id !== selfId && c.name.toLowerCase() === n.toLowerCase())) errs.push('A category with this name already exists');
    if (!Number.isFinite(buy) || buy < 0 || buy > MAX_PAISE) errs.push('Enter a valid purchase price per KG (0 or more)');
    if (!Number.isFinite(sell) || sell <= 0 || sell > MAX_PAISE) errs.push('Enter a valid selling price per KG (more than 0)');
    return errs;
  }
  function validateCustomer(name, phone) {
    const errs = [];
    if (!String(name || '').trim()) errs.push('Customer name is required');
    if (String(name || '').length > 60) errs.push('Name is too long');
    const ph = String(phone || '').trim();
    if (ph && !/^[+]?[0-9 ()-]{6,18}$/.test(ph)) errs.push('Enter a valid phone number');
    return errs;
  }
  /** Integrity check for a sale record (used before saving and when importing backups). */
  function validateSale(s) {
    const e = [];
    if (!s || typeof s !== 'object') return ['Not an object'];
    if (!s.id || typeof s.id !== 'string') e.push('missing id');
    if (s.kind !== 'sale' && s.kind !== 'reversal') e.push('bad kind');
    if (!Array.isArray(s.items) || !s.items.length) e.push('no items');
    else {
      let sub = 0, cost = 0, g = 0;
      s.items.forEach((i) => {
        ['grams', 'buyPerKg', 'sellPerKg', 'revenue', 'cost', 'profit'].forEach((k) => { if (!Number.isInteger(i[k])) e.push(`item ${k} not integer`); });
        if (s.kind === 'sale') {
          if (i.grams <= 0) e.push('weight must be positive');
          if (i.sellPerKg < 0 || i.buyPerKg < 0) e.push('negative price');
        }
        sub += i.revenue; cost += i.cost; g += i.grams;
      });
      if (sub !== s.subtotal) e.push('subtotal mismatch');
      if (cost !== s.cost) e.push('cost mismatch');
      if (g !== s.totalGrams) e.push('weight mismatch');
      if (s.total !== s.subtotal - s.discount + s.extra) e.push('total mismatch');
      if (s.profit !== s.total - s.cost) e.push('profit mismatch');
    }
    if (!s.invoiceNo) e.push('missing invoice number');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.day || '')) e.push('bad day');
    return e;
  }

  const pure = { MAX_GRAMS, MAX_PAISE, PAYMENTS, parseMoney, parseGrams, parsePercent, fmtMoney, fmtPlain, fmtKg, moneyNum, kgNum, lineTotals, computeBill, validateCategory, validateCustomer, validateSale };

  // =====================================================================================
  //                                 NEW SALE SCREEN (browser only)
  // =====================================================================================
  const DRAFT_KEY = 'cm_draft_v1';
  let draft = null;
  let sel = { catId: null, unit: 'kg' };
  let saving = false;

  function newDraft(payment) {
    return { id: DB.uid(), items: [], customer: null, discMode: 'amount', discVal: '', extra: '', payment: payment || 'Cash' };
  }
  function loadDraft() {
    if (draft) return draft;
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); if (d && d.id && Array.isArray(d.items)) draft = d; } catch (e) { /* ignore */ }
    if (!draft) draft = newDraft(App.settings.defaultPayment);
    return draft;
  }
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* ignore */ } }
  function resetDraft() { draft = newDraft(App.settings.defaultPayment); try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } sel = { catId: null, unit: 'kg' }; }

  function currentBill() {
    const d = loadDraft();
    const extra = d.extra === '' ? 0 : parseMoney(d.extra);
    let di = 0, derr = null;
    if (d.discVal !== '') {
      di = d.discMode === 'percent' ? parsePercent(d.discVal) : parseMoney(d.discVal);
      if (Number.isNaN(di)) { derr = 'Enter a valid discount'; di = 0; }
    }
    const bill = computeBill(d.items, { discountMode: d.discMode, discountInput: di, extra: Number.isNaN(extra) ? 0 : extra });
    if (Number.isNaN(extra)) bill.errors.push('Enter valid extra charges');
    if (derr) bill.errors.push(derr);
    return bill;
  }

  function view(el) {
    const esc = App.esc;
    const d = loadDraft();
    const cats = App.categories.filter((c) => !c.deleted).sort((a, b) => a.name.localeCompare(b.name));
    if (sel.catId && !cats.find((c) => c.id === sel.catId)) sel.catId = null;
    el.innerHTML = `
    <div class="page-title"><h1>New Sale</h1><button class="btn ghost sm" data-act="clear-bill">Clear</button></div>
    ${cats.length ? '' : `<div class="card empty">No cloth categories yet.<br><a class="btn primary" href="#/categories">Add a category</a></div>`}
    <div class="card">
      <div class="lbl">1 · Cloth category</div>
      <div class="chips" id="catChips">${cats.map((c) => `<button class="chip ${c.id === sel.catId ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)}<small>${fmtMoney(c.sellPerKg)}</small></button>`).join('')}</div>
      <div class="row2 mt">
        <div><div class="lbl">Selling price / KG (₹)</div><input id="bPrice" class="inp" inputmode="decimal" placeholder="0.00" autocomplete="off"></div>
        <div><div class="lbl">Purchase price / KG</div><div id="bCost" class="ro">—</div></div>
      </div>
      <div class="lbl mt">2 · Weight</div>
      <div class="weight-row">
        <input id="bWeight" class="inp big" inputmode="decimal" placeholder="${sel.unit === 'kg' ? '0.000' : '0'}" autocomplete="off">
        <div class="seg" id="unitSeg"><button data-unit="kg" class="${sel.unit === 'kg' ? 'on' : ''}">KG</button><button data-unit="g" class="${sel.unit === 'g' ? 'on' : ''}">grams</button></div>
      </div>
      <div class="chips quick">${['0.250', '0.500', '0.750', '1.000', '2.500', '10.000'].map((w) => `<button class="chip sm" data-w="${w}">${w} KG</button>`).join('')}</div>
      <div id="linePrev" class="prev"></div>
      <button class="btn primary block" data-act="add-item">+ Add to bill</button>
    </div>

    <div class="card" id="itemsCard"></div>

    <div class="card">
      <div class="lbl">3 · Customer</div>
      <button class="btn outline block left" data-act="pick-customer" id="custBtn"></button>
      <div class="row2 mt">
        <div><div class="lbl">Discount</div>
          <div class="inline"><input id="bDisc" class="inp" inputmode="decimal" placeholder="0" value="${esc(d.discVal)}">
          <div class="seg sm" id="discSeg"><button data-dm="amount" class="${d.discMode === 'amount' ? 'on' : ''}">₹</button><button data-dm="percent" class="${d.discMode === 'percent' ? 'on' : ''}">%</button></div></div></div>
        <div><div class="lbl">Extra charges (₹)</div><input id="bExtra" class="inp" inputmode="decimal" placeholder="0" value="${esc(d.extra)}"></div>
      </div>
      <div class="lbl mt">Payment method</div>
      <div class="chips" id="payChips">${PAYMENTS.map((p) => `<button class="chip ${d.payment === p ? 'on' : ''}" data-pay="${p}">${p}</button>`).join('')}</div>
    </div>

    <div class="card totals" id="totalsCard"></div>
    <div class="sticky-bar"><button class="btn primary block lg" id="saveBtn" data-act="save-bill">Save &amp; Generate Invoice</button></div>`;
    if (sel.catId) { const c = cats.find((x) => x.id === sel.catId); setCat(c, true); }
    refresh();
  }

  function setCat(c, keepPrice) {
    sel.catId = c ? c.id : null;
    const price = document.getElementById('bPrice'); const cost = document.getElementById('bCost');
    if (!price) return;
    if (c) { if (!keepPrice || !price.value) price.value = (c.sellPerKg / 100).toFixed(2); cost.textContent = fmtMoney(c.buyPerKg); } else { price.value = ''; cost.textContent = '—'; }
    document.querySelectorAll('#catChips .chip').forEach((b) => b.classList.toggle('on', b.dataset.cat === sel.catId));
    updatePreview();
  }

  function readLine() {
    const c = App.categories.find((x) => x.id === sel.catId);
    const price = parseMoney(document.getElementById('bPrice').value);
    const wStr = document.getElementById('bWeight').value;
    const grams = parseGrams(wStr, sel.unit);
    return { c, price, grams, wStr };
  }
  function updatePreview() {
    const el = document.getElementById('linePrev'); if (!el) return;
    const { c, price, grams, wStr } = readLine();
    if (!c || !wStr) { el.textContent = 'Select a category and enter the weight'; el.className = 'prev'; return; }
    if (Number.isNaN(grams) || grams <= 0) { el.textContent = sel.unit === 'g' ? 'Enter whole grams (e.g. 750)' : 'Enter a valid weight (max 3 decimals)'; el.className = 'prev err'; return; }
    if (Number.isNaN(price) || price <= 0) { el.textContent = 'Enter a valid selling price'; el.className = 'prev err'; return; }
    const t = lineTotals(grams, c.buyPerKg, price);
    el.className = 'prev ok';
    el.innerHTML = `${fmtKg(grams)} × ${fmtMoney(price)} = <b>${fmtMoney(t.revenue)}</b>`;
  }

  function refresh() {
    const esc = App.esc; const d = loadDraft(); const bill = currentBill();
    const ic = document.getElementById('itemsCard');
    if (ic) {
      ic.innerHTML = `<div class="lbl">Bill items (${d.items.length})</div>` + (d.items.length ? d.items.map((it, i) => `
        <div class="item-row"><div class="grow"><b>${esc(it.name)}</b><div class="muted">${fmtKg(it.grams)} × ${fmtMoney(it.sellPerKg)}</div></div>
        <div class="amt">${fmtMoney(bill.lines[i].revenue)}</div><button class="icon-btn" data-rm="${i}" aria-label="Remove item">✕</button></div>`).join('') : '<div class="muted pad">No items yet. Add cloth above.</div>');
    }
    const cb = document.getElementById('custBtn');
    if (cb) cb.innerHTML = d.customer ? `👤 <b>${esc(d.customer.name)}</b>${d.customer.phone ? ' · ' + esc(d.customer.phone) : ''}` : '👤 Guest customer <small>(tap to choose or add)</small>';
    const tc = document.getElementById('totalsCard');
    if (tc) {
      tc.innerHTML = `
      <div class="trow"><span>Total weight</span><b>${fmtKg(bill.totalGrams)}</b></div>
      <div class="trow"><span>Subtotal</span><b>${fmtMoney(bill.subtotal)}</b></div>
      <div class="trow"><span>Discount</span><b>− ${fmtMoney(bill.discount)}</b></div>
      <div class="trow"><span>Extra charges</span><b>+ ${fmtMoney(bill.extra)}</b></div>
      <div class="trow grand"><span>Grand Total</span><b>${fmtMoney(bill.total)}</b></div>
      <div class="trow profit"><span>Estimated profit</span><b class="${bill.profit < 0 ? 'neg' : 'pos'}">${fmtMoney(bill.profit)}</b></div>
      ${bill.errors.map((e) => `<div class="err-line">⚠ ${esc(e)}</div>`).join('')}`;
    }
    saveDraft();
  }

  async function addItem() {
    const { c, price, grams } = readLine();
    if (!c) return App.toast('Select a cloth category first', 'err');
    if (Number.isNaN(grams) || grams <= 0) return App.toast('Enter a valid weight greater than zero', 'err');
    if (grams > MAX_GRAMS) return App.toast('Weight is too large (max 1000 KG per line)', 'err');
    if (Number.isNaN(price) || price <= 0 || price > MAX_PAISE) return App.toast('Enter a valid selling price', 'err');
    if (price < c.buyPerKg) { const ok = await App.confirm({ title: 'Selling below cost', message: `Price ${fmtMoney(price)}/KG is below the purchase price ${fmtMoney(c.buyPerKg)}/KG. This line will show a loss. Continue?`, okText: 'Add anyway' }); if (!ok) return; }
    const d = loadDraft();
    d.items.push({ categoryId: c.id, name: c.name, grams, buyPerKg: c.buyPerKg, sellPerKg: price });
    document.getElementById('bWeight').value = '';
    updatePreview(); refresh();
    App.toast(`${c.name} added`, 'ok');
  }

  function openCustomerPicker() {
    const esc = App.esc;
    const render = (q) => {
      const list = App.customers.filter((c) => !c.deleted && (!q || (c.name + ' ' + (c.phone || '')).toLowerCase().includes(q.toLowerCase())));
      return list.slice(0, 50).map((c) => `<button class="list-row" data-pick="${c.id}"><b>${esc(c.name)}</b><span class="muted">${esc(c.phone || '')}</span></button>`).join('') || '<div class="muted pad">No customers found</div>';
    };
    App.sheet({
      title: 'Select customer',
      body: `<button class="btn outline block" data-guest>Continue as Guest</button>
        <input class="inp mt" id="custQ" placeholder="Search name or phone" autocomplete="off">
        <div id="custList" class="list mt">${render('')}</div>
        <button class="btn primary block mt" data-newcust>+ Add new customer</button>`,
      onMount(root, close) {
        root.querySelector('#custQ').addEventListener('input', (e) => { root.querySelector('#custList').innerHTML = render(e.target.value); });
        root.addEventListener('click', async (e) => {
          const t = e.target.closest('button'); if (!t) return;
          if (t.hasAttribute('data-guest')) { loadDraft().customer = null; close(); refresh(); }
          else if (t.dataset.pick) { const c = App.customers.find((x) => x.id === t.dataset.pick); draft.customer = { id: c.id, name: c.name, phone: c.phone || '' }; close(); refresh(); }
          else if (t.hasAttribute('data-newcust')) { close(); const c = await App.customerForm(); if (c) { draft.customer = { id: c.id, name: c.name, phone: c.phone || '' }; refresh(); } }
        });
      },
    });
  }

  async function saveBill() {
    if (saving) return;
    const d = loadDraft();
    if (!d.items.length) return App.toast('Add at least one item to the bill', 'err');
    const bill = currentBill();
    if (bill.errors.length) return App.toast(bill.errors[0], 'err');
    if (bill.total < 0) return App.toast('Grand total cannot be negative', 'err');
    saving = true;
    const btn = document.getElementById('saveBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const now = new Date();
      const items = d.items.map((it, i) => Object.assign({}, it, bill.lines[i]));
      const sale = {
        id: d.id, kind: 'sale', status: 'completed', createdAt: now.toISOString(), day: DB.localDay(now),
        customerId: d.customer ? d.customer.id : null, customerName: d.customer ? d.customer.name : 'Guest', customerPhone: d.customer ? d.customer.phone : '',
        payment: d.payment, items, totalGrams: bill.totalGrams, subtotal: bill.subtotal, discount: bill.discount,
        discountMode: d.discMode, discountInput: d.discVal, extra: bill.extra, total: bill.total, cost: bill.cost, profit: bill.profit, syncedAt: 0,
      };
      sale.invoiceNo = 'PENDING';
      const errs = validateSale(sale);
      if (errs.length) throw new Error('Bill failed validation: ' + errs.join(', '));
      const saved = await DB.saveNewSale(sale, App.settings);
      resetDraft();
      App.toast(`Saved ${saved.invoiceNo}`, 'ok');
      App.afterSave();
      location.hash = `#/invoice/${saved.id}`;
    } catch (e) {
      if (e.code === 'DUPLICATE') { resetDraft(); App.toast('This bill was already saved', 'warn'); location.hash = `#/invoice/${e.sale.id}`; }
      else { console.error(e); App.toast('Could not save: ' + e.message, 'err'); }
    } finally {
      saving = false;
      const b = document.getElementById('saveBtn'); if (b) { b.disabled = false; b.textContent = 'Save & Generate Invoice'; }
    }
  }

  function bind(el) {
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.cat) { const c = App.categories.find((x) => x.id === t.dataset.cat); document.getElementById('bPrice').value = ''; setCat(c); }
      else if (t.dataset.unit) {
        const old = sel.unit; sel.unit = t.dataset.unit;
        const w = document.getElementById('bWeight'); const g = parseGrams(w.value, old);
        if (!Number.isNaN(g) && w.value) w.value = sel.unit === 'g' ? String(g) : fmtKg(g, false);
        w.placeholder = sel.unit === 'kg' ? '0.000' : '0';
        document.querySelectorAll('#unitSeg button').forEach((b) => b.classList.toggle('on', b.dataset.unit === sel.unit)); updatePreview();
      } else if (t.dataset.w) {
        sel.unit = 'kg'; document.querySelectorAll('#unitSeg button').forEach((b) => b.classList.toggle('on', b.dataset.unit === 'kg'));
        document.getElementById('bWeight').value = t.dataset.w; updatePreview();
      } else if (t.dataset.dm) { loadDraft().discMode = t.dataset.dm; document.querySelectorAll('#discSeg button').forEach((b) => b.classList.toggle('on', b.dataset.dm === draft.discMode)); refresh(); }
      else if (t.dataset.pay) { loadDraft().payment = t.dataset.pay; document.querySelectorAll('#payChips .chip').forEach((b) => b.classList.toggle('on', b.dataset.pay === draft.payment)); saveDraft(); }
      else if (t.dataset.rm) { loadDraft().items.splice(+t.dataset.rm, 1); refresh(); }
      else if (t.dataset.act === 'add-item') addItem();
      else if (t.dataset.act === 'pick-customer') openCustomerPicker();
      else if (t.dataset.act === 'save-bill') saveBill();
      else if (t.dataset.act === 'clear-bill') { if (await App.confirm({ title: 'Clear this bill?', message: 'All items on the current bill will be removed.', okText: 'Clear', danger: true })) { resetDraft(); view(el); } }
    });
    el.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id === 'bPrice' || id === 'bWeight') updatePreview();
      else if (id === 'bDisc') { loadDraft().discVal = e.target.value; refresh(); }
      else if (id === 'bExtra') { loadDraft().extra = e.target.value; refresh(); }
    });
  }

  const api = Object.assign({}, pure, { view, bind, loadDraft, currentBill });
  root.Billing = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
