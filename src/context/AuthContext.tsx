import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AUTH_EVENT, login as apiLogin, logout as apiLogout, me } from '../lib/api';

type Status = 'checking' | 'in' | 'out';

interface AuthContextType {
  status: Status;
  login: (passphrase: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const queryClient = useQueryClient();

  useEffect(() => {
    me()
      .then((ok) => setStatus(ok ? 'in' : 'out'))
      .catch(() => setStatus('out'));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setStatus('out');
      queryClient.clear();
    };
    window.addEventListener(AUTH_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_EVENT, onUnauthorized);
  }, [queryClient]);

  const login = useCallback(
    async (passphrase: string) => {
      await apiLogin(passphrase);
      queryClient.clear();
      setStatus('in');
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await apiLogout().catch(() => {});
    queryClient.clear();
    setStatus('out');
  }, [queryClient]);

  return <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
