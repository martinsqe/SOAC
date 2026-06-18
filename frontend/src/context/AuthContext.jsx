import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

function readCachedUser() {
  try { return JSON.parse(localStorage.getItem('soac_user') || 'null'); } catch (_) { return null; }
}

export const AuthProvider = ({ children }) => {
  // Lazy initializers run once on mount — no localStorage reads on re-renders.
  const [user,    setUser]    = useState(() => {
    if (!localStorage.getItem('soac_token')) return null;
    return readCachedUser(); // null if not cached yet
  });
  const [loading, setLoading] = useState(() => {
    const hasToken = !!localStorage.getItem('soac_token');
    // Only block rendering if we have a token but no cached user to show immediately.
    return hasToken && !readCachedUser();
  });

  /* Verify stored token on app load (runs in background if cached user was used) */
  useEffect(() => {
    const token = localStorage.getItem('soac_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(({ user }) => {
        setUser(user);
        localStorage.setItem('soac_user', JSON.stringify(user));
      })
      .catch(() => {
        localStorage.removeItem('soac_token');
        localStorage.removeItem('soac_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  /* Listen for silent session-expiry from the API client */
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('soac:session-expired', handler);
    return () => window.removeEventListener('soac:session-expired', handler);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    localStorage.setItem('soac_token', data.accessToken);
    localStorage.setItem('soac_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch (_) {}
    localStorage.removeItem('soac_token');
    localStorage.removeItem('soac_user');
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
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
