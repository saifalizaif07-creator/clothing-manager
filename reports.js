/* reports.js – aggregation (pure), canvas charts, Reports screen, PDF + Excel report export.
 * Sales and their reversal records are summed together (reversals are negative), so totals are always net. */
'use strict';
(function (root) {
  const PAY = ['Cash', 'UPI', 'Card'];

  function emptyAgg() { return { sales: 0, profit: 0, cost: 0, grams: 0, bills: 0, discount: 0, extra: 0, pay: { Cash: 0, UPI: 0, Card: 0 } }; }
  function add(a, e) {
    const sign = e.kind === 'reversal' ? -1 : 1;
    a.sales += e.total; a.profit += e.profit; a.cost += e.cost; a.grams += e.totalGrams; a.bills += sign; a.discount += e.discount; a.extra += e.extra;
    a.pay[e.payment] = (a.pay[e.payment] || 0) + e.total;
  }
  /** entries: sale + reversal records */
  function aggregate(entries) {
    const t = emptyAgg(); const byDay = new Map(); const byCat = new Map(); const byCust = new Map(); const byPay = new Map();
    entries.forEach((e) => {
      add(t, e);
      if (!byDay.has(e.day)) byDay.set(e.day, emptyAgg()); add(byDay.get(e.day), e);
      const ck = e.customerId || 'guest';
      if (!byCust.has(ck)) byCust.set(ck, Object.assign(emptyAgg(), { name: e.customerName || 'Guest', phone: e.customerPhone || '', last: '' }));
      const cu = byCust.get(ck); add(cu, e); if (e.createdAt > cu.last) cu.last = e.createdAt;
      if (!byPay.has(e.payment)) byPay.set(e.payment, emptyAgg()); add(byPay.get(e.payment), e);
      e.items.forEach((i) => {
        const k = i.categoryId || i.name;
        if (!byCat.has(k)) byCat.set(k, { name: i.name, grams: 0, revenue: 0, cost: 0, profit: 0 });
        const c = byCat.get(k); c.grams += i.grams; c.revenue += i.revenue; c.cost += i.cost; c.profit += i.profit;
      });
    });
    return { total: t, byDay, byCat: [...byCat.values()].sort((a, b) => b.revenue - a.revenue), byCust: [...byCust.values()].sort((a, b) => b.sales - a.sales), byPay };
  }
  function bestSelling(entries, n) { return aggregate(entries).byCat.filter((c) => c.grams > 0).sort((a, b) => b.grams - a.grams).slice(0, n || 3); }

  // ---- date helpers (local, string based) ----
  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
  function rangeFor(type, v) {
    if (type === 'day') return { from: v, to: v, label: parseDay(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) };
    if (type === 'week') { const d = parseDay(v); const off = (d.getDay() + 6) % 7; const from = addDays(v, -off); const to = addDays(from, 6); return { from, to, label: `Week ${from} to ${to}` }; }
    if (type === 'month') { const [y, m] = v.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}`, label: new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }; }
    if (type === 'year') return { from: `${v}-01-01`, to: `${v}-12-31`, label: `Year ${v}` };
    const [f, t] = v; return { from: f, to: t, label: `${f} to ${t}` };
  }
  function daysBetween(from, to) { const out = []; let d = from; let g = 0; while (d <= to && g++ < 800) { out.push(d); d = addDays(d, 1); } return out; }

  /** time series for charts: per-day for <=62 days, otherwise per-month */
  function series(agg, from, to) {
    const days = daysBetween(from, to);
    if (days.length <= 62) return { labels: days.map((d) => d.slice(8) + '/' + d.slice(5, 7)), sales: days.map((d) => (agg.byDay.get(d) || emptyAgg()).sales), profit: days.map((d) => (agg.byDay.get(d) || emptyAgg()).profit), keys: days };
    const m = new Map(); days.forEach((d) => { const k = d.slice(0, 7); if (!m.has(k)) m.set(k, emptyAgg()); const a = agg.byDay.get(d); if (a) { const x = m.get(k); x.sales += a.sales; x.profit += a.profit; } });
    const keys = [...m.keys()];
    return { labels: keys.map((k) => new Date(+k.slice(0, 4), +k.slice(5) - 1, 1).toLocaleDateString('en-IN', { month: 'short' })), sales: keys.map((k) => m.get(k).sales), profit: keys.map((k) => m.get(k).profit), keys };
  }

  async function entriesFor(from, to) { return DB.getRange('sales', 'day', from, to); }

  // ================= Charts (canvas, no libraries) =================
  function cssVar(n, f) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f; } catch (e) { return f; } }
  function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function bars(canvas, labels, seriesList) {
    const dpr = window.devicePixelRatio || 1; const W = canvas.clientWidth || 320; const H = canvas.clientHeight || 190;
    canvas.width = W * dpr; canvas.height = H * dpr; const c = canvas.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
    const txt = cssVar('--muted', '#8a97b2'), grid = cssVar('--line', '#243253');
    const all = seriesList.flatMap((s) => s.values.map((v) => v / 100));
    const maxV = niceMax(Math.max(0, ...all)), minV = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
    const padL = 42, padR = 6, padT = 8, padB = 22; const cw = W - padL - padR, ch = H - padT - padB;
    const y = (v) => padT + ch - ((v - minV) / (maxV - minV)) * ch;
    c.font = '10px system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'right';
    for (let i = 0; i <= 4; i++) { const v = minV + ((maxV - minV) * i) / 4; const yy = y(v); c.strokeStyle = grid; c.lineWidth = 1; c.beginPath(); c.moveTo(padL, yy); c.lineTo(W - padR, yy); c.stroke(); c.fillStyle = txt; c.fillText(v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : Math.round(v), padL - 5, yy); }
    const n = labels.length; const slot = cw / Math.max(1, n); const gw = Math.min(slot * 0.8, 36 * seriesList.length); const bw = gw / seriesList.length - 1;
    const every = Math.ceil(n / Math.max(3, Math.floor(cw / 34)));
    labels.forEach((l, i) => {
      const x0 = padL + slot * i + (slot - gw) / 2;
      seriesList.forEach((s, j) => { const v = s.values[i] / 100; const y0 = y(0), y1 = y(v); c.fillStyle = s.color; const top = Math.min(y0, y1), h = Math.max(Math.abs(y0 - y1), v ? 1 : 0); const r = Math.min(3, bw / 2); c.beginPath(); c.roundRect ? c.roundRect(x0 + j * (bw + 1), top, bw, h, r) : c.rect(x0 + j * (bw + 1), top, bw, h); c.fill(); });
      if (i % every === 0) { c.fillStyle = txt; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(l, padL + slot * i + slot / 2, H - padB + 6); }
    });
  }

  // ================= Reports screen =================
  const st = { type: 'month', day: dayStr(new Date()), month: dayStr(new Date()).slice(0, 7), year: String(new Date().getFullYear()), from: dayStr(new Date()), to: dayStr(new Date()) };
  let last = null;
  function curRange() { return st.type === 'day' ? rangeFor('day', st.day) : st.type === 'week' ? rangeFor('week', st.day) : st.type === 'month' ? rangeFor('month', st.month) : st.type === 'year' ? rangeFor('year', st.year) : rangeFor('custom', [st.from, st.to]); }

  async function view(el) {
    el.innerHTML = `<div class="page-title"><h1>Reports</h1></div>
    <div class="chips" id="rType">${[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly'], ['custom', 'Custom']].map(([k, l]) => `<button class="chip ${st.type === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
    <div class="card" id="rCtl"></div><div id="rOut"></div>`;
    controls(el); await render(el);
    el.onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.t) { st.type = t.dataset.t; el.querySelectorAll('#rType .chip').forEach((b) => b.classList.toggle('on', b.dataset.t === st.type)); controls(el); render(el); }
      else if (t.dataset.x === 'pdf') exportPdf().catch((er) => App.toast(er.message, 'err'));
      else if (t.dataset.x === 'xlsx') exportXlsx();
    };
    el.onchange = (e) => { const id = e.target.id; if (!id || !id.startsWith('r_')) return; const k = id.slice(2); if (e.target.value) { st[k] = e.target.value; render(el); } };
  }
  function controls(el) {
    const c = el.querySelector('#rCtl');
    const inp = (id, type, val, label) => `<div><div class="lbl">${label}</div><input id="r_${id}" class="inp" type="${type}" value="${val}"></div>`;
    c.innerHTML = st.type === 'day' ? inp('day', 'date', st.day, 'Date') : st.type === 'week' ? inp('day', 'date', st.day, 'Any date in the week (Mon–Sun)') : st.type === 'month' ? inp('month', 'month', st.month, 'Month')
      : st.type === 'year' ? inp('year', 'number', st.year, 'Year') : `<div class="row2">${inp('from', 'date', st.from, 'From')}${inp('to', 'date', st.to, 'To')}</div>`;
  }
  async function render(el) {
    const m = Billing, esc = App.esc; const r = curRange(); const out = el.querySelector('#rOut');
    if (!r.from || !r.to || r.from > r.to || (st.type === 'year' && !/^\d{4}$/.test(st.year))) { out.innerHTML = '<div class="card empty">Choose a valid period.</div>'; last = null; return; }
    const entries = await entriesFor(r.from, r.to); const agg = aggregate(entries); const T = agg.total;
    last = { r, entries, agg };
    const tile = (k, v, cls) => `<div class="tile ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
    const tbl = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h, i) => `<th class="${i ? 'r' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((x) => `<tr>${x.map((c, i) => `<td class="${i ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="muted c">No data</td></tr>`}</tbody></table></div>`;
    out.innerHTML = `
    <div class="muted small pad0">${esc(r.label)} · ${entries.filter((e) => e.kind === 'sale').length} bills, ${entries.filter((e) => e.kind === 'reversal').length} reversals (net figures)</div>
    <div class="tiles">${tile('Total sales', m.fmtMoney(T.sales))}${tile('Total profit', m.fmtMoney(T.profit), 'green')}${tile('KG sold', m.fmtKg(T.grams))}${tile('Total bills', T.bills)}
      ${tile('Cash collection', m.fmtMoney(T.pay.Cash))}${tile('UPI collection', m.fmtMoney(T.pay.UPI))}${tile('Card collection', m.fmtMoney(T.pay.Card))}${tile('Discounts given', m.fmtMoney(T.discount))}</div>
    <div class="card"><div class="lbl">Sales vs profit</div><canvas id="rChart" class="chart"></canvas><div class="legend"><i style="background:var(--blue)"></i>Sales <i style="background:var(--green)"></i>Profit</div></div>
    <div class="card"><div class="lbl">Category-wise report</div>${tbl(['Category', 'KG', 'Revenue', 'Profit'], agg.byCat.map((c) => [esc(c.name), m.fmtKg(c.grams, false), m.fmtMoney(c.revenue), `<span class="${c.profit < 0 ? 'neg' : 'pos'}">${m.fmtMoney(c.profit)}</span>`]))}<div class="muted small">Revenue/profit before bill-level discounts.</div></div>
    <div class="card"><div class="lbl">Customer-wise report</div>${tbl(['Customer', 'Bills', 'Sales', 'Profit'], agg.byCust.map((c) => [esc(c.name), c.bills, m.fmtMoney(c.sales), m.fmtMoney(c.profit)]))}</div>
    <div class="card"><div class="lbl">Payment method report</div>${tbl(['Method', 'Bills', 'Amount'], PAY.map((p) => { const a = agg.byPay.get(p) || emptyAgg(); return [p, a.bills, m.fmtMoney(a.sales)]; }))}</div>
    <div class="card"><div class="lbl">Day-wise</div>${tbl(['Date', 'Bills', 'Sales', 'Profit'], [...agg.byDay.entries()].sort().map(([d, a]) => [d, a.bills, m.fmtMoney(a.sales), m.fmtMoney(a.profit)]))}</div>
    <div class="row2"><button class="btn primary" data-x="pdf">⬇ Export PDF</button><button class="btn primary" data-x="xlsx">⬇ Export Excel</button></div>`;
    const s = series(agg, r.from, r.to);
    requestAnimationFrame(() => bars(out.querySelector('#rChart'), s.labels, [{ color: cssVar('--blue', '#4f8cff'), values: s.sales }, { color: cssVar('--green', '#22c55e'), values: s.profit }]));
  }

  function exportXlsx() {
    if (!last) return App.toast('Nothing to export', 'warn');
    const m = Billing, { r, entries, agg } = last, T = agg.total; const H = (t) => ({ v: t, s: 'head' }); const $ = (p) => ({ v: m.moneyNum(p), s: 'money' }); const K = (g) => ({ v: m.kgNum(g), s: 'kg' });
    const sheets = [
      { name: 'Summary', rows: [[{ v: (App.settings.shopName || 'Shop') + ' – Sales Report', s: 'title' }], [r.label], [], [H('Metric'), H('Value')], ['Total sales', $(T.sales)], ['Total profit', $(T.profit)], ['Total cost', $(T.cost)], ['KG sold', K(T.grams)], ['Total bills (net)', T.bills], ['Cash collection', $(T.pay.Cash)], ['UPI collection', $(T.pay.UPI)], ['Card collection', $(T.pay.Card)], ['Discounts given', $(T.discount)], ['Extra charges', $(T.extra)]] },
      { name: 'Day-wise', rows: [[H('Date'), H('Bills'), H('KG'), H('Sales'), H('Profit'), H('Cash'), H('UPI'), H('Card')], ...[...agg.byDay.entries()].sort().map(([d, a]) => [d, a.bills, K(a.grams), $(a.sales), $(a.profit), $(a.pay.Cash), $(a.pay.UPI), $(a.pay.Card)])] },
      { name: 'Categories', rows: [[H('Category'), H('KG sold'), H('Revenue'), H('Cost'), H('Profit')], ...agg.byCat.map((c) => [c.name, K(c.grams), $(c.revenue), $(c.cost), $(c.profit)])] },
      { name: 'Customers', rows: [[H('Customer'), H('Phone'), H('Bills'), H('Sales'), H('Profit')], ...agg.byCust.map((c) => [c.name, c.phone, c.bills, $(c.sales), $(c.profit)])] },
      { name: 'Payments', rows: [[H('Method'), H('Bills'), H('Amount')], ...PAY.map((p) => { const a = agg.byPay.get(p) || emptyAgg(); return [p, a.bills, $(a.sales)]; })] },
      Backup.salesSheet(entries),
    ];
    Backup.downloadXlsx(`report-${r.from}_to_${r.to}.xlsx`, sheets); App.toast('Excel report downloaded', 'ok');
  }

  async function exportPdf() {
    if (!last) return App.toast('Nothing to export', 'warn');
    const m = Billing, { r, agg } = last, T = agg.total; const L = 36, R = 559;
    const d = new Invoice.Doc({ w: 595, h: 842, scale: 2.5, margin: 36 });
    const P = (v) => m.fmtMoney(v).replace('₹', '₹');
    d.text(App.settings.shopName || 'Shop', L, d.y + 8, { size: 18, bold: true, color: '#0f1b33' }); d.y += 26;
    d.text('Sales & Profit Report · ' + r.label, L, d.y, { size: 11, color: '#444' }); d.y += 8; d.line(L, d.y, R, d.y, '#0f1b33', 1.2); d.y += 20;
    const kv = [['Total sales', P(T.sales)], ['Total profit', P(T.profit)], ['KG sold', m.fmtKg(T.grams)], ['Bills (net)', String(T.bills)], ['Cash', P(T.pay.Cash)], ['UPI', P(T.pay.UPI)], ['Card', P(T.pay.Card)], ['Discounts', P(T.discount)]];
    kv.forEach((x, i) => { const cx = L + (i % 4) * 131; if (i % 4 === 0 && i) d.y += 36; d.text(x[0], cx, d.y, { size: 8.5, color: '#667' }); d.text(x[1], cx, d.y + 15, { size: 12, bold: true }); });
    d.y += 46;
    const table = (title, head, rows, xs) => {
      d.ensure(50); d.text(title, L, d.y, { size: 11.5, bold: true, color: '#0f1b33' }); d.y += 14;
      const hd = () => { d.rect(L, d.y - 11, R - L, 16, '#eef2f8'); head.forEach((h, i) => d.text(h, xs[i], d.y, { size: 8.5, bold: true, align: i ? 'right' : 'left' })); d.y += 15; };
      hd(); if (!rows.length) { d.text('No data', L, d.y, { size: 9, color: '#888' }); d.y += 16; }
      rows.forEach((row) => { if (d.y > d.H - 50) { d.newPage(); hd(); } row.forEach((c, i) => d.text(c, xs[i], d.y, { size: 9, align: i ? 'right' : 'left', maxW: i ? 0 : 200 })); d.y += 4; d.line(L, d.y, R, d.y, '#e6eaf2'); d.y += 12; });
      d.y += 12;
    };
    table('Category-wise', ['Category', 'KG', 'Revenue', 'Profit'], agg.byCat.map((c) => [c.name, m.fmtKg(c.grams, false), P(c.revenue), P(c.profit)]), [L, 330, 440, R]);
    table('Customer-wise', ['Customer', 'Bills', 'Sales', 'Profit'], agg.byCust.map((c) => [c.name, String(c.bills), P(c.sales), P(c.profit)]), [L, 330, 440, R]);
    table('Payment methods', ['Method', 'Bills', 'Amount'], PAY.map((p) => { const a = agg.byPay.get(p) || emptyAgg(); return [p, String(a.bills), P(a.sales)]; }), [L, 400, R]);
    table('Day-wise', ['Date', 'Bills', 'Sales', 'Profit'], [...agg.byDay.entries()].sort().map(([dd, a]) => [dd, String(a.bills), P(a.sales), P(a.profit)]), [L, 330, 440, R]);
    d.text('Revenue & profit are net of reversals. Category figures are before bill-level discounts.', L, d.H - 20, { size: 7.5, color: '#888' });
    const bytes = await d.toPdf(); Backup.download(`report-${r.from}_to_${r.to}.pdf`, new Blob([bytes], { type: 'application/pdf' })); App.toast('PDF report downloaded', 'ok');
  }

  const api = { aggregate, bestSelling, rangeFor, series, daysBetween, entriesFor, bars, view, dayStr, addDays, emptyAgg, exportXlsx, exportPdf };
  root.Reports = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
