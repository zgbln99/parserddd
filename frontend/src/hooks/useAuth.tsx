import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authLogin, authLogout, authStatus } from '../lib/api';

export type UserRole = 'admin' | 'dispatcher' | 'user' | 'driver';

interface AuthContextValue {
  loggedIn: boolean | null; // null = loading
  role: UserRole;
  isAdmin: boolean;
  isDispatcher: boolean;
  isDriver: boolean;
  permissions: string[];
  hasPermission: (perm: string) => boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  loggedIn: null,
  role: 'user',
  isAdmin: false,
  isDispatcher: false,
  isDriver: false,
  permissions: [],
  hasPermission: () => false,
  login: async () => {},
  logout: async () => {},
});

const VALID_ROLES: UserRole[] = ['admin', 'dispatcher', 'user', 'driver'];

function parseRole(role?: string): UserRole {
  if (role && VALID_ROLES.includes(role as UserRole)) return role as UserRole;
  return 'user';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [role, setRole] = useState<UserRole>('user');
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    authStatus()
      .then((data) => {
        setLoggedIn(data.logged_in);
        setRole(parseRole((data as any).role));
        setPermissions((data as any).permissions || []);
      })
      .catch(() => setLoggedIn(false));
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await authLogin(password);
    setLoggedIn(true);
    setRole(parseRole((result as any).role));
    setPermissions((result as any).permissions || []);
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setLoggedIn(false);
    setRole('user');
    setPermissions([]);
  }, []);

  const hasPermission = useCallback(
    (perm: string) => permissions.includes(perm),
    [permissions],
  );

  return (
    <AuthContext.Provider
      value={{
        loggedIn,
        role,
        isAdmin: role === 'admin',
        isDispatcher: role === 'dispatcher' || role === 'admin',
        isDriver: role === 'driver',
        permissions,
        hasPermission,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
