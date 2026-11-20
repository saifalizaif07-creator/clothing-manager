# Clothing Manager – Per KG Sale

Offline-first mobile PWA for cloth shops that sell by weight. Plain HTML/CSS/JavaScript, IndexedDB storage, optional Firebase backup. No build step, no paid API.

## Files
`index.html · style.css · app.js (shell, dashboard, history, customers, categories, settings, PIN) · database.js (IndexedDB) · billing.js (maths + New Sale) · reports.js (reports, charts) · invoice.js (invoice, PDF, share) · backup.js (JSON backup, .xlsx writer) · firebase.js (cloud sync) · manifest.json · service-worker.js · assets/icons/`

## Run / install
1. **Try locally:** in this folder run `python3 -m http.server 8080`, open `http://localhost:8080` (localhost counts as secure, so the service worker works).
2. **On phones you need HTTPS.** Service workers and normal PWA installation only work over HTTPS (or localhost). Upload the folder to any static HTTPS host: GitHub Pages, Netlify, Cloudflare Pages, Firebase Hosting (all have free tiers). Opening `index.html` via `file://` will not work offline/installable.
3. **Android (Chrome):** open the HTTPS URL → menu → *Install app* (or the Install button in the app). **iPhone (Safari):** Share → *Add to Home Screen*.
4. After the first load the app works with no internet. Update: bump `VERSION` in `service-worker.js` on each release; users see an "Update" bar.

## Firebase setup (optional)
1. https://console.firebase.google.com → *Add project*.
2. *Build → Authentication → Get started → Email/Password → Enable*.
3. *Build → Firestore Database → Create database* (production mode).
4. *Firestore → Rules*, paste and publish (each user can only touch their own data):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
5. *Project settings → Your apps → Web (</>)* → register → copy the `firebaseConfig` object.
6. In the app: *Settings → Cloud backup* → paste config → Save → *Create account* / *Sign in* → *Sync now*.
7. If your site is on a custom domain, add it under *Authentication → Settings → Authorized domains*.

How sync works: every record has a unique id (UUID) and `updatedAt`. Pull first, then push; the newest `updatedAt` wins, a local unsynced version that loses is kept in an internal conflict log; Firestore doc id = record id so a sale can never be uploaded twice. Changes made offline sync automatically when internet returns. The app works fully without Firebase.

## Money rules
Weights = integer grams, money = integer paise (no floating point). Item total = grams × price/KG ÷ 1000 (rounded to the paisa). **Grand total = subtotal − discount + extra. Profit = grand total − cost** (= gross profit − discount + extra charges). Purchase and selling prices are saved with every bill item, so changing a category price never changes old bills. Cancelling an invoice keeps it and adds a separate negative **reversal record** (`INV-xxxxx-R`); reports sum both, so totals stay correct. Nothing financial is ever deleted.

## Testing
- Unit tests (spec examples: Cotton ₹750/₹550/₹200, Jeans ₹562.50/₹437.50/₹125, combined 3.750 KG / ₹1,312.50 / ₹987.50 / ₹325, discounts, grams, validation, reversal netting, xlsx/pdf structure): `node tests/unit.test.js`
- Browser end-to-end (needs Playwright + Chrome; covers billing, guest, duplicate submit, reload persistence, offline sale via service worker, cancel/reversal, dashboard, PDF/Excel export, category price history, backup/restore, PIN): `python3 -m http.server 8765 &` then `node tests/e2e.js`
- **Not testable without your Firebase project:** cloud sign-in and sync. Test manually: sign in on two phones, create a sale offline on one, go online, tap *Sync now*, confirm it appears once on the other.

## Known limits
- PDFs are rendered from a canvas (image-based, supports ₹ and any language); text in them is not selectable.
- WhatsApp cannot receive a PDF from a link. "WhatsApp" opens a chat with the bill text; use **Share PDF** (phone share sheet) to attach the file.
- Client-side PIN is a privacy screen only: data is stored unencrypted in the browser. "Forgot PIN" removes the lock (data stays). Clearing browser data deletes local data, so export backups regularly or use Firebase.
- Firebase SDK is loaded from Google's CDN only when you configure it.
