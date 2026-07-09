/**
 * AuthStore — manages MusicKit authorization state.
 *
 * Initialises MusicKit on mount, then exposes:
 *   isAuthorized  — whether the user is signed in
 *   isLoading     — true during init / auth flow
 *   error         — any init or auth error message
 *   login()       — triggers Apple sign-in popup
 *   logout()      — clears the user session
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { getMusicKit } from '@/api/musickit';
import { authorize, unauthorize } from '@/api/auth';

interface AuthState {
  isAuthorized: boolean;
  isLoading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthStoreProvider({ children }: { children: React.ReactNode }) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMusicKit()
      .then((mk) => {
        setIsAuthorized(mk.isAuthorized);

        // Listen for auth state changes (e.g. token expiry)
        mk.addEventListener('authorizationStatusDidChange', () => {
          setIsAuthorized(mk.isAuthorized);
        });
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => setIsLoading(false));
  }, []);

  async function login() {
    setIsLoading(true);
    setError(null);
    try {
      await authorize();
      setIsAuthorized(true);
    } catch (err) {
      setError((err as Error).message ?? 'Authorization failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function logout() {
    await unauthorize();
    setIsAuthorized(false);
  }

  return (
    <AuthContext.Provider value={{ isAuthorized, isLoading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthStoreProvider');
  return ctx;
}
