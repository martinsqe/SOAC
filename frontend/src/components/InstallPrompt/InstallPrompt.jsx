import { useEffect, useState } from 'react';
import s from './InstallPrompt.module.css';

const DISMISS_KEY = 'soac_install_dismissed_at';
const INSTALLED_KEY = 'soac_install_completed';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // re-offer a week after a dismissal, never after a real install

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIos = () => {
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !window.MSStream;
};

const withinCooldown = () => {
  const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return at && Date.now() - at < COOLDOWN_MS;
};

/* Global install banner — mounted once for the whole app so every visitor,
   guest or logged in, gets offered the install on any page they land on
   (not just after logging in). Chrome/Edge/Android stopped showing their
   own install UI automatically years ago; without this, a real user only
   ever sees a small, easy-to-miss icon in the address bar. iOS Safari never
   fires the browser's install event at all, so it gets its own instructional
   banner ("Tap Share, then Add to Home Screen") since there's no
   programmatic way to trigger that install on iOS. */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(INSTALLED_KEY) === '1') return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      if (withinCooldown()) return;
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, '1');
      setDeferredPrompt(null);
      setShowIosHint(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    /* iOS has no install event to wait for — decide immediately. A short
       delay so it doesn't compete with the very first paint of the page. */
    let t;
    if (isIos() && !withinCooldown()) {
      t = setTimeout(() => setShowIosHint(true), 2500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome !== 'accepted') dismiss();
    // 'accepted' resolves via the appinstalled listener above, which also
    // marks INSTALLED_KEY so the banner never reappears for this browser.
  };

  const visible = !dismissed && (deferredPrompt || showIosHint);
  if (!visible) return null;

  return (
    <div className={s.banner} role="dialog" aria-label="Install SOAC RKU app">
      <img src="/images/icon-192.png" alt="" className={s.icon} />
      <div className={s.text}>
        <div className={s.title}>Install the SOAC RKU app</div>
        <div className={s.sub}>
          {deferredPrompt
            ? 'Faster access, offline support, and push notifications.'
            : 'Tap Share, then "Add to Home Screen" to install.'}
        </div>
      </div>
      {deferredPrompt ? (
        <button className={s.installBtn} onClick={install}>Install</button>
      ) : (
        <button className={s.installBtn} onClick={dismiss}>Got it</button>
      )}
      <button className={s.closeBtn} onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
