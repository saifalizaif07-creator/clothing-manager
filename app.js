/* app.js – application shell: state, router, UI helpers, dashboard, history, customers, categories, settings, PIN lock, PWA wiring. */
'use strict';
(function () {
  const m = Billing;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const dt = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  const dOnly = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const App = { esc, settings: Object.assign({}, DB.DEFAULT_SETTINGS), categories: [], customers: [], deferredInstall: null, route: '' };
  window.App = App;

  // ================= UI helpers =================
  App.toast = (msg, kind, ms) => {
    const box = $('#toasts'); const t = document.createElement('div'); t.className = 'toast ' + (kind || 'info'); t.textContent = msg; box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms || 2800);
  };
  App.sheet = ({ title, body, onMount }) => {
    const back = document.createElement('div'); back.className = 'sheet-back';
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div><div class="sheet-body">${body}</div></div>`;
    document.body.appendChild(back); document.body.classList.add('noscroll');
    const close = () => { back.classList.add('out'); setTimeout(() => { back.remove(); if (!document.querySelector('.sheet-back')) document.body.classList.remove('noscroll'); }, 180); };
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    if (onMount) onMount($('.sheet-body', back), close, back);
    return close;
  };
  App.confirm = ({ title, message, okText, danger }) => new Promise((resolve) => {
    let res = false;
    const close = App.sheet({ title, body: `<p>${esc(message)}</p><div class="row2 mt"><button class="btn outline" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okText || 'OK')}</button></div>`,
      onMount(r, c, back) { r.addEventListener('click', (e) => { if (e.target.closest('[data-yes]')) { res = true; c(); } else if (e.target.closest('[data-no]')) c(); }); new MutationObserver((_, o) => { if (!document.body.contains(back)) { o.disconnect(); resolve(res); } }).observe(document.body, { childList: true }); } });
    void close;
  });

  // ================= data cache =================
  async function loadCache() {
    App.settings = await DB.getSettings();
    App.categories = await DB.getAll('categories');
    App.customers = await DB.getAll('customers');
  }
  App.afterSave = async () => { await loadCache(); if (window.Cloud) Cloud.schedule(3000); };

  function applyTheme() {
    const t = App.settings.theme || 'dark'; const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.content = dark ? '#0b1426' : '#f4f6fb';
  }

  // ================= router =================
  const NAV = [
    ['dashboard', 'Home', '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
    ['sale', 'New Sale', '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'],
    ['history', 'History', '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'],
    ['customers', 'Customers', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.900 6.500 5.500"/><path d="M16 4.500a3.500 3.500 0 0 1 0 7M18 14.800c2 .7 3.200 2.500 3.500 5.200"/>'],
    ['reports', 'Reports', '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'],
    ['settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.200 4.200l2.100 2.100M17.700 17.700l2.100 2.100M2 12h3M19 12h3M4.200 19.800l2.100-2.100M17.700 6.300l2.100-2.100"/>'],
  ];
  const NAV_OF = { categories: 'settings', invoice: 'history', customer: 'customers' };
  function buildNav() {
    $('#nav').innerHTML = NAV.map(([k, l, svg]) => `<a href="#/${k}" data-nav="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svg}</svg><span>${l}</span></a>`).join('');
  }
  function parseRoute() { const h = location.hash.replace(/^#\/?/, ''); const [a, b] = h.split('/'); return { name: a || 'dashboard', arg: b }; }
  async function route() {
    const { name, arg } = parseRoute(); App.route = name;
    const host = $('#view'); const el = document.createElement('div'); el.className = 'page'; host.replaceChildren(el); window.scrollTo(0, 0);
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (NAV_OF[name] || name)));
    try {
      if (name === 'dashboard') await dashboard(el);
      else if (name === 'sale') { Billing.view(el); Billing.bind(el); }
      else if (name === 'history') await history(el);
      else if (name === 'customers') await customers(el);
      else if (name === 'customer') await customerDetail(el, arg);
      else if (name === 'reports') await Reports.view(el);
      else if (name === 'settings') await settings(el);
      else if (name === 'categories') await categories(el);
      else if (name === 'invoice') await Invoice.view(el, arg);
      else { location.hash = '#/dashboard'; }
    } catch (e) { console.error(e); el.innerHTML = `<div class="card empty">Something went wrong: ${esc(e.message)}</div>`; }
  }
  let rt = null;
  DB.onChange((store) => {
    clearTimeout(rt);
    rt = setTimeout(async () => { if (store !== 'meta') await loadCache(); if (['dashboard', 'history', 'customers', 'categories', 'customer'].includes(App.route) && !document.querySelector('.sheet-back')) route(); }, 120);
  });

  // ================= Dashboard =================
  let chartDays = 7;
  async function dashboard(el) {
    const today = Reports.dayStr(new Date()); const monthStart = today.slice(0, 7) + '-01'; const from = [monthStart, Reports.addDays(today, -29)].sort()[0];
    const entries = await Reports.entriesFor(from, today);
    const A = Reports.aggregate(entries.filter((e) => e.day === today)).total; const Mo = Reports.aggregate(entries.filter((e) => e.day >= monthStart));
    const recent = entries.filter((e) => e.kind === 'sale').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
    const best = Reports.bestSelling(entries.filter((e) => e.day >= monthStart), 3);
    const tile = (k, v, c) => `<div class="tile ${c || ''}"><span>${k}</span><b>${v}</b></div>`;
    const maxKg = best.length ? best[0].grams : 1;
    el.innerHTML = `
    <div class="hero"><div><small>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</small><h1>${esc(App.settings.shopName)}</h1></div><a class="btn primary" href="#/sale">+ New Sale</a></div>
    ${App.deferredInstall ? '<div class="banner"><span>Install this app on your phone for full-screen offline use.</span><button class="btn sm primary" data-act="install">Install</button></div>' : ''}
    <div class="tiles">
      ${tile("Today's sales", m.fmtMoney(A.sales), 'big')}${tile("Today's profit", m.fmtMoney(A.profit), 'green big')}
      ${tile('KG sold today', m.fmtKg(A.grams))}${tile('Bills today', A.bills)}
      ${tile('Cash collection', m.fmtMoney(A.pay.Cash))}${tile('UPI collection', m.fmtMoney(A.pay.UPI))}
      ${tile('Card collection', m.fmtMoney(A.pay.Card))}${tile('KG this month', m.fmtKg(Mo.total.grams))}
      ${tile('Monthly sales', m.fmtMoney(Mo.total.sales))}${tile('Monthly profit', m.fmtMoney(Mo.total.profit), 'green')}
    </div>
    <div class="card"><div class="between"><div class="lbl">Sales analytics</div><div class="seg sm" id="cdSeg"><button data-d="7" class="${chartDays === 7 ? 'on' : ''}">7 days</button><button data-d="30" class="${chartDays === 30 ? 'on' : ''}">30 days</button></div></div>
      <canvas id="dChart" class="chart"></canvas><div class="legend"><i style="background:var(--blue)"></i>Sales <i style="background:var(--green)"></i>Profit</div></div>
    <div class="card"><div class="lbl">Best-selling cloth · this month</div>${best.length ? best.map((b) => `<div class="bar-row"><span>${esc(b.name)}</span><div class="bar"><i style="width:${Math.max(4, Math.round(b.grams / maxKg * 100))}%"></i></div><b>${m.fmtKg(b.grams)}</b></div>`).join('') : '<div class="muted pad">No sales yet this month</div>'}</div>
    <div class="card"><div class="between"><div class="lbl">Recent transactions</div><a href="#/history" class="link">View all</a></div>
      ${recent.length ? recent.map((s) => `<a class="list-row" href="#/invoice/${s.id}"><div class="grow"><b>${esc(s.invoiceNo)}</b> ${s.status === 'cancelled' ? '<span class="badge red">Cancelled</span>' : ''}<div class="muted">${esc(s.customerName)} · ${dt(s.createdAt)}</div></div><div class="amt">${m.fmtMoney(s.total)}<small class="${s.profit < 0 ? 'neg' : 'pos'}">${m.fmtMoney(s.profit)}</small></div></a>`).join('') : '<div class="muted pad">No transactions yet. Tap “New Sale” to create your first bill.</div>'}</div>`;
    const draw = () => { const e2 = Reports.aggregate(entries); const s = Reports.series(e2, Reports.addDays(today, -(chartDays - 1)), today); Reports.bars($('#dChart', el), s.labels, [{ color: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(), values: s.sales }, { color: getComputedStyle(document.documentElement).getPropertyValue('--green').trim(), values: s.profit }]); };
    requestAnimationFrame(draw);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.d) { chartDays = +b.dataset.d; el.querySelectorAll('#cdSeg button').forEach((x) => x.classList.toggle('on', x.dataset.d === b.dataset.d)); draw(); }
      else if (b.dataset.act === 'install') installApp();
    });
  }

  // ================= Sales history =================
  const hf = { q: '', from: '', to: '', cat: '', pay: '', status: '', open: false, limit: 50 };
  async function history(el) {
    const cats = App.categories.filter((c) => !c.deleted);
    el.innerHTML = `<div class="page-title"><h1>Sales History</h1><button class="btn outline sm" data-act="export">⬇ Excel</button></div>
    <div class="searchbar"><input id="hq" class="inp" placeholder="Search invoice no. or customer" value="${esc(hf.q)}"><button class="btn outline" data-act="tf">Filters</button></div>
    <div class="card ${hf.open ? '' : 'hide'}" id="hFilters"><div class="row2"><div><div class="lbl">From</div><input id="hfrom" type="date" class="inp" value="${hf.from}"></div><div><div class="lbl">To</div><input id="hto" type="date" class="inp" value="${hf.to}"></div></div>
      <div class="row2 mt"><div><div class="lbl">Category</div><select id="hcat" class="inp"><option value="">All</option>${cats.map((c) => `<option value="${c.id}" ${hf.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><div class="lbl">Payment</div><select id="hpay" class="inp"><option value="">All</option>${m.PAYMENTS.map((p) => `<option ${hf.pay === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
      <div class="lbl mt">Status</div><select id="hstat" class="inp"><option value="">All</option><option value="sale" ${hf.status === 'sale' ? 'selected' : ''}>Completed sales</option><option value="cancelled" ${hf.status === 'cancelled' ? 'selected' : ''}>Cancelled</option><option value="reversal" ${hf.status === 'reversal' ? 'selected' : ''}>Reversal records</option></select>
      <button class="btn ghost sm mt" data-act="reset">Reset filters</button></div>
    <div id="hList"></div>`;
    let rows = [];
    const apply = () => {
      const q = hf.q.trim().toLowerCase();
      rows = all.filter((s) => (!q || s.invoiceNo.toLowerCase().includes(q) || (s.customerName || '').toLowerCase().includes(q) || (s.customerPhone || '').includes(q))
        && (!hf.from || s.day >= hf.from) && (!hf.to || s.day <= hf.to) && (!hf.pay || s.payment === hf.pay) && (!hf.cat || s.items.some((i) => i.categoryId === hf.cat))
        && (!hf.status || (hf.status === 'sale' ? s.kind === 'sale' && s.status === 'completed' : hf.status === 'cancelled' ? s.status === 'cancelled' && s.kind === 'sale' : s.kind === 'reversal')));
      const shown = rows.slice(0, hf.limit); const sum = rows.reduce((a, s) => a + s.total, 0);
      $('#hList', el).innerHTML = `<div class="muted small pad0">${rows.length} record${rows.length === 1 ? '' : 's'} · net ${m.fmtMoney(sum)}</div>` + (shown.map((s) => `<a class="card row-card" href="#/invoice/${s.id}"><div class="grow"><b>${esc(s.invoiceNo)}</b> <span class="badge ${s.kind === 'reversal' ? 'amber' : s.status === 'cancelled' ? 'red' : 'gray'}">${s.kind === 'reversal' ? 'Refund' : s.status === 'cancelled' ? 'Cancelled' : esc(s.payment)}</span><div class="muted">${esc(s.customerName)} · ${dt(s.createdAt)}</div><div class="muted">${s.items.map((i) => esc(i.name)).join(', ')} · ${m.fmtKg(s.totalGrams)}</div></div><div class="amt ${s.total < 0 ? 'neg' : ''}">${m.fmtMoney(s.total)}</div></a>`).join('') || '<div class="card empty">No matching transactions</div>') + (rows.length > shown.length ? '<button class="btn outline block" data-act="more">Load more</button>' : '');
    };
    const all = (await DB.getAll('sales')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    apply();
    el.addEventListener('input', (e) => { const mp = { hq: 'q', hfrom: 'from', hto: 'to' }; if (mp[e.target.id]) { hf[mp[e.target.id]] = e.target.value; hf.limit = 50; apply(); } });
    el.addEventListener('change', (e) => { const mp = { hcat: 'cat', hpay: 'pay', hstat: 'status', hfrom: 'from', hto: 'to' }; if (mp[e.target.id]) { hf[mp[e.target.id]] = e.target.value; hf.limit = 50; apply(); } });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const a = b.dataset.act;
      if (a === 'tf') { hf.open = !hf.open; $('#hFilters', el).classList.toggle('hide', !hf.open); }
      else if (a === 'more') { hf.limit += 50; apply(); }
      else if (a === 'reset') { Object.assign(hf, { q: '', from: '', to: '', cat: '', pay: '', status: '', limit: 50 }); history(el); }
      else if (a === 'export') { if (!rows.length) return App.toast('Nothing to export', 'warn'); Backup.downloadXlsx(`sales-history-${DB.localDay(new Date())}.xlsx`, [Backup.salesSheet(rows)]); App.toast('Excel exported', 'ok'); }
    });
  }

  // ================= Customers =================
  App.customerForm = (c) => new Promise((resolve) => {
    let result = null;
    App.sheet({ title: c ? 'Edit customer' : 'New customer',
      body: `<div class="lbl">Name *</div><input id="cfN" class="inp" maxlength="60" value="${esc(c ? c.name : '')}"><div class="lbl mt">Phone</div><input id="cfP" class="inp" inputmode="tel" value="${esc(c ? c.phone : '')}" placeholder="Optional"><div class="lbl mt">Address (optional)</div><textarea id="cfA" class="inp" rows="2" maxlength="200">${esc(c ? c.address : '')}</textarea><div id="cfE" class="err-line"></div><button class="btn primary block mt" id="cfS">Save customer</button>`,
      onMount(r, close, back) {
        r.querySelector('#cfS').onclick = async () => {
          const name = r.querySelector('#cfN').value.trim(), phone = r.querySelector('#cfP').value.trim(); const errs = m.validateCustomer(name, phone);
          if (errs.length) { r.querySelector('#cfE').textContent = errs[0]; return; }
          const rec = c ? Object.assign({}, c) : { id: DB.uid(), createdAt: new Date().toISOString(), deleted: false, syncedAt: 0 };
          Object.assign(rec, { name, phone, address: r.querySelector('#cfA').value.trim() });
          await DB.put('customers', rec); await App.afterSave(); result = rec; close(); App.toast('Customer saved', 'ok');
        };
        new MutationObserver((_, o) => { if (!document.body.contains(back)) { o.disconnect(); resolve(result); } }).observe(document.body, { childList: true });
      } });
  });
  async function custStats() {
    const all = await DB.getAll('sales'); const map = new Map();
    all.forEach((s) => { if (!s.customerId) return; const x = map.get(s.customerId) || { total: 0, bills: 0, last: '' }; x.total += s.total; x.bills += s.kind === 'sale' ? 1 : -1; if (s.kind === 'sale' && s.createdAt > x.last) x.last = s.createdAt; map.set(s.customerId, x); });
    return map;
  }
  let cq = '';
  async function customers(el) {
    const stats = await custStats();
    el.innerHTML = `<div class="page-title"><h1>Customers</h1></div><input id="cq" class="inp" placeholder="Search name or phone" value="${esc(cq)}"><div id="cList" class="mt"></div><button class="fab" data-act="add" aria-label="Add customer">+</button>`;
    const draw = () => {
      const q = cq.toLowerCase(); const list = App.customers.filter((c) => !c.deleted && (!q || (c.name + ' ' + (c.phone || '')).toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
      $('#cList', el).innerHTML = list.map((c) => { const s = stats.get(c.id) || { total: 0, bills: 0, last: '' }; return `<a class="card row-card" href="#/customer/${c.id}"><div class="avatar">${esc(c.name.trim()[0] || '?').toUpperCase()}</div><div class="grow"><b>${esc(c.name)}</b><div class="muted">${esc(c.phone || 'No phone')}</div><div class="muted">${s.bills} bills · last ${s.last ? dOnly(s.last) : '—'}</div></div><div class="amt">${m.fmtMoney(s.total)}</div></a>`; }).join('') || '<div class="card empty">No customers yet. Guest checkout works without one.<br>Tap + to add.</div>';
    };
    draw();
    el.addEventListener('input', (e) => { if (e.target.id === 'cq') { cq = e.target.value; draw(); } });
    el.addEventListener('click', async (e) => { if (e.target.closest('[data-act=add]')) { const c = await App.customerForm(); if (c) route(); } });
  }
  async function customerDetail(el, id) {
    const c = App.customers.find((x) => x.id === id);
    if (!c || c.deleted) { el.innerHTML = '<div class="card empty">Customer not found.<br><a class="btn primary" href="#/customers">Back</a></div>'; return; }
    const sales = (await DB.getByIndex('sales', 'customerId', id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const net = sales.reduce((a, s) => a + s.total, 0), bills = sales.reduce((a, s) => a + (s.kind === 'sale' ? 1 : -1), 0), last = sales.find((s) => s.kind === 'sale');
    const ph = (c.phone || '').replace(/[^\d+]/g, '');
    el.innerHTML = `<div class="page-title"><a class="icon-btn" href="#/customers">‹</a><h1>${esc(c.name)}</h1></div>
    <div class="card"><div class="muted">${esc(c.phone || 'No phone')}${c.address ? '<br>' + esc(c.address) : ''}</div>
      <div class="tiles mt"><div class="tile"><span>Total purchases</span><b>${m.fmtMoney(net)}</b></div><div class="tile"><span>Number of bills</span><b>${bills}</b></div><div class="tile"><span>Last purchase</span><b class="sm">${last ? dOnly(last.createdAt) : '—'}</b></div></div>
      <div class="actions-grid mt"><button class="btn primary" data-act="sale">+ New sale</button><button class="btn outline" data-act="edit">Edit</button>${ph ? `<a class="btn outline" href="tel:${esc(ph)}">Call</a><a class="btn outline" target="_blank" rel="noopener" href="https://wa.me/${ph.replace(/\D/g, '').length === 10 ? '91' : ''}${ph.replace(/\D/g, '')}">WhatsApp</a>` : ''}</div></div>
    <div class="card"><div class="lbl">Purchase history</div>${sales.map((s) => `<a class="list-row" href="#/invoice/${s.id}"><div class="grow"><b>${esc(s.invoiceNo)}</b> ${s.kind === 'reversal' ? '<span class="badge amber">Refund</span>' : s.status === 'cancelled' ? '<span class="badge red">Cancelled</span>' : ''}<div class="muted">${dt(s.createdAt)} · ${m.fmtKg(s.totalGrams)}</div></div><div class="amt">${m.fmtMoney(s.total)}</div></a>`).join('') || '<div class="muted pad">No purchases yet</div>'}</div>
    <button class="btn danger block" data-act="del">Delete customer</button><div class="muted small mt">Deleting keeps all past invoices; they keep showing this customer’s name.</div>`;
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'sale') { const d = Billing.loadDraft(); d.customer = { id: c.id, name: c.name, phone: c.phone || '' }; location.hash = '#/sale'; }
      else if (a.dataset.act === 'edit') { const r = await App.customerForm(c); if (r) route(); }
      else if (a.dataset.act === 'del' && await App.confirm({ title: 'Delete customer?', message: `${c.name} will be removed from your customer list. Past invoices are kept.`, okText: 'Delete', danger: true })) { await DB.put('customers', Object.assign({}, c, { deleted: true })); await App.afterSave(); App.toast('Customer deleted', 'ok'); location.hash = '#/customers'; }
    });
  }

  // ================= Categories =================
  function categoryForm(c) {
    App.sheet({ title: c ? 'Edit category' : 'New cloth category',
      body: `<div class="lbl">Category name *</div><input id="kN" class="inp" maxlength="40" value="${esc(c ? c.name : '')}" placeholder="e.g. Cotton">
      <div class="row2 mt"><div><div class="lbl">Purchase ₹/KG *</div><input id="kB" class="inp" inputmode="decimal" value="${c ? (c.buyPerKg / 100).toFixed(2) : ''}" placeholder="0.00"></div><div><div class="lbl">Selling ₹/KG *</div><input id="kS" class="inp" inputmode="decimal" value="${c ? (c.sellPerKg / 100).toFixed(2) : ''}" placeholder="0.00"></div></div>
      <div id="kM" class="prev"></div><div class="muted small">Changing prices only affects new bills. Old bills keep the prices they were sold at.</div><div id="kE" class="err-line"></div><button class="btn primary block mt" id="kSave">Save category</button>`,
      onMount(r, close) {
        const margin = () => { const b = m.parseMoney(r.querySelector('#kB').value), s = m.parseMoney(r.querySelector('#kS').value); r.querySelector('#kM').textContent = (!Number.isNaN(b) && !Number.isNaN(s)) ? `Margin: ${m.fmtMoney(s - b)} per KG` : ''; };
        r.addEventListener('input', margin); margin();
        r.querySelector('#kSave').onclick = async () => {
          const name = r.querySelector('#kN').value.trim(), b = m.parseMoney(r.querySelector('#kB').value), s = m.parseMoney(r.querySelector('#kS').value);
          const errs = m.validateCategory(name, b, s, App.categories, c && c.id); if (errs.length) { r.querySelector('#kE').textContent = errs[0]; return; }
          const rec = c ? Object.assign({}, c) : { id: DB.uid(), createdAt: new Date().toISOString(), deleted: false, syncedAt: 0 };
          Object.assign(rec, { name, buyPerKg: b, sellPerKg: s }); await DB.put('categories', rec); await App.afterSave(); close(); App.toast('Category saved', 'ok'); route();
        };
      } });
  }
  async function categories(el) {
    const sales = await DB.getAll('sales'); const st = new Map();
    sales.forEach((s) => s.items.forEach((i) => { const x = st.get(i.categoryId) || { g: 0, r: 0, p: 0 }; x.g += i.grams; x.r += i.revenue; x.p += i.profit; st.set(i.categoryId, x); }));
    const list = App.categories.filter((c) => !c.deleted).sort((a, b) => a.name.localeCompare(b.name));
    el.innerHTML = `<div class="page-title"><a class="icon-btn" href="#/settings">‹</a><h1>Cloth Categories</h1></div>
    ${list.map((c) => { const x = st.get(c.id) || { g: 0, r: 0, p: 0 }; return `<div class="card"><div class="between"><b class="lg">${esc(c.name)}</b><div><button class="btn sm outline" data-e="${c.id}">Edit</button> <button class="btn sm danger" data-d="${c.id}">Delete</button></div></div>
      <div class="row3 mt"><div class="mini"><span>Purchase</span><b>${m.fmtMoney(c.buyPerKg)}</b></div><div class="mini"><span>Selling</span><b>${m.fmtMoney(c.sellPerKg)}</b></div><div class="mini"><span>Margin/KG</span><b class="${c.sellPerKg < c.buyPerKg ? 'neg' : 'pos'}">${m.fmtMoney(c.sellPerKg - c.buyPerKg)}</b></div></div>
      <div class="row3 mt"><div class="mini"><span>KG sold</span><b>${m.fmtKg(x.g, false)}</b></div><div class="mini"><span>Sales</span><b>${m.fmtMoney(x.r)}</b></div><div class="mini"><span>Profit</span><b class="pos">${m.fmtMoney(x.p)}</b></div></div></div>`; }).join('') || '<div class="card empty">No categories. Tap + to add one.</div>'}
    <div class="muted small pad0">Sales/profit are all-time, net of cancellations, before bill-level discounts.</div><button class="fab" data-act="add" aria-label="Add category">+</button>`;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'add') categoryForm(null);
      else if (b.dataset.e) categoryForm(App.categories.find((c) => c.id === b.dataset.e));
      else if (b.dataset.d) { const c = App.categories.find((x) => x.id === b.dataset.d); if (await App.confirm({ title: `Delete “${c.name}”?`, message: 'It will no longer appear in New Sale. Past bills and reports keep their data.', okText: 'Delete', danger: true })) { await DB.put('categories', Object.assign({}, c, { deleted: true })); await App.afterSave(); route(); } }
    });
  }

  // ================= PIN lock =================
  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(salt + ':' + pin);
    if (crypto.subtle) { const h = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
    let x = 5381; data.forEach((b) => { x = ((x << 5) + x + b) >>> 0; }); return 'f' + x;
  }
  let lockedAt = 0, fails = 0, blockedUntil = 0;
  function showLock() {
    if (!App.settings.pinHash) return; const el = $('#lock'); el.classList.remove('hide'); document.body.classList.add('noscroll'); let buf = ''; const len = App.settings.pinLen || 4;
    const dots = () => { $('#lockDots').innerHTML = Array.from({ length: len }, (_, i) => `<i class="${i < buf.length ? 'on' : ''}"></i>`).join(''); };
    const msg = (t) => { $('#lockMsg').textContent = t || ''; };
    el.innerHTML = `<div class="lock-box"><div class="lock-title">🔒 ${esc(App.settings.shopName)}</div><div class="muted">Enter PIN</div><div id="lockDots" class="dots"></div><div id="lockMsg" class="err-line c"></div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => `<button data-k="${k}" ${k === '' ? 'disabled class="ghost"' : ''}>${k}</button>`).join('')}</div><button class="link" id="lockForgot">Forgot PIN?</button></div>`;
    dots();
    el.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'lockForgot') { return App.sheet({ title: 'Forgot PIN', body: '<p>The PIN is only a privacy screen stored on this phone. Your sales data is <b>not</b> deleted. Type <b>RESET</b> to remove the PIN lock.</p><input id="rs" class="inp" placeholder="RESET"><button class="btn danger block mt" id="rsGo">Remove PIN</button>', onMount(r, close) { r.querySelector('#rsGo').onclick = async () => { if (r.querySelector('#rs').value.trim() === 'RESET') { await DB.setSettings({ pinHash: '', pinSalt: '', pinLen: 0 }); await loadCache(); close(); el.classList.add('hide'); document.body.classList.remove('noscroll'); App.toast('PIN removed', 'ok'); } }; } }); }
      const k = b.dataset.k; if (k === undefined) return;
      if (Date.now() < blockedUntil) return msg(`Too many attempts. Wait ${Math.ceil((blockedUntil - Date.now()) / 1000)}s`);
      if (k === '⌫') buf = buf.slice(0, -1); else if (buf.length < len) buf += k; dots();
      if (buf.length === len) {
        const ok = (await hashPin(buf, App.settings.pinSalt)) === App.settings.pinHash;
        if (ok) { fails = 0; el.classList.add('hide'); el.innerHTML = ''; document.body.classList.remove('noscroll'); }
        else { fails++; buf = ''; dots(); msg('Wrong PIN'); if (navigator.vibrate) navigator.vibrate(120); if (fails >= 5) { blockedUntil = Date.now() + 30000; fails = 0; msg('Too many attempts. Wait 30s'); } }
      }
    };
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) lockedAt = Date.now(); else if (App.settings.pinHash && lockedAt && Date.now() - lockedAt > 60000) showLock(); });

  // ================= Settings =================
  async function settings(el) {
    const s = App.settings; const st = await Cloud.statusInfo(); const nextNo = await DB.peekNextInvoiceNumber(); const cs = Cloud.state;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone; const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const row = (id, label, val, extra) => `<div class="mt"><div class="lbl">${label}</div><input id="${id}" class="inp" value="${esc(val)}" ${extra || ''}></div>`;
    el.innerHTML = `<div class="page-title"><h1>Settings</h1></div>
    <a class="card row-card link-card" href="#/categories"><div class="grow"><b>Cloth categories &amp; prices</b><div class="muted">Add, edit, delete · purchase &amp; selling price per KG</div></div><span>›</span></a>
    <div class="card"><div class="lbl">Shop information</div>${row('sName', 'Shop name', s.shopName, 'maxlength="60"')}${row('sAddr', 'Shop address', s.shopAddress, 'maxlength="160"')}${row('sPhone', 'Phone number', s.shopPhone, 'inputmode="tel"')}${row('sFoot', 'Invoice footer message', s.invoiceFooter, 'maxlength="100"')}<button class="btn primary block mt" data-act="save-shop">Save shop info</button></div>
    <div class="card"><div class="lbl">Invoice &amp; payment</div><div class="row2">${row('sPre', 'Invoice prefix', s.invoicePrefix, 'maxlength="10"')}${row('sNext', 'Next invoice number', nextNo, 'inputmode="numeric"')}</div>
      <div class="mt"><div class="lbl">Currency</div><div class="ro">Indian Rupee (₹ INR)</div></div><div class="lbl mt">Default payment method</div><div class="chips" id="sPay">${m.PAYMENTS.map((p) => `<button class="chip ${s.defaultPayment === p ? 'on' : ''}" data-p="${p}">${p}</button>`).join('')}</div><button class="btn primary block mt" data-act="save-inv">Save invoice settings</button></div>
    <div class="card"><div class="lbl">Theme</div><div class="seg" id="sTheme">${['dark', 'light', 'auto'].map((t) => `<button data-t="${t}" class="${s.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
    <div class="card"><div class="lbl">Security · app PIN lock</div><div class="muted">${s.pinHash ? 'PIN lock is ON. The app locks on start and after 1 minute in the background.' : 'Optional 4–6 digit PIN to hide your sales from casual viewers.'}</div>
      <div class="row2 mt">${s.pinHash ? '<button class="btn outline" data-act="pin-change">Change PIN</button><button class="btn danger" data-act="pin-remove">Remove PIN</button>' : '<button class="btn primary" data-act="pin-set">Set PIN</button><span></span>'}</div>${s.pinHash ? '<button class="btn outline block mt" data-act="lock-now">Lock now</button>' : ''}
      <div class="muted small mt">⚠ Limits of client-side security: the PIN only blocks casual access. Data is stored unencrypted in this browser, so anyone with the unlocked phone, browser tools or a backup file can read it. Use the phone’s screen lock, keep backups private, and never store card numbers or payment credentials here.</div></div>
    <div class="card"><div class="lbl">Backup &amp; restore (offline)</div><div class="muted">Last backup: ${s.lastBackupAt ? dt(s.lastBackupAt) : 'never'}. Backups never include your PIN or Firebase keys.</div>
      <div class="row2 mt"><button class="btn primary" data-act="bk-export">⬇ Export backup</button><button class="btn outline" data-act="bk-import">⬆ Import backup</button></div><input type="file" id="bkFile" accept="application/json,.json" class="hide"></div>
    <div class="card"><div class="lbl">Data export</div><div class="row2"><button class="btn outline" data-act="ex-xlsx">All sales · Excel</button><button class="btn outline" data-act="ex-csv">All sales · CSV</button></div></div>
    <div class="card"><div class="lbl">Cloud backup · Firebase (optional)</div><div id="cloudSt" class="status ${st.kind}">${esc(st.label)}</div>
      ${cs.config ? `<div class="muted small">Project: ${esc(cs.config.projectId)}</div>` : '<div class="muted small">Needs your own free Firebase project. See README → Firebase setup.</div>'}
      <div id="cloudBody"></div></div>
    <div class="card"><div class="lbl">Install app</div>${standalone ? '<div class="muted">Installed ✔ – running as an app.</div>' : App.deferredInstall ? '<button class="btn primary block" data-act="install">Install on this phone</button>' : ios ? '<div class="muted">On iPhone: tap the Share button in Safari, then “Add to Home Screen”.</div>' : '<div class="muted">Open this page over HTTPS in Chrome and use the browser menu → “Install app” / “Add to Home screen”.</div>'}
      <div class="muted small mt">Version 1.0.0 · Data is stored in IndexedDB (schema v${DB.DB_VERSION}) <span id="persist"></span></div></div>`;
    cloudBody(el);
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then((p) => { const x = $('#persist', el); if (x) x.textContent = p ? '· storage protected' : ''; });

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return; const a = b.dataset.act;
      try {
        if (b.dataset.p) { App.settings.defaultPayment = b.dataset.p; el.querySelectorAll('#sPay .chip').forEach((x) => x.classList.toggle('on', x === b)); }
        else if (b.dataset.t) { await DB.setSetting('theme', b.dataset.t); App.settings.theme = b.dataset.t; applyTheme(); el.querySelectorAll('#sTheme button').forEach((x) => x.classList.toggle('on', x === b)); }
        else if (a === 'save-shop') { const name = $('#sName', el).value.trim(); if (!name) return App.toast('Shop name is required', 'err'); const ph = $('#sPhone', el).value.trim(); if (ph && !/^[+]?[0-9 ()-]{6,18}$/.test(ph)) return App.toast('Enter a valid phone number', 'err');
          await DB.setSettings({ shopName: name, shopAddress: $('#sAddr', el).value.trim(), shopPhone: ph, invoiceFooter: $('#sFoot', el).value.trim(), settingsUpdatedAt: Date.now() }); await App.afterSave(); App.toast('Shop info saved', 'ok'); }
        else if (a === 'save-inv') { const n = parseInt($('#sNext', el).value, 10); const pre = $('#sPre', el).value.trim(); if (!Number.isInteger(n) || n < 1) return App.toast('Next invoice number must be 1 or more', 'err'); if (!/^[A-Za-z0-9_\-\/]{0,10}$/.test(pre)) return App.toast('Prefix may use letters, digits, - _ / only', 'err');
          await DB.setSettings({ invoicePrefix: pre, defaultPayment: App.settings.defaultPayment, settingsUpdatedAt: Date.now() }); await DB.setNextInvoiceNumber(n); await App.afterSave(); App.toast('Invoice settings saved', 'ok'); }
        else if (a === 'pin-set' || a === 'pin-change') pinSetup();
        else if (a === 'pin-remove') { if (await App.confirm({ title: 'Remove PIN?', message: 'The app will no longer ask for a PIN.', okText: 'Remove', danger: true })) { await DB.setSettings({ pinHash: '', pinSalt: '', pinLen: 0 }); await loadCache(); route(); } }
        else if (a === 'lock-now') showLock();
        else if (a === 'bk-export') { const c = await Backup.exportJSON(); await loadCache(); App.toast(`Backup saved: ${c.sales} sales, ${c.customers} customers`, 'ok'); route(); }
        else if (a === 'bk-import') $('#bkFile', el).click();
        else if (a === 'ex-xlsx') { Backup.downloadXlsx(`all-sales-${DB.localDay(new Date())}.xlsx`, [Backup.salesSheet(await DB.getAll('sales'))]); }
        else if (a === 'ex-csv') { Backup.download(`all-sales-${DB.localDay(new Date())}.csv`, '﻿' + Backup.toCsv(Backup.salesSheet(await DB.getAll('sales')).rows), 'text/csv'); }
        else if (a === 'install') installApp();
      } catch (err) { console.error(err); App.toast(err.message, 'err'); }
    });
    $('#bkFile', el).addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const parsed = Backup.parseBackup(await f.text()); const c = parsed.data;
        App.sheet({ title: 'Import backup', body: `<p>File: <b>${esc(f.name)}</b><br>${c.sales.length} sales · ${c.customers.length} customers · ${c.categories.length} categories<br><span class="muted">Exported ${parsed.exportedAt ? dt(parsed.exportedAt) : ''}</span></p>${parsed.skipped.length ? `<div class="err-line">⚠ ${parsed.skipped.length} invalid record(s) will be skipped.</div>` : ''}
          <button class="btn primary block mt" data-m="merge">Merge (keep newest of each record)</button><div class="muted small">Adds missing records and updates older ones. Nothing is lost.</div>
          <button class="btn danger block mt" data-m="replace">Replace all data (restore)</button><div class="muted small">Wipes current data and restores the file. A safety backup of your current data is downloaded first.</div>`,
          onMount(r, close) { r.addEventListener('click', async (ev) => { const bt = ev.target.closest('[data-m]'); if (!bt) return; bt.disabled = true;
            try { if (bt.dataset.m === 'replace') await Backup.exportJSON(); const res = await Backup.restore(parsed, bt.dataset.m); await loadCache(); close(); App.toast(bt.dataset.m === 'replace' ? 'Backup restored' : `Merged: ${res.added} added, ${res.updated} updated`, 'ok'); applyTheme(); route(); } catch (er) { console.error(er); App.toast('Restore failed: ' + er.message, 'err'); bt.disabled = false; } }); } });
      } catch (err) { App.toast(err.message, 'err', 5000); }
    });
  }
  function pinSetup() {
    App.sheet({ title: 'Set PIN', body: `<div class="lbl">New PIN (4–6 digits)</div><input id="p1" class="inp" type="password" inputmode="numeric" maxlength="6"><div class="lbl mt">Repeat PIN</div><input id="p2" class="inp" type="password" inputmode="numeric" maxlength="6"><div id="pe" class="err-line"></div><button class="btn primary block mt" id="pgo">Save PIN</button>`,
      onMount(r, close) { r.querySelector('#pgo').onclick = async () => { const a = r.querySelector('#p1').value, b = r.querySelector('#p2').value; if (!/^\d{4,6}$/.test(a)) return (r.querySelector('#pe').textContent = 'PIN must be 4 to 6 digits'); if (a !== b) return (r.querySelector('#pe').textContent = 'PINs do not match');
        const salt = DB.uid(); await DB.setSettings({ pinSalt: salt, pinHash: await hashPin(a, salt), pinLen: a.length }); await loadCache(); close(); App.toast('PIN lock enabled', 'ok'); route(); }; } });
  }
  function cloudBody(el) {
    const box = $('#cloudBody', el); if (!box) return; const cs = Cloud.state; const s = App.settings;
    if (!cs.config) { box.innerHTML = `<div class="lbl mt">Paste your Firebase web config</div><textarea id="fbCfg" class="inp mono" rows="6" placeholder='${esc(Cloud.CONFIG_PLACEHOLDER)}'></textarea><button class="btn primary block mt" data-c="cfg">Save configuration</button>`; }
    else if (!cs.user) { box.innerHTML = `<div class="lbl mt">Sign in to back up</div><input id="fbE" class="inp" type="email" placeholder="Email" value="${esc(s.cloudEmail || '')}" autocomplete="username"><input id="fbP" class="inp mt" type="password" placeholder="Password (min 6)" autocomplete="current-password"><div class="row2 mt"><button class="btn primary" data-c="in">Sign in</button><button class="btn outline" data-c="up">Create account</button></div><button class="btn ghost sm mt" data-c="reset">Forgot password</button> <button class="btn ghost sm mt" data-c="rm">Remove config</button>`; }
    else { box.innerHTML = `<div class="muted">Signed in as <b>${esc(cs.user.email)}</b>${cs.lastSync ? ' · last sync ' + cs.lastSync.toLocaleTimeString('en-IN') : ''}</div>${cs.lastResult ? `<div class="muted small">Last run: ${cs.lastResult.pushed} uploaded, ${cs.lastResult.pulled} downloaded${cs.lastResult.conflicts ? `, ${cs.lastResult.conflicts} conflict(s) resolved (newest kept)` : ''}</div>` : ''}
      <div class="row2 mt"><button class="btn primary" data-c="sync">Sync now</button><button class="btn outline" data-c="restore">Restore from cloud</button></div>
      <label class="check mt"><input type="checkbox" id="autoSync" ${s.autoSync !== false ? 'checked' : ''}> Auto-sync when online</label><div class="row2 mt"><button class="btn ghost" data-c="out">Sign out</button><button class="btn ghost" data-c="rm">Remove config</button></div>`; }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]'); if (!b || !b.closest('#cloudBody')) return; const c = b.dataset.c; const box = $('#cloudBody');
    b.disabled = true;
    try {
      if (c === 'cfg') { await Cloud.saveConfig($('#fbCfg', box).value); App.toast('Configuration saved', 'ok'); }
      else if (c === 'in') { await Cloud.signIn($('#fbE', box).value.trim(), $('#fbP', box).value); App.toast('Signed in', 'ok'); }
      else if (c === 'up') { await Cloud.signUp($('#fbE', box).value.trim(), $('#fbP', box).value); App.toast('Account created', 'ok'); }
      else if (c === 'reset') { await Cloud.resetPassword($('#fbE', box).value.trim()); App.toast('Password reset email sent', 'ok'); }
      else if (c === 'sync') { const r = await Cloud.sync(); App.toast(`Synced: ${r.pushed} up, ${r.pulled} down`, 'ok'); }
      else if (c === 'restore') { if (await App.confirm({ title: 'Restore from cloud?', message: 'Downloads all cloud records and merges them with this phone. Newer local changes are kept.', okText: 'Restore' })) { const r = await Cloud.restoreAll(); await loadCache(); App.toast(`Restored ${r.pulled} records`, 'ok'); } }
      else if (c === 'out') await Cloud.signOut();
      else if (c === 'rm' && await App.confirm({ title: 'Remove Firebase config?', message: 'Cloud backup will be turned off on this phone. Local data is untouched.', okText: 'Remove', danger: true })) await Cloud.removeConfig();
    } catch (err) { App.toast(err.message || String(err), 'err', 5000); }
    b.disabled = false; if (App.route === 'settings') { cloudBody(document.querySelector('#view .page')); refreshCloudStatus(); }
  });
  document.addEventListener('change', async (e) => { if (e.target.id === 'autoSync') { await DB.setSetting('autoSync', e.target.checked); App.settings.autoSync = e.target.checked; } });
  async function refreshCloudStatus() {
    const st = await Cloud.statusInfo(); const el = $('#cloudSt'); if (el) { el.className = 'status ' + st.kind; el.textContent = st.label; }
    const chip = $('#syncChip'); if (chip) { chip.className = 'sync-chip ' + st.kind; chip.title = st.label; chip.classList.toggle('hide', st.kind === 'off'); chip.textContent = st.kind === 'ok' ? '☁ ✓' : st.kind === 'err' ? '☁ !' : st.kind === 'info' ? '☁ …' : '☁'; }
  }

  // ================= PWA =================
  function installApp() { const p = App.deferredInstall; if (!p) return App.toast('Use your browser menu → Add to Home screen', 'info'); p.prompt(); p.userChoice.finally(() => { App.deferredInstall = null; if (App.route === 'settings' || App.route === 'dashboard') route(); }); }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); App.deferredInstall = e; if (App.route === 'dashboard' || App.route === 'settings') route(); });
  window.addEventListener('appinstalled', () => { App.deferredInstall = null; App.toast('App installed', 'ok'); });
  function updateBanner(worker) {
    const b = $('#update'); b.classList.remove('hide'); b.innerHTML = '<span>A new version is ready.</span><button class="btn sm primary" id="doUpdate">Update</button>';
    $('#doUpdate').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return; if (!window.isSecureContext) { console.warn('Service workers need HTTPS (or localhost)'); return; }
    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) updateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) updateBanner(w); }); });
      setInterval(() => reg.update().catch(() => {}), 3600000);
    }).catch((e) => console.warn('SW registration failed', e));
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; location.reload(); });
  }
  function netBanner() { const f = () => $('#offline').classList.toggle('hide', navigator.onLine); window.addEventListener('online', f); window.addEventListener('offline', f); f(); }

  // ================= boot =================
  async function boot() {
    try {
      await DB.open(); await DB.seedIfEmpty(); await loadCache(); applyTheme(); DB.requestPersistence();
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
      buildNav();
      const menuToggle = $('#menuToggle');
      menuToggle.addEventListener('click', () => {
        const open = menuToggle.getAttribute('aria-expanded') !== 'true';
        menuToggle.setAttribute('aria-expanded', String(open));
        menuToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
        $('#nav').classList.toggle('menu-open', open);
      });
      $('#nav').addEventListener('click', (e) => {
        if (e.target.closest('a')) {
          $('#nav').classList.remove('menu-open');
          menuToggle.setAttribute('aria-expanded', 'false');
          menuToggle.setAttribute('aria-label', 'Open navigation menu');
        }
      });
      netBanner(); await Cloud.init(); Cloud.onStatus(() => { refreshCloudStatus(); if (App.route === 'settings' && !document.querySelector('.sheet-back')) { const p = document.querySelector('#view .page'); if (p && $('#cloudBody', p)) cloudBody(p); } });
      refreshCloudStatus(); setInterval(refreshCloudStatus, 15000);
      window.addEventListener('hashchange', route); showLock(); await route(); registerSW();
      $('#splash').classList.add('hide');
    } catch (e) {
      console.error(e); $('#splash').innerHTML = `<div class="lock-box"><h2>Could not start</h2><p>${esc(e.message)}</p><p class="muted">Private browsing may block local storage. Open the app in a normal browser tab.</p></div>`;
    }
  }
  boot();
})();
