import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiService } from '@/services/api';

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'auth_token';
const USERNAME_KEY = 'auth_username';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const savedUsername = localStorage.getItem(USERNAME_KEY);
    
    if (token && savedUsername) {
      apiService.setToken(token);
      verifyToken(token)
        .then((valid) => {
          if (valid) {
            setIsAuthenticated(true);
            setUsername(savedUsername);
          } else {
            clearAuth();
          }
        })
        .catch(() => {
          clearAuth();
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  const clearAuth = (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    apiService.setToken(null);
  };

  const verifyToken = async (token: string): Promise<boolean> => {
    try {
      apiService.setToken(token);
      await apiService.verifyToken();
      return true;
    } catch {
      return false;
    }
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await apiService.login(username, password);
      localStorage.setItem(TOKEN_KEY, response.access_token);
      localStorage.setItem(USERNAME_KEY, username);
      apiService.setToken(response.access_token);
      setIsAuthenticated(true);
      setUsername(username);
      return true;
    } catch (error) {
      return false;
    }
  };

  const logout = (): void => {
    clearAuth();
    setIsAuthenticated(false);
    setUsername(null);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        username,
        login,
        logout,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
