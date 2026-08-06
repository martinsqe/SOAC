const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

/* firebase-admin v14+ is fully modular (no more monolithic admin.credential.cert()
   / admin.messaging() namespace) — same shift the client SDK made a few major
   versions ago. FIREBASE_SERVICE_ACCOUNT holds the full service-account JSON
   (Project Settings → Service Accounts → Generate new private key),
   base64-encoded to survive Railway's env var UI cleanly (the raw JSON's
   private_key field contains literal newlines that are easy to mangle when
   pasted directly). Push simply stays inert if it's unset — same
   degrade-gracefully pattern used by email.js when no provider is configured. */
let app = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(json);
    app = initializeApp({ credential: cert(serviceAccount) });
    console.log('🔔 Firebase Admin: enabled');
  } catch (err) {
    console.error('🔔 Firebase Admin: failed to initialize —', err.message);
  }
} else {
  console.log('🔔 Firebase Admin: disabled (FIREBASE_SERVICE_ACCOUNT not set)');
}

const messaging = app ? getMessaging(app) : null;

module.exports = { messaging, FIREBASE_ENABLED: !!app };
