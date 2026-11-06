import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { firebaseApp } from '../firebase';

/* Google sign-in can run on its own Firebase project (the one owned by
   soac.notifications@rku.ac.in), separate from the push-notification project in
   ../firebase.js. Set the VITE_GOOGLE_AUTH_* values in frontend/.env (from that
   project's Project settings → Your apps → Web app). Without them it falls back
   to the push-notification project. */
const AUTH_CONFIG = {
  apiKey:     import.meta.env.VITE_GOOGLE_AUTH_API_KEY,
  authDomain: import.meta.env.VITE_GOOGLE_AUTH_AUTH_DOMAIN,
  projectId:  import.meta.env.VITE_GOOGLE_AUTH_PROJECT_ID,
  appId:      import.meta.env.VITE_GOOGLE_AUTH_APP_ID,
};
const authApp = () => {
  if (!AUTH_CONFIG.apiKey || !AUTH_CONFIG.projectId) return firebaseApp;
  return getApps().find(a => a.name === 'google-auth') || initializeApp(AUTH_CONFIG, 'google-auth');
};

/* "Continue with Google" for the Join Club modal. Only @rku.ac.in Google
   accounts are accepted — the `hd` hint makes Google show RKU accounts first,
   and the address is checked here and again on the server (which verifies the
   ID token, so the email can't be typed in or faked). The Firebase session is
   ended straight away: we only need the one-off ID token, not a login. */
const RKU_DOMAIN = '@rku.ac.in';

const FRIENDLY = {
  'auth/popup-closed-by-user':   'Google sign-in was closed before it finished.',
  'auth/cancelled-popup-request': 'Google sign-in was closed before it finished.',
  'auth/popup-blocked':          'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/network-request-failed': 'No internet connection. Check your connection and try again.',
  'auth/unauthorized-domain':    'Google sign-in is not enabled for this website yet. Please contact the SOAC office.',
  'auth/operation-not-allowed':  'Google sign-in is not enabled yet. Please contact the SOAC office.',
  'auth/configuration-not-found': 'Google sign-in is not set up yet. Please contact the SOAC office.',
  'auth/invalid-api-key':        'Google sign-in is not set up correctly. Please contact the SOAC office.',
  'auth/internal-error':         'Google sign-in could not start. Please try again in a moment.',
  'auth/web-storage-unsupported': 'Your browser is blocking the storage Google sign-in needs. Turn off private mode or allow cookies and try again.',
};

export async function signInWithRkuGoogle() {
  const auth = getAuth(authApp());
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'rku.ac.in', prompt: 'select_account' });

  let result;
  try {
    result = await signInWithPopup(auth, provider);
  } catch (err) {
    /* the exact Firebase code, for whoever is checking the browser console */
    console.error('[google sign-in]', err?.code, err?.message);
    throw new Error(FRIENDLY[err?.code] || `Google sign-in failed (${err?.code || 'unknown error'}). Please try again.`);
  }

  const email = String(result.user.email || '').trim().toLowerCase();
  const name = String(result.user.displayName || '').trim();
  const idToken = await result.user.getIdToken();
  signOut(auth).catch(() => {});

  if (!email.endsWith(RKU_DOMAIN)) {
    throw new Error(`${email || 'That account'} is not an RKU account. Please continue with your @rku.ac.in Google account.`);
  }
  return { email, name, idToken };
}
