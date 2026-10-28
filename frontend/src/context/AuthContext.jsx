import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { restoreSession, setAccessToken, clearAccessToken } from '../api/client';

const AuthContext = createContext(null);

function readCachedUser() {
  try { return JSON.parse(localStorage.getItem('soac_user') || 'null'); } catch (_) { return null; }
}

/* soac_user is only a display hint (name / role for the first paint) — not a
   credential. The access token itself is kept in memory by the API client. */
const forgetCachedUser = () => { try { localStorage.removeItem('soac_user'); } catch { /* storage blocked */ } };

export const AuthProvider = ({ children }) => {
  // Lazy initializers run once on mount — no localStorage reads on re-renders.
  const [user,    setUser]    = useState(() => readCachedUser());
  /* Someone was signed in on this device: hold protected pages until the
     session is restored from the refresh cookie (one quick request) */
  const [loading, setLoading] = useState(() => !!readCachedUser());

  /* Restore the session on app load */
  useEffect(() => {
    if (!readCachedUser()) { setLoading(false); return; }
    restoreSession()
      .then(() => api.get('/auth/me'))
      .then(({ user }) => {
        setUser(user);
        localStorage.setItem('soac_user', JSON.stringify(user));
      })
      .catch(() => {
        clearAccessToken();
        forgetCachedUser();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  /* Listen for silent session-expiry from the API client */
  useEffect(() => {
    const handler = () => { forgetCachedUser(); setUser(null); };
    window.addEventListener('soac:session-expired', handler);
    return () => window.removeEventListener('soac:session-expired', handler);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    localStorage.setItem('soac_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  /* One login, two profiles: switch between the student (member) dashboard and
     the Student Coordinator / Faculty Advisor dashboard (user.switchTo). Then a
     full page load into that dashboard, so it starts with a clean state. */
  const switchProfile = useCallback(async () => {
    const data = await api.post('/auth/switch-profile', {});
    setAccessToken(data.accessToken);
    localStorage.setItem('soac_user', JSON.stringify(data.user));
    setUser(data.user);
    window.location.replace(data.user.role === 'student' ? '/student' : '/coordinator');
    return data.user;
  }, []);

  /* Deliberate: logout does NOT revoke the device's push subscription. Once a
     device has an account logged in and notifications enabled, it keeps
     receiving that account's pushes regardless of login state afterward —
     only uninstalling the app or revoking OS-level notification permission
     stops it. (Confirmed product choice — the alternative, revoking on
     logout, protects shared/borrowed devices but was explicitly not wanted.) */
  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch (_) {}
    clearAccessToken();
    forgetCachedUser();
    setUser(null);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser(prev => prev ? { ...prev, ...patch } : prev);
  }, []);

  /* Re-fetch /auth/me from the server and replace in-memory state */
  const refreshUser = useCallback(async () => {
    try {
      const { user } = await api.get('/auth/me');
      setUser(user);
      localStorage.setItem('soac_user', JSON.stringify(user));
    } catch (_) {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, refreshUser, switchProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
