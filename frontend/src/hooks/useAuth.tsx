import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authLogin, authLogout, authStatus } from '../lib/api';

interface AuthContextValue {
  loggedIn: boolean | null; // null = loading
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  loggedIn: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    authStatus()
      .then((data) => setLoggedIn(data.logged_in))
      .catch(() => setLoggedIn(false));
  }, []);

  const login = useCallback(async (password: string) => {
    await authLogin(password);
    setLoggedIn(true);
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setLoggedIn(false);
  }, []);

  return (
    <AuthContext.Provider value={{ loggedIn, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
