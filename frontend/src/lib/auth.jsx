import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

/**
 * Session state.
 *
 * There is no token in JavaScript to hold: the session lives in an HttpOnly
 * cookie the app cannot read. `user` here is only a cached copy of who the
 * server said we are, refreshed from /api/auth/me. Every request is
 * re-authorised server-side regardless of what this state claims.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/** Where each role lands after login. */
export const homeFor = (role) =>
  ({ student: '/student', guard: '/guard', admin: '/admin' })[role] ?? '/login';
