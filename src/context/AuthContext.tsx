import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AuthState, Profile } from '../types';
import { authenticate as apiAuth, getProfile } from '../lib/api';

interface AuthContextType {
  auth: AuthState | null;
  profile: Profile | null;
  collectionId: string | null;
  login: (refreshToken: string, googleApiKey: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStoredAuth(): AuthState | null {
  const raw = localStorage.getItem('auth');
  return raw ? JSON.parse(raw) : null;
}

function getStoredProfile(): Profile | null {
  const raw = localStorage.getItem('profile');
  return raw ? JSON.parse(raw) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(getStoredAuth);
  const [profile, setProfile] = useState<Profile | null>(getStoredProfile);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collectionId =
    profile?.collectionId ?? profile?.collection?.id ?? null;

  const login = useCallback(async (refreshToken: string, googleApiKey: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const newAuth = await apiAuth(refreshToken, googleApiKey);
      setAuth(newAuth);
      const newProfile = await getProfile(newAuth.userId);
      setProfile(newProfile);
      localStorage.setItem('profile', JSON.stringify(newProfile));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('auth');
    localStorage.removeItem('profile');
    setAuth(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ auth, profile, collectionId, login, logout, isLoading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
