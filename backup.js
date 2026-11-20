/* backup.js – JSON backup/restore, downloads, and a dependency-free .xlsx writer (ZIP "store" + SpreadsheetML). */
'use strict';
(function (root) {
  // ---------------- CRC32 + ZIP ----------------
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  const enc = new TextEncoder();

  function zip(files) { // files: [{name, data:Uint8Array|string}]
    const parts = []; const central = []; let offset = 0;
    const d = new Date(); const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach((f) => {
      const name = enc.encode(f.name); const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data; const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return concat([...parts, ...central, new Uint8Array(end.buffer)]);
  }
  function concat(arrs) { const n = arrs.reduce((a, b) => a + b.length, 0); const out = new Uint8Array(n); let o = 0; arrs.forEach((a) => { out.set(a, o); o += a.length; }); return out; }

  // ---------------- XLSX ----------------
  const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const STYLE = { head: 1, money: 2, kg: 3, bold: 4, title: 5 };

  /** sheets: [{name, rows:[[cell,...]]}] where cell = string | number | {v, s:'money'|'kg'|'bold'|'head'|'title'} */
  function buildXlsx(sheets) {
    const used = new Set();
    const safe = sheets.map((sh, i) => {
      let n = String(sh.name || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1);
      let base = n, k = 2; while (used.has(n.toLowerCase())) n = base.slice(0, 28) + ' ' + k++;
      used.add(n.toLowerCase()); return Object.assign({}, sh, { name: n });
    });
    const sheetXml = safe.map((sh) => {
      const widths = [];
      const rowsXml = sh.rows.map((row, r) => {
        const cells = row.map((cell, c) => {
          if (cell === null || cell === undefined || cell === '') return '';
          const v = typeof cell === 'object' ? cell.v : cell; const st = typeof cell === 'object' && cell.s ? STYLE[cell.s] : 0;
          const ref = colName(c) + (r + 1);
          const len = String(typeof v === 'number' ? v.toFixed(2) : v).length; widths[c] = Math.max(widths[c] || 8, Math.min(48, len + 2));
          const sAttr = st ? ` s="${st}"` : '';
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
          return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
        }).join('');
        return `<row r="${r + 1}">${cells}</row>`;
      }).join('');
      const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w || 8}" customWidth="1"/>`).join('')}</cols>` : '';
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rowsXml}</sheetData></worksheet>`;
    });
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.000"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F1B33"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: styles },
      ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
    ];
    return zip(files);
  }

  // ---------------- downloads ----------------
  function download(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  function downloadXlsx(filename, sheets) { download(filename, new Blob([buildXlsx(sheets)], { type: XLSX_MIME }), XLSX_MIME); }

  /** One row per sold item line (all sales + reversals given). */
  function salesSheet(sales) {
    const B = root.Billing;
    const rows = [[{ v: 'Invoice', s: 'head' }, { v: 'Date', s: 'head' }, { v: 'Time', s: 'head' }, { v: 'Type', s: 'head' }, { v: 'Status', s: 'head' }, { v: 'Customer', s: 'head' }, { v: 'Phone', s: 'head' }, { v: 'Payment', s: 'head' },
      { v: 'Category', s: 'head' }, { v: 'Weight (KG)', s: 'head' }, { v: 'Price/KG', s: 'head' }, { v: 'Purchase/KG', s: 'head' }, { v: 'Item Revenue', s: 'head' }, { v: 'Item Cost', s: 'head' }, { v: 'Item Profit', s: 'head' },
      { v: 'Bill Discount', s: 'head' }, { v: 'Extra', s: 'head' }, { v: 'Bill Total', s: 'head' }, { v: 'Bill Profit', s: 'head' }]];
    sales.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((s) => {
      const dt = new Date(s.createdAt);
      s.items.forEach((i, idx) => rows.push([s.invoiceNo, s.day, dt.toLocaleTimeString('en-IN'), s.kind === 'sale' ? 'Sale' : 'Refund/Reversal', s.status, s.customerName, s.customerPhone || '', s.payment, i.name,
        { v: B.kgNum(i.grams), s: 'kg' }, { v: B.moneyNum(i.sellPerKg), s: 'money' }, { v: B.moneyNum(i.buyPerKg), s: 'money' }, { v: B.moneyNum(i.revenue), s: 'money' }, { v: B.moneyNum(i.cost), s: 'money' }, { v: B.moneyNum(i.profit), s: 'money' },
        idx === 0 ? { v: B.moneyNum(s.discount), s: 'money' } : '', idx === 0 ? { v: B.moneyNum(s.extra), s: 'money' } : '', idx === 0 ? { v: B.moneyNum(s.total), s: 'money' } : '', idx === 0 ? { v: B.moneyNum(s.profit), s: 'money' } : '']));
    });
    return { name: 'Sales', rows };
  }
  function toCsv(rows) {
    return rows.map((r) => r.map((c) => { const v = c && typeof c === 'object' ? c.v : c; const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  }

  // ---------------- JSON backup / restore ----------------
  const LOCAL_ONLY_SETTINGS = ['pinHash', 'pinSalt', 'firebaseConfig', 'cloudLastPull', 'cloudEmail', 'lastBackupAt'];
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  async function buildBackup() {
    const all = await DB.exportAll();
    all.settings = all.settings.filter((s) => !LOCAL_ONLY_SETTINGS.includes(s.key));
    return { app: 'clothing-manager', schema: DB.DB_VERSION, exportedAt: new Date().toISOString(), counts: { categories: all.categories.length, customers: all.customers.length, sales: all.sales.length }, data: all };
  }
  async function exportJSON() {
    const b = await buildBackup();
    download(`clothing-manager-backup-${stamp()}.json`, JSON.stringify(b), 'application/json');
    await DB.setSetting('lastBackupAt', new Date().toISOString());
    return b.counts;
  }

  /** Parse + validate. Returns {data, skipped:[...]} or throws Error with a readable message. */
  function parseBackup(text) {
    let obj; try { obj = JSON.parse(text); } catch (e) { throw new Error('This file is not valid JSON'); }
    if (!obj || obj.app !== 'clothing-manager' || !obj.data) throw new Error('This is not a Clothing Manager backup file');
    if (obj.schema > DB.DB_VERSION) throw new Error('Backup was made by a newer version of the app. Please update the app first.');
    const d = obj.data; const skipped = [];
    ['categories', 'customers', 'sales', 'settings'].forEach((k) => { if (!Array.isArray(d[k])) throw new Error(`Backup is missing "${k}"`); });
    d.categories = d.categories.filter((c) => { const ok = c && c.id && typeof c.name === 'string' && Number.isInteger(c.buyPerKg) && Number.isInteger(c.sellPerKg); if (!ok) skipped.push('category'); return ok; });
    d.customers = d.customers.filter((c) => { const ok = c && c.id && typeof c.name === 'string'; if (!ok) skipped.push('customer'); return ok; });
    d.sales = d.sales.filter((s) => { const e = root.Billing.validateSale(s); if (e.length) skipped.push(`sale ${s && s.invoiceNo}: ${e[0]}`); return !e.length; });
    d.settings = d.settings.filter((s) => s && typeof s.key === 'string' && !LOCAL_ONLY_SETTINGS.includes(s.key));
    d.meta = (d.meta || []).filter((m) => m && m.key === 'invoiceCounter' && Number.isInteger(m.value));
    return { data: d, skipped, exportedAt: obj.exportedAt };
  }

  /** mode 'replace' wipes local data first (a safety copy is downloaded by the UI); mode 'merge' keeps the newer record per id. */
  async function restore(parsed, mode) {
    const d = parsed.data; const res = { added: 0, updated: 0, kept: 0, skippedInvoiceClash: 0 };
    const reset = (r) => Object.assign(r, { syncedAt: 0 });
    if (mode === 'replace') {
      await DB.clear('categories'); await DB.clear('customers'); await DB.clear('sales');
      const keep = (await DB.getAll('settings')).filter((s) => LOCAL_ONLY_SETTINGS.includes(s.key));
      await DB.clear('settings'); await DB.putMany('settings', [...d.settings, ...keep]);
      await DB.putMany('categories', d.categories.map(reset), { silent: true }); await DB.putMany('customers', d.customers.map(reset), { silent: true });
      await DB.putMany('sales', d.sales.map(reset), { silent: true });
      const ctr = d.meta.find((m) => m.key === 'invoiceCounter');
      const maxNo = Math.max(0, ...d.sales.map((s) => parseInt(String(s.invoiceNo).replace(/\D+/g, '').replace(/^$/, '0'), 10) || 0));
      await DB.setNextInvoiceNumber(Math.max(ctr ? ctr.value : 1, maxNo + 1));
      res.added = d.sales.length;
    } else {
      for (const store of ['categories', 'customers', 'sales']) {
        const local = new Map((await DB.getAll(store)).map((r) => [r.id, r]));
        const invs = new Map(store === 'sales' ? [...local.values()].map((s) => [s.invoiceNo, s.id]) : []);
        const toWrite = [];
        d[store].forEach((r) => {
          const l = local.get(r.id);
          if (!l) { if (store === 'sales' && invs.has(r.invoiceNo)) { res.skippedInvoiceClash++; return; } toWrite.push(reset(r)); res.added++; }
          else if ((r.updatedAt || 0) > (l.updatedAt || 0)) { toWrite.push(reset(r)); res.updated++; }
          else res.kept++;
        });
        await DB.putMany(store, toWrite, { silent: true });
      }
      const cur = await DB.peekNextInvoiceNumber(); const ctr = d.meta.find((m) => m.key === 'invoiceCounter');
      if (ctr && ctr.value > cur) await DB.setNextInvoiceNumber(ctr.value);
    }
    ['categories', 'customers', 'sales', 'settings'].forEach((s) => DB.notify(s));
    return res;
  }

  const api = { crc32, zip, buildXlsx, download, downloadXlsx, salesSheet, toCsv, XLSX_MIME, buildBackup, exportJSON, parseBackup, restore, LOCAL_ONLY_SETTINGS, stamp, XLSX_STYLE: STYLE };
  root.Backup = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
