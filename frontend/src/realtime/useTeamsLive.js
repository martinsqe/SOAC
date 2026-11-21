import { useEffect, useRef } from 'react';
import { getSocket } from './socket';

/* Keeps a view of teams current: calls onChange whenever an activity's teams
   change anywhere — the Galore portal, the admin's or a club's Teams tab (the
   server's "galore:teams:changed"), another part of this page (the window
   event below), or when the tab comes back into view. Bursts are merged.
     ids  the activity ids this view shows (array / Set), or null for any */
export const TEAMS_CHANGED = 'galore:teams-changed';
export const announceTeamsChanged = (activityId) =>
  window.dispatchEvent(new CustomEvent(TEAMS_CHANGED, { detail: { activityId: String(activityId) } }));

export default function useTeamsLive(ids, onChange) {
  const cb = useRef(onChange);
  useEffect(() => { cb.current = onChange; });
  const key = ids == null ? '*' : [...ids].map(String).sort().join(',');

  useEffect(() => {
    const want = key === '*' ? null : new Set(key ? key.split(',') : []);
    let t = null;
    const fire = () => { clearTimeout(t); t = setTimeout(() => cb.current?.(), 250); };
    const onSignal = (p) => { const id = String(p?.activityId ?? p?.detail?.activityId ?? ''); if (!want || !id || want.has(id)) fire(); };
    const onVisible = () => { if (document.visibilityState === 'visible') fire(); };
    const socket = getSocket();
    socket.on('galore:teams:changed', onSignal);
    window.addEventListener(TEAMS_CHANGED, onSignal);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      socket.off('galore:teams:changed', onSignal);
      window.removeEventListener(TEAMS_CHANGED, onSignal);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);
}
