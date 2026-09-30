import { useEffect, useState } from 'react';

/* Whether students can currently send club join requests (admin can close them
   until a chosen date — see Admin → Approvals). Students can always open and fill
   the join form; while closed, sending it shows "You can send requests from <date> onwards."
   (from the server). One shared fetch per page load;
   refreshJoinStatus() re-reads it after the admin changes it. */
let pending = null;
const listeners = new Set();
let current = { open: true, opensOn: null, loaded: false };

const load = () => {
  pending = fetch('/api/requests/join-status')
    .then(r => (r.ok ? r.json() : { open: true, opensOn: null }))
    .catch(() => ({ open: true, opensOn: null }))   // never lock students out on a network blip — the server still enforces it
    .then(d => {
      current = { open: d.open !== false, opensOn: d.opensOn || null, loaded: true };
      listeners.forEach(fn => fn(current));
      return current;
    });
  return pending;
};

export const refreshJoinStatus = () => load();

export const formatOpensOn = (ymd) => (ymd
  ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  : '');

export function useJoinStatus() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (!pending) load(); else if (current.loaded) setState(current);
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}
