/* database.js – IndexedDB persistence layer (offline-first).
 * Stores: categories, customers, sales, settings, meta
 * All money is stored as integer paise, all weights as integer grams. */
'use strict';
(function (root) {
  const DB_NAME = 'clothing-manager';
  const DB_VERSION = 1;
  const STORES = ['categories', 'customers', 'sales', 'settings', 'meta'];
  let dbp = null;
  const listeners = [];

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        const old = e.oldVersion;
        if (old < 1) {
          db.createObjectStore('categories', { keyPath: 'id' });
          db.createObjectStore('customers', { keyPath: 'id' });
          const s = db.createObjectStore('sales', { keyPath: 'id' });
          s.createIndex('day', 'day');
          s.createIndex('invoiceNo', 'invoiceNo', { unique: true });
          s.createIndex('customerId', 'customerId');
          db.createObjectStore('settings', { keyPath: 'key' });
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        // Future migrations: if (old < 2) { ... }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
    });
    return dbp;
  }

  const p = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transaction aborted')); });

  function uid() {
    if (root.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); (root.crypto || require('crypto').webcrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function notify(store) { listeners.forEach((f) => { try { f(store); } catch (e) { console.error(e); } }); }
  function onChange(fn) { listeners.push(fn); }

  async function getAll(store) { const db = await open(); return p(db.transaction(store).objectStore(store).getAll()); }
  async function get(store, key) { const db = await open(); return p(db.transaction(store).objectStore(store).get(key)); }
  async function getByIndex(store, index, key) { const db = await open(); return p(db.transaction(store).objectStore(store).index(index).getAll(key)); }
  async function getRange(store, index, lo, hi) {
    const db = await open();
    return p(db.transaction(store).objectStore(store).index(index).getAll(IDBKeyRange.bound(lo, hi)));
  }

  /** Save a record. Stamps updatedAt (unless opts.keepStamp, used by sync/import). */
  async function put(store, rec, opts = {}) {
    if (!opts.keepStamp && (store === 'categories' || store === 'customers' || store === 'sales')) {
      rec.updatedAt = Date.now();
    }
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(rec);
    await done(tx);
    if (!opts.silent) notify(store);
    return rec;
  }
  async function putMany(store, recs, opts = {}) {
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    recs.forEach((r) => os.put(r));
    await done(tx);
    if (!opts.silent) notify(store);
  }
  async function del(store, key) {
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx); notify(store);
  }
  async function clear(store) {
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await done(tx); notify(store);
  }

  // ---- settings (key/value) ----
  const DEFAULT_SETTINGS = {
    shopName: 'My Cloth Shop', shopAddress: '', shopPhone: '', currency: 'INR',
    invoicePrefix: 'INV-', invoicePad: 5, defaultPayment: 'Cash', theme: 'dark',
    invoiceFooter: 'Thank you for shopping with us!', autoSync: true,
  };
  async function getSettings() {
    const rows = await getAll('settings');
    const s = Object.assign({}, DEFAULT_SETTINGS);
    rows.forEach((r) => { s[r.key] = r.value; });
    return s;
  }
  async function setSetting(key, value) { return put('settings', { key, value }, { keepStamp: true }); }
  async function setSettings(obj) {
    await putMany('settings', Object.keys(obj).map((k) => ({ key: k, value: obj[k] })));
  }

  // ---- invoice counter ----
  async function peekNextInvoiceNumber() {
    const m = await get('meta', 'invoiceCounter');
    return m ? m.value : 1;
  }
  async function setNextInvoiceNumber(n) { return put('meta', { key: 'invoiceCounter', value: n }, { keepStamp: true }); }

  /**
   * Atomically save a new sale: allocates the invoice number and inserts the record in ONE transaction.
   * Uses add() so the same sale id can never be stored twice (duplicate-submission protection).
   */
  async function saveNewSale(sale, settings) {
    const db = await open();
    const tx = db.transaction(['sales', 'meta'], 'readwrite');
    const sales = tx.objectStore('sales');
    const meta = tx.objectStore('meta');
    const existing = await p(sales.get(sale.id));
    if (existing) { tx.abort(); const err = new Error('DUPLICATE'); err.code = 'DUPLICATE'; err.sale = existing; throw err; }
    const counter = await p(meta.get('invoiceCounter'));
    let n = counter ? counter.value : 1;
    const pad = Math.max(1, settings.invoicePad || 5);
    // find a free invoice number (guards against manual counter edits / imports)
    for (let guard = 0; guard < 100000; guard++) {
      const no = `${settings.invoicePrefix || ''}${String(n).padStart(pad, '0')}`;
      const clash = await p(sales.index('invoiceNo').get(no));
      if (!clash) { sale.invoiceNo = no; break; }
      n++;
    }
    sale.updatedAt = Date.now();
    sales.add(sale);
    meta.put({ key: 'invoiceCounter', value: n + 1 });
    await done(tx);
    notify('sales');
    return sale;
  }

  /** Cancel a sale: marks original cancelled and writes a separate negative reversal record (atomic). */
  async function cancelSale(saleId, reason, refundMethod) {
    const db = await open();
    const tx = db.transaction('sales', 'readwrite');
    const os = tx.objectStore('sales');
    const orig = await p(os.get(saleId));
    if (!orig || orig.kind !== 'sale') { tx.abort(); throw new Error('Sale not found'); }
    if (orig.status === 'cancelled') { tx.abort(); throw new Error('This invoice is already cancelled'); }
    const now = new Date();
    const rev = {
      id: uid(), kind: 'reversal', refId: orig.id, invoiceNo: orig.invoiceNo + '-R', status: 'completed',
      createdAt: now.toISOString(), day: localDay(now),
      customerId: orig.customerId, customerName: orig.customerName, customerPhone: orig.customerPhone,
      payment: refundMethod || orig.payment, reason: reason || '',
      items: orig.items.map((i) => Object.assign({}, i, { grams: -i.grams, revenue: -i.revenue, cost: -i.cost, profit: -i.profit })),
      totalGrams: -orig.totalGrams, subtotal: -orig.subtotal, discount: -orig.discount, extra: -orig.extra,
      total: -orig.total, cost: -orig.cost, profit: -orig.profit, updatedAt: Date.now(),
    };
    orig.status = 'cancelled'; orig.reversalId = rev.id; orig.cancelReason = reason || ''; orig.updatedAt = Date.now();
    os.put(orig); os.add(rev);
    await done(tx); notify('sales');
    return rev;
  }

  function localDay(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  async function exportAll() {
    const out = {};
    for (const s of STORES) out[s] = await getAll(s);
    return out;
  }

  // ---- seeding of default categories on first launch ----
  async function seedIfEmpty() {
    const seeded = await get('meta', 'seeded');
    if (seeded) return;
    const cats = await getAll('categories');
    if (!cats.length) {
      const defaults = [['Cotton', 220, 300], ['Jeans', 350, 450], ['Polyester', 150, 210], ['Shirts', 260, 340],
        ['T-shirts', 200, 270], ['Mixed Clothes', 120, 180], ['Other', 100, 150]];
      await putMany('categories', defaults.map(([name, b, s]) => ({
        id: uid(), name, buyPerKg: b * 100, sellPerKg: s * 100, deleted: false, createdAt: new Date().toISOString(), updatedAt: Date.now(), syncedAt: 0,
      })), { silent: true });
    }
    await put('meta', { key: 'seeded', value: true }, { keepStamp: true, silent: true });
  }

  async function requestPersistence() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ }
    return false;
  }

  const api = { open, uid, getAll, get, getByIndex, getRange, put, putMany, del, clear, onChange, notify, getSettings, setSetting, setSettings,
    DEFAULT_SETTINGS, peekNextInvoiceNumber, setNextInvoiceNumber, saveNewSale, cancelSale, localDay, exportAll, seedIfEmpty, requestPersistence,
    STORES, DB_VERSION };
  root.DB = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
