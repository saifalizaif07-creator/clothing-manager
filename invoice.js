/* invoice.js – invoice rendering (screen/print), PDF generation (canvas -> JPEG -> PDF, full Unicode incl. ₹),
 * share sheet, WhatsApp link, cancellation/refund UI and the invoice detail screen. */
'use strict';
(function (root) {
  // ======================= PDF assembly (pure) =======================
  /** pages: [{jpeg:Uint8Array, w:px, h:px}], pageW/pageH in PDF points */
  function assemblePdf(pages, pageW, pageH) {
    const enc = new TextEncoder(); const chunks = []; const offsets = []; let pos = 0;
    const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
    const obj = (n, body, stream) => {
      offsets[n] = pos;
      if (stream) { push(`${n} 0 obj\n<< ${body} /Length ${stream.length} >>\nstream\n`); push(stream); push('\nendstream\nendobj\n'); }
      else push(`${n} 0 obj\n${body}\nendobj\n`);
    };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const total = 2 + pages.length * 3;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
      obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
      const content = enc.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);
      obj(ct, '', content);
      obj(im, `/Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, p.jpeg);
    });
    const xref = pos;
    let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= total; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    push(x + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(pos); let o = 0; chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }

  // ======================= Canvas document builder (browser) =======================
  class Doc {
    constructor(o) { o = o || {}; this.W = o.w || 420; this.H = o.h || 595; this.S = o.scale || 3; this.m = o.margin || 28; this.pages = []; this.onPage = o.onPage || null; this.newPage(); }
    newPage() {
      const c = document.createElement('canvas'); c.width = Math.round(this.W * this.S); c.height = Math.round(this.H * this.S);
      const x = c.getContext('2d'); x.scale(this.S, this.S); x.fillStyle = '#fff'; x.fillRect(0, 0, this.W, this.H); x.textBaseline = 'alphabetic';
      this.ctx = x; this.y = this.m; this.pages.push(c); if (this.onPage) this.onPage(this, this.pages.length);
    }
    ensure(h) { if (this.y + h > this.H - this.m) this.newPage(); }
    text(s, x, y, o) {
      o = o || {}; const c = this.ctx; c.font = `${o.bold ? '700' : '400'} ${o.size || 10}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      c.fillStyle = o.color || '#111'; c.textAlign = o.align || 'left';
      let str = String(s); const maxW = o.maxW;
      if (maxW) { while (str.length > 1 && c.measureText(str).width > maxW) str = str.slice(0, -1); if (str.length < String(s).length) str = str.slice(0, -1) + '…'; }
      c.fillText(str, x, y);
    }
    line(x1, y, x2, color, w) { const c = this.ctx; c.strokeStyle = color || '#ccc'; c.lineWidth = w || 0.6; c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke(); }
    rect(x, y, w, h, fill) { this.ctx.fillStyle = fill; this.ctx.fillRect(x, y, w, h); }
    async toPdf() {
      const out = [];
      for (const c of this.pages) {
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
        out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
      }
      return assemblePdf(out, this.W, this.H);
    }
  }

  // ======================= helpers =======================
  const fmtDT = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  const B = () => root.Billing;

  function customerOf(sale) { return sale.customerId ? (App.customers.find((c) => c.id === sale.customerId) || null) : null; }

  async function invoicePdf(sale) {
    const s = App.settings; const m = B(); const cust = customerOf(sale); const isRev = sale.kind === 'reversal';
    const d = new Doc({ w: 420, h: 595, scale: 3, margin: 30 });
    const L = 30, R = 390, NAVY = '#0f1b33';
    const header = () => {
      d.rect(0, 0, 420, 70, NAVY);
      d.text(s.shopName || 'Shop', 210, 33, { size: 17, bold: true, color: '#fff', align: 'center', maxW: 360 });
      const sub = [s.shopAddress, s.shopPhone ? 'Ph: ' + s.shopPhone : ''].filter(Boolean).join('  |  ');
      if (sub) d.text(sub, 210, 52, { size: 8, color: '#c8d3e8', align: 'center', maxW: 360 });
      d.y = 92;
    };
    header(); d.onPage = (doc, n) => { if (n > 1) header(); };
    d.text(isRev ? 'REFUND / REVERSAL NOTE' : 'INVOICE', L, d.y, { size: 13, bold: true, color: NAVY });
    d.text(sale.invoiceNo, R, d.y, { size: 11, bold: true, align: 'right' }); d.y += 18;
    d.text('Date: ' + fmtDT(sale.createdAt), L, d.y, { size: 9 }); d.text('Payment: ' + sale.payment, R, d.y, { size: 9, align: 'right' }); d.y += 13;
    d.text('Customer: ' + sale.customerName, L, d.y, { size: 9, maxW: 230 }); if (sale.customerPhone) d.text('Phone: ' + sale.customerPhone, R, d.y, { size: 9, align: 'right' }); d.y += 13;
    if (cust && cust.address) { d.text('Address: ' + cust.address, L, d.y, { size: 9, maxW: 340 }); d.y += 13; }
    if (isRev) { d.text('Against invoice: ' + sale.invoiceNo.replace(/-R$/, '') + (sale.reason ? '   Reason: ' + sale.reason : ''), L, d.y, { size: 9, maxW: 340 }); d.y += 13; }
    d.y += 4;
    const th = () => { d.rect(L - 4, d.y - 11, R - L + 8, 17, '#eef2f8'); d.text('Cloth category', L, d.y, { size: 8.5, bold: true }); d.text('Weight', 215, d.y, { size: 8.5, bold: true, align: 'right' }); d.text('Rate/KG', 292, d.y, { size: 8.5, bold: true, align: 'right' }); d.text('Amount', R, d.y, { size: 8.5, bold: true, align: 'right' }); d.y += 17; };
    th();
    sale.items.forEach((i) => {
      if (d.y + 20 > d.H - 120) { d.newPage(); th(); }
      d.text(i.name, L, d.y, { size: 9.5, maxW: 130 }); d.text(m.fmtKg(i.grams), 215, d.y, { size: 9.5, align: 'right' });
      d.text(m.fmtMoney(i.sellPerKg), 292, d.y, { size: 9.5, align: 'right' }); d.text(m.fmtMoney(i.revenue), R, d.y, { size: 9.5, align: 'right' });
      d.y += 8; d.line(L, d.y, R, d.y, '#e3e8f0'); d.y += 13;
    });
    d.ensure(110); d.y += 2;
    const tr = (k, v, o) => { d.text(k, 270, d.y, Object.assign({ size: 9.5, align: 'right' }, o)); d.text(v, R, d.y, Object.assign({ size: 9.5, align: 'right' }, o)); d.y += 15; };
    tr('Total weight', m.fmtKg(sale.totalGrams)); tr('Subtotal', m.fmtMoney(sale.subtotal));
    tr('Discount', (sale.discount ? '- ' : '') + m.fmtMoney(Math.abs(sale.discount))); if (sale.extra) tr('Extra charges', '+ ' + m.fmtMoney(Math.abs(sale.extra)));
    d.line(250, d.y - 8, R, d.y - 8, NAVY, 1); d.y += 4; tr('GRAND TOTAL', m.fmtMoney(sale.total), { size: 12, bold: true, color: NAVY });
    d.text('Paid by: ' + sale.payment, R, d.y, { size: 9, align: 'right', color: '#555' }); d.y += 26;
    if (s.invoiceFooter) d.text(s.invoiceFooter, 210, d.y, { size: 9, align: 'center', color: '#555', maxW: 360 });
    if (sale.status === 'cancelled') { const c = d.pages[0].getContext('2d'); c.save(); c.translate(210, 300); c.rotate(-0.5); c.font = '700 54px Arial'; c.fillStyle = 'rgba(200,30,30,0.22)'; c.textAlign = 'center'; c.fillText('CANCELLED', 0, 0); c.restore(); }
    return d.toPdf();
  }

  function pdfFile(bytes, name) { return new File([bytes], name, { type: 'application/pdf' }); }
  const fileName = (sale) => `${sale.invoiceNo}.pdf`;

  async function downloadPdf(sale) { const bytes = await invoicePdf(sale); Backup.download(fileName(sale), new Blob([bytes], { type: 'application/pdf' })); }

  function summaryText(sale) {
    const s = App.settings; const m = B();
    const lines = [`*${s.shopName}*`, `${sale.kind === 'reversal' ? 'Refund note' : 'Invoice'} ${sale.invoiceNo} · ${fmtDT(sale.createdAt)}`, ''];
    sale.items.forEach((i) => lines.push(`• ${i.name}: ${m.fmtKg(i.grams)} × ${m.fmtMoney(i.sellPerKg)} = ${m.fmtMoney(i.revenue)}`));
    lines.push('');
    if (sale.discount) lines.push(`Discount: ${m.fmtMoney(-Math.abs(sale.discount))}`);
    if (sale.extra) lines.push(`Extra charges: ${m.fmtMoney(Math.abs(sale.extra))}`);
    lines.push(`*Total: ${m.fmtMoney(sale.total)}*`, `Payment: ${sale.payment}`, '', s.invoiceFooter || 'Thank you!');
    return lines.join('\n');
  }
  async function share(sale) {
    const text = summaryText(sale);
    try {
      const bytes = await invoicePdf(sale); const f = pdfFile(bytes, fileName(sale));
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: sale.invoiceNo, text }); return; }
      if (navigator.share) { await navigator.share({ title: sale.invoiceNo, text }); App.toast('This browser cannot share files – shared text only. Use Download PDF to attach the file.', 'warn'); return; }
      Backup.download(fileName(sale), new Blob([bytes], { type: 'application/pdf' })); App.toast('Sharing is not supported here – PDF downloaded instead', 'warn');
    } catch (e) { if (e.name !== 'AbortError') App.toast('Share failed: ' + e.message, 'err'); }
  }
  function whatsapp(sale) {
    let ph = String(sale.customerPhone || '').replace(/\D/g, '');
    if (ph.length === 10) ph = '91' + ph; else if (ph.length === 11 && ph[0] === '0') ph = '91' + ph.slice(1);
    const url = `https://wa.me/${ph}?text=${encodeURIComponent(summaryText(sale))}`;
    window.open(url, '_blank', 'noopener');
    App.toast('WhatsApp opened with the bill text. A PDF cannot be auto-attached – use "Share PDF" or download it and attach manually.', 'info', 6000);
  }

  // ======================= HTML paper =======================
  function paperHtml(sale) {
    const esc = App.esc, m = B(), s = App.settings, cust = customerOf(sale), isRev = sale.kind === 'reversal';
    return `<div class="paper ${sale.status === 'cancelled' ? 'cancelled' : ''}" id="invoicePaper">
      ${sale.status === 'cancelled' ? '<div class="stamp">CANCELLED</div>' : ''}
      <div class="p-head"><h2>${esc(s.shopName)}</h2>${s.shopAddress ? `<div>${esc(s.shopAddress)}</div>` : ''}${s.shopPhone ? `<div>Ph: ${esc(s.shopPhone)}</div>` : ''}</div>
      <div class="p-title">${isRev ? 'REFUND / REVERSAL NOTE' : 'INVOICE'}</div>
      <div class="p-meta">
        <div><span>Invoice No</span><b>${esc(sale.invoiceNo)}</b></div>
        <div><span>Date &amp; time</span><b>${esc(fmtDT(sale.createdAt))}</b></div>
        <div><span>Customer</span><b>${esc(sale.customerName)}</b></div>
        ${sale.customerPhone ? `<div><span>Phone</span><b>${esc(sale.customerPhone)}</b></div>` : ''}
        ${cust && cust.address ? `<div class="full"><span>Address</span><b>${esc(cust.address)}</b></div>` : ''}
        <div><span>Payment</span><b>${esc(sale.payment)}</b></div>
        ${isRev ? `<div class="full"><span>Against invoice</span><b>${esc(sale.invoiceNo.replace(/-R$/, ''))}${sale.reason ? ' · ' + esc(sale.reason) : ''}</b></div>` : ''}
      </div>
      <table class="p-table"><thead><tr><th>Category</th><th class="r">Weight</th><th class="r">Rate/KG</th><th class="r">Amount</th></tr></thead><tbody>
      ${sale.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r">${m.fmtKg(i.grams)}</td><td class="r">${m.fmtMoney(i.sellPerKg)}</td><td class="r">${m.fmtMoney(i.revenue)}</td></tr>`).join('')}
      </tbody></table>
      <div class="p-tot"><div><span>Total weight</span><b>${m.fmtKg(sale.totalGrams)}</b></div><div><span>Subtotal</span><b>${m.fmtMoney(sale.subtotal)}</b></div>
        <div><span>Discount</span><b>${sale.discount ? '− ' : ''}${m.fmtMoney(Math.abs(sale.discount))}</b></div>
        ${sale.extra ? `<div><span>Extra charges</span><b>+ ${m.fmtMoney(Math.abs(sale.extra))}</b></div>` : ''}
        <div class="grand"><span>Grand Total</span><b>${m.fmtMoney(sale.total)}</b></div></div>
      <div class="p-foot">${esc(s.invoiceFooter || '')}</div></div>`;
  }

  // ======================= Detail screen =======================
  async function view(el, id) {
    const esc = App.esc, m = B();
    const sale = await DB.get('sales', id);
    if (!sale) { el.innerHTML = '<div class="card empty">Invoice not found.<br><a class="btn primary" href="#/history">Back to history</a></div>'; return; }
    const isRev = sale.kind === 'reversal';
    const linked = isRev ? await DB.get('sales', sale.refId) : (sale.reversalId ? await DB.get('sales', sale.reversalId) : null);
    el.innerHTML = `
    <div class="page-title"><button class="icon-btn" data-act="back" aria-label="Back">‹</button><h1>${esc(sale.invoiceNo)}</h1><span class="badge ${sale.status === 'cancelled' ? 'red' : isRev ? 'amber' : 'green'}">${isRev ? 'Reversal' : sale.status === 'cancelled' ? 'Cancelled' : 'Completed'}</span></div>
    <div class="actions-grid">
      <button class="btn primary" data-act="pdf">⬇ PDF</button><button class="btn primary" data-act="share">↗ Share PDF</button>
      <button class="btn outline" data-act="wa">WhatsApp</button><button class="btn outline" data-act="print">🖨 Print</button>
    </div>
    <div class="hint">WhatsApp opens a chat with the bill text. A PDF can't be auto-attached: use “Share PDF” (phone share sheet) or download and attach it.</div>
    <div class="paper-wrap">${paperHtml(sale)}</div>
    <div class="card"><div class="lbl">Owner view · profit (not printed on the invoice)</div>
      ${sale.items.map((i) => `<div class="trow small"><span>${esc(i.name)} · ${m.fmtKg(i.grams)}<br><small class="muted">Sold ${m.fmtMoney(i.sellPerKg)}/KG · Bought ${m.fmtMoney(i.buyPerKg)}/KG · Cost ${m.fmtMoney(i.cost)}</small></span><b class="${i.profit < 0 ? 'neg' : 'pos'}">${m.fmtMoney(i.profit)}</b></div>`).join('')}
      <div class="trow"><span>Discount given</span><b>${m.fmtMoney(sale.discount)}</b></div>
      <div class="trow grand"><span>Bill profit</span><b class="${sale.profit < 0 ? 'neg' : 'pos'}">${m.fmtMoney(sale.profit)}</b></div>
      <div class="muted small">Revenue = weight × selling price. Profit = Grand Total − Cost (i.e. gross profit − discount + extra charges). Saved purchase prices are never recalculated.</div></div>
    ${linked ? `<a class="btn outline block" href="#/invoice/${linked.id}">${isRev ? 'View original invoice ' : 'View reversal record '}${esc(linked.invoiceNo)}</a>` : ''}
    ${sale.kind === 'sale' && sale.status === 'completed' ? '<button class="btn danger block mt" data-act="cancel">Cancel / Refund this invoice</button>' : ''}
    ${sale.cancelReason ? `<div class="muted small mt">Cancel reason: ${esc(sale.cancelReason)}</div>` : ''}`;
    el.onclick = async (e) => {
      const t = e.target.closest('[data-act]'); if (!t) return;
      const a = t.dataset.act;
      try {
        if (a === 'back') history.length > 1 ? history.back() : (location.hash = '#/history');
        else if (a === 'pdf') await downloadPdf(sale);
        else if (a === 'share') await share(sale);
        else if (a === 'wa') whatsapp(sale);
        else if (a === 'print') print();
        else if (a === 'cancel') cancelFlow(sale, el, id);
      } catch (err) { console.error(err); App.toast('Failed: ' + err.message, 'err'); }
    };
  }
  function print() { document.body.classList.add('printing'); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); }, 50); }

  function cancelFlow(sale, el, id) {
    const esc = App.esc, m = B();
    App.sheet({
      title: `Cancel ${sale.invoiceNo}`,
      body: `<p class="muted">This keeps the original invoice and adds a separate <b>reversal record</b> of ${m.fmtMoney(sale.total)} so sales, profit and KG totals are corrected. Nothing is deleted.</p>
        <div class="lbl">Reason</div><input class="inp" id="cReason" maxlength="120" placeholder="e.g. Customer returned goods">
        <div class="lbl mt">Refunded via</div><div class="chips" id="cPay">${B().PAYMENTS.map((p) => `<button class="chip ${p === sale.payment ? 'on' : ''}" data-p="${p}">${p}</button>`).join('')}</div>
        <button class="btn danger block mt" id="cGo">Confirm cancellation</button>`,
      onMount(r, close) {
        let pay = sale.payment;
        r.querySelector('#cPay').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; pay = b.dataset.p; r.querySelectorAll('#cPay .chip').forEach((x) => x.classList.toggle('on', x === b)); });
        r.querySelector('#cGo').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try { const rev = await DB.cancelSale(sale.id, r.querySelector('#cReason').value.trim(), pay); close(); App.toast('Invoice cancelled – reversal ' + rev.invoiceNo + ' recorded', 'ok'); App.afterSave(); view(el, id); }
          catch (err) { App.toast(err.message, 'err'); e.target.disabled = false; }
        });
      },
    });
  }

  const api = { assemblePdf, Doc, invoicePdf, downloadPdf, share, whatsapp, summaryText, paperHtml, view, fmtDT, print, pdfFile };
  root.Invoice = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
