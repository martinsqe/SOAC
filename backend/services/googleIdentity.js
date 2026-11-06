const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

/* Verifies the Google sign-in done in the Join Club modal (Firebase Auth's
   "Continue with Google"). Verifying an ID token only needs the project id —
   firebase-admin checks Google's public signing keys — so this works even
   when the push-notification service account isn't configured. Uses its own
   named app so it never clashes with services/firebaseAdmin.js. */
const PROJECT_ID = process.env.FIREBASE_AUTH_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'soac-493719';
const APP_NAME   = 'google-identity';

const authClient = () => {
  const app = getApps().find(a => a.name === APP_NAME) || initializeApp({ projectId: PROJECT_ID }, APP_NAME);
  return getAuth(app);
};

/* → { email, name } of the verified Google account, or throws with a message
   fit to show the student. Only verified @rku.ac.in accounts pass. */
const verifyRkuGoogleToken = async (idToken) => {
  let decoded;
  try {
    decoded = await authClient().verifyIdToken(String(idToken || ''));
  } catch (err) {
    throw new Error(err?.code === 'auth/id-token-expired'
      ? 'Your Google sign-in has expired. Please continue with Google again.'
      : 'We could not verify your Google sign-in. Please continue with Google again.');
  }
  const email = String(decoded.email || '').trim().toLowerCase();
  if (!email || decoded.email_verified === false) {
    throw new Error('We could not verify the email on your Google account.');
  }
  if (!email.endsWith('@rku.ac.in')) {
    throw new Error('Only RKU institutional Google accounts (@rku.ac.in) can join clubs.');
  }
  return { email, name: String(decoded.name || '').trim() };
};

module.exports = { verifyRkuGoogleToken };
