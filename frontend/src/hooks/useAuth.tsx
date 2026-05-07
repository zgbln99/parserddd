import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { authLogin, authLogout, authStatus } from '../lib/api';

export type UserRole = 'admin' | 'dispatcher' | 'user' | 'driver';

// Client-side permission map — mirror of backend ROLE_PERMISSIONS
// Used as fallback when backend doesn't return permissions
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: [
    'dashboard', 'drivers', 'reader', 'analysis', 'compare', 'settlement',
    'vehicles', 'driver_km', 'toll', 'samsara_km', 'config', 'night_sim',
    'admin', 'sync', 'verstosse', 'export', 'ddd_preview',
  ],
  dispatcher: [
    'dashboard', 'drivers', 'reader', 'analysis', 'compare', 'settlement',
    'vehicles', 'driver_km', 'toll', 'samsara_km', 'verstosse', 'export',
    'ddd_preview', 'sync',
  ],
  user: [
    'dashboard', 'drivers', 'reader', 'analysis', 'sync', 'verstosse',
    'ddd_preview',
  ],
  driver: [
    'dashboard', 'reader', 'ddd_preview',
  ],
};

interface AuthContextValue {
  loggedIn: boolean | null; // null = loading
  role: UserRole;
  isAdmin: boolean;
  isDispatcher: boolean;
  isDriver: boolean;
  permissions: string[];
  hasPermission: (perm: string) => boolean;
  hiddenFeatures: string[];
  isFeatureVisible: (feature: string) => boolean;
  companyName: string;
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
  hiddenFeatures: [],
  isFeatureVisible: () => true,
  companyName: 'LTS Logistik GmbH',
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
  const [serverPermissions, setServerPermissions] = useState<string[]>([]);
  const [hiddenFeatures, setHiddenFeatures] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState('LTS Logistik GmbH');

  useEffect(() => {
    authStatus()
      .then((data) => {
        setLoggedIn(data.logged_in);
        setRole(parseRole((data as any).role));
        setServerPermissions((data as any).permissions || []);
        setHiddenFeatures((data as any).hidden_features || []);
        setCompanyName((data as any).company_name || 'LTS Logistik GmbH');
      })
      .catch(() => setLoggedIn(false));
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await authLogin(password);
    setLoggedIn(true);
    setRole(parseRole((result as any).role));
    setServerPermissions((result as any).permissions || []);
    setHiddenFeatures((result as any).hidden_features || []);
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setLoggedIn(false);
    setRole('user');
    setServerPermissions([]);
  }, []);

  // Merge: role-based defaults + any extra server permissions
  const permissions = useMemo(() => {
    const rolePerms = ROLE_PERMISSIONS[role] || [];
    const merged = new Set([...rolePerms, ...serverPermissions]);
    return Array.from(merged);
  }, [role, serverPermissions]);

  const hasPermission = useCallback(
    (perm: string) => permissions.includes(perm),
    [permissions],
  );

  const isFeatureVisible = useCallback(
    (feature: string) => !hiddenFeatures.includes(feature),
    [hiddenFeatures],
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
        hiddenFeatures,
        isFeatureVisible,
        companyName,
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
