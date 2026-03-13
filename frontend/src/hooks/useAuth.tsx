import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authLogin, authLogout, authStatus } from '../lib/api';

export type UserRole = 'admin' | 'user';

interface AuthContextValue {
  loggedIn: boolean | null; // null = loading
  role: UserRole;
  isAdmin: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  loggedIn: null,
  role: 'user',
  isAdmin: false,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [role, setRole] = useState<UserRole>('user');

  useEffect(() => {
    authStatus()
      .then((data) => {
        setLoggedIn(data.logged_in);
        setRole((data as { role?: string }).role === 'admin' ? 'admin' : 'user');
      })
      .catch(() => setLoggedIn(false));
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await authLogin(password);
    setLoggedIn(true);
    setRole((result as { role?: string }).role === 'admin' ? 'admin' : 'user');
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setLoggedIn(false);
    setRole('user');
  }, []);

  return (
    <AuthContext.Provider value={{ loggedIn, role, isAdmin: role === 'admin', login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
