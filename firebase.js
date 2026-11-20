/* firebase.js – OPTIONAL cloud backup & sync (Firebase Auth + Firestore).
 * The app is fully usable offline without this. The Firebase SDK is only downloaded after you paste YOUR config in
 * Settings > Cloud backup. No API keys are bundled. Data lives under users/{uid}/... (see README for security rules). */
'use strict';
(function (root) {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const COLS = ['categories', 'customers', 'sales'];
  const CONFIG_PLACEHOLDER = `{
  "apiKey": "YOUR_API_KEY",
  "authDomain": "YOUR_PROJECT.firebaseapp.com",
  "projectId": "YOUR_PROJECT_ID",
  "appId": "YOUR_APP_ID"
}`;
  const S = { sdk: null, app: null, auth: null, db: null, user: null, busy: false, error: null, lastSync: null, config: null, timer: null, lastResult: null };
  const subs = [];
  const emit = () => subs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  function onStatus(f) { subs.push(f); }

  function parseConfig(text) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('Paste the firebaseConfig object from the Firebase console');
    let s = text.slice(a, b + 1).replace(/\/\/.*$/gm, '').replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/,(\s*})/g, '$1');
    let c; try { c = JSON.parse(s); } catch (e) { throw new Error('Could not read the config. Paste it exactly as shown in Firebase.'); }
    ['apiKey', 'projectId', 'appId'].forEach((k) => { if (!c[k] || typeof c[k] !== 'string') throw new Error(`Config is missing "${k}"`); });
    if (Object.values(c).some((v) => /YOUR_/i.test(String(v)))) throw new Error('Replace the YOUR_… placeholders with your real Firebase values');
    return c;
  }

  async function loadSdk() {
    if (S.sdk) return S.sdk;
    if (!navigator.onLine) throw new Error('You are offline – connect to the internet to use cloud backup');
    const [app, auth, fs] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
    S.sdk = { app, auth, fs };
    return S.sdk;
  }
  async function connect() {
    const sdk = await loadSdk();
    if (!S.app) {
      S.app = sdk.app.initializeApp(S.config);
      S.auth = sdk.auth.getAuth(S.app); S.db = sdk.fs.getFirestore(S.app);
      sdk.auth.onAuthStateChanged(S.auth, (u) => { S.user = u; if (u) DB.setSetting('cloudEmail', u.email); emit(); if (u) schedule(500); });
    }
  }

  async function init() {
    const s = await DB.getSettings();
    if (s.firebaseConfig) { try { S.config = JSON.parse(s.firebaseConfig); } catch (e) { S.config = null; } }
    window.addEventListener('online', () => { emit(); schedule(1500); });
    window.addEventListener('offline', emit);
    DB.onChange((store) => { if (COLS.includes(store) && !S.busy) schedule(4000); });
    if (S.config && navigator.onLine) { connect().catch((e) => { S.error = e.message; emit(); }); }
    emit();
  }

  async function saveConfig(text) {
    const c = parseConfig(text); S.config = c; S.app = null; S.auth = null; S.db = null; S.user = null;
    await DB.setSetting('firebaseConfig', JSON.stringify(c)); await connect(); emit();
  }
  async function removeConfig() {
    try { if (S.auth) await S.sdk.auth.signOut(S.auth); } catch (e) { /* ignore */ }
    S.config = null; S.user = null; await DB.setSetting('firebaseConfig', ''); await DB.setSetting('cloudLastPull', {}); emit();
  }
  async function signIn(email, pw) { await connect(); await S.sdk.auth.signInWithEmailAndPassword(S.auth, email, pw); }
  async function signUp(email, pw) { await connect(); await S.sdk.auth.createUserWithEmailAndPassword(S.auth, email, pw); }
  async function signOut() { if (S.auth) await S.sdk.auth.signOut(S.auth); S.user = null; emit(); }
  async function resetPassword(email) { await connect(); await S.sdk.auth.sendPasswordResetEmail(S.auth, email); }

  // ---------------- sync ----------------
  const isDirty = (r) => (r.updatedAt || 0) > (r.syncedAt || 0);
  const clean = (o) => JSON.parse(JSON.stringify(o));
  async function countPending() { let n = 0; for (const c of COLS) n += (await DB.getAll(c)).filter(isDirty).length; return n; }

  function schedule(ms) {
    clearTimeout(S.timer);
    DB.getSettings().then((st) => { if (!st.autoSync || !S.config) return; S.timer = setTimeout(() => { if (S.user && navigator.onLine && !S.busy) sync().catch(() => {}); }, ms || 3000); });
  }

  async function applyRemote(col, r, res) {
    const l = await DB.get(col, r.id);
    if (col === 'sales') { const errs = Billing.validateSale(r); if (errs.length) { res.rejected++; return; } }
    if (!l) {
      if (col === 'sales') { const clash = (await DB.getByIndex('sales', 'invoiceNo', r.invoiceNo)).find((x) => x.id !== r.id); if (clash) { r.invoiceNo = `${r.invoiceNo}-D${r.id.slice(0, 4)}`; res.invoiceClashes++; } }
      r.syncedAt = r.updatedAt; await DB.put(col, r, { keepStamp: true, silent: true }); res.pulled++; return;
    }
    if (r.updatedAt > l.updatedAt) {
      if (isDirty(l)) { res.conflicts++; await DB.put('meta', { key: `conflict-${col}-${l.id}-${Date.now()}`, value: { col, local: l, at: new Date().toISOString() } }, { keepStamp: true, silent: true }); }
      r.syncedAt = r.updatedAt; await DB.put(col, r, { keepStamp: true, silent: true }); res.pulled++;
    } else if (r.updatedAt === l.updatedAt && l.syncedAt !== r.updatedAt) { l.syncedAt = r.updatedAt; await DB.put(col, l, { keepStamp: true, silent: true }); }
  }

  async function sync() {
    if (S.busy) return S.lastResult;
    if (!S.config) throw new Error('Cloud backup is not configured');
    if (!navigator.onLine) throw new Error('Offline – changes will sync when internet returns');
    await connect(); if (!S.user) throw new Error('Please sign in first');
    S.busy = true; S.error = null; emit();
    const res = { pulled: 0, pushed: 0, conflicts: 0, rejected: 0, invoiceClashes: 0 };
    try {
      const { fs } = S.sdk; const uid = S.user.uid;
      const settings = await DB.getSettings(); const lastPull = Object.assign({}, settings.cloudLastPull || {});
      // 1) PULL newer remote records first (never overwrite newer local data)
      for (const col of COLS) {
        const q = fs.query(fs.collection(S.db, 'users', uid, col), fs.where('updatedAt', '>=', lastPull[col] || 0), fs.orderBy('updatedAt'));
        const snap = await fs.getDocs(q); let max = lastPull[col] || 0;
        for (const d of snap.docs) { const r = d.data(); r.id = r.id || d.id; await applyRemote(col, r, res); if (r.updatedAt > max) max = r.updatedAt; }
        lastPull[col] = max;
      }
      // 2) PUSH local changes (doc id = record id => idempotent, no duplicate sales)
      for (const col of COLS) {
        const dirty = (await DB.getAll(col)).filter(isDirty);
        for (let i = 0; i < dirty.length; i += 400) {
          const part = dirty.slice(i, i + 400); const batch = fs.writeBatch(S.db);
          part.forEach((r) => { const o = clean(r); o.syncedAt = r.updatedAt; batch.set(fs.doc(S.db, 'users', uid, col, r.id), o); });
          await batch.commit();
          for (const r of part) { const cur = await DB.get(col, r.id); if (cur) { cur.syncedAt = Math.max(cur.syncedAt || 0, r.updatedAt); await DB.put(col, cur, { keepStamp: true, silent: true }); } }
          res.pushed += part.length;
        }
      }
      // 3) shop settings (last-writer-wins by timestamp)
      await syncSettings(uid, settings);
      await DB.setSetting('cloudLastPull', lastPull);
      S.lastSync = new Date(); await DB.setSetting('cloudLastSync', S.lastSync.toISOString());
      S.lastResult = res;
      if (res.pulled || res.conflicts) COLS.concat('settings').forEach((c) => DB.notify(c));
    } catch (e) {
      console.error('Sync failed', e); S.error = friendly(e); throw new Error(S.error);
    } finally { S.busy = false; emit(); }
    return res;
  }
  async function syncSettings(uid, settings) {
    const { fs } = S.sdk; const ref = fs.doc(S.db, 'users', uid, 'meta', 'settings'); const snap = await fs.getDoc(ref);
    const keys = ['shopName', 'shopAddress', 'shopPhone', 'invoicePrefix', 'invoicePad', 'defaultPayment', 'invoiceFooter'];
    const localAt = settings.settingsUpdatedAt || 0;
    if (snap.exists() && (snap.data().updatedAt || 0) > localAt) { const r = snap.data(); await DB.setSettings(Object.assign({}, ...keys.filter((k) => r.values && k in r.values).map((k) => ({ [k]: r.values[k] })), { settingsUpdatedAt: r.updatedAt })); }
    else if (localAt && (!snap.exists() || localAt > (snap.data().updatedAt || 0))) await fs.setDoc(ref, { updatedAt: localAt, values: clean(Object.fromEntries(keys.map((k) => [k, settings[k]]))) });
  }
  function friendly(e) {
    const c = e.code || '';
    if (c.includes('permission-denied')) return 'Permission denied – check your Firestore security rules (see README)';
    if (c.includes('unavailable') || c.includes('network')) return 'Network problem – will retry when online';
    if (c.includes('failed-precondition')) return 'Firestore database not created yet in your Firebase project';
    return e.message || 'Sync failed';
  }
  /** Pull everything from the cloud (e.g. new phone). Local newer records are kept. */
  async function restoreAll() { await DB.setSetting('cloudLastPull', {}); return sync(); }

  async function statusInfo() {
    if (!S.config) return { kind: 'off', label: 'Cloud backup not set up' };
    if (!navigator.onLine) return { kind: 'warn', label: 'Offline – will sync later' };
    if (!S.user) return { kind: 'warn', label: 'Not signed in' };
    if (S.busy) return { kind: 'info', label: 'Syncing…' };
    if (S.error) return { kind: 'err', label: 'Sync error: ' + S.error };
    const n = await countPending();
    if (n) return { kind: 'warn', label: `${n} change${n > 1 ? 's' : ''} waiting to sync` };
    return { kind: 'ok', label: S.lastSync ? 'Synced ' + S.lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Up to date' };
  }

  const api = { init, onStatus, parseConfig, saveConfig, removeConfig, signIn, signUp, signOut, resetPassword, sync, schedule, restoreAll, statusInfo, countPending, CONFIG_PLACEHOLDER, get state() { return S; } };
  root.Cloud = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
