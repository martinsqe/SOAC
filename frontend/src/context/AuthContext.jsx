import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true); // true while verifying token on mount

  /* Verify stored token on app load */
  useEffect(() => {
    const token = localStorage.getItem('soac_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => localStorage.removeItem('soac_token'))
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
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch (_) {}
    localStorage.removeItem('soac_token');
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
    } catch (_) {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
