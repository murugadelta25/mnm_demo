import { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/client';

const AuthCtx = createContext(null);

function persistUser(data) {
  const user = {
    id: data.id,
    username: data.username,
    role: data.role,
    mustChangePassword: Boolean(data.must_change_password),
  };
  localStorage.setItem('token', data.access_token);
  localStorage.setItem('user', JSON.stringify(user));
  return user;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  });

  const login = async (username, password) => {
    const form = new URLSearchParams({ username, password });
    const { data } = await api.post('/api/auth/login', form);
    const next = persistUser(data);
    setUser(next);
    return data;
  };

  const clearMustChangePassword = useCallback(() => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, mustChangePassword: false };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = () => {
    localStorage.clear();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, login, logout, clearMustChangePassword }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
