import { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin, logout as apiLogout, getCurrentUser } from '../services/api';
import { wsService } from '../services/ws';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('nodewatch_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('nodewatch_token');
    if (!token) {
      setLoading(false);
      return;
    }

    getCurrentUser()
      .then((data) => {
        setUser(data);
        localStorage.setItem('nodewatch_user', JSON.stringify(data));
        wsService.connect();
      })
      .catch(() => {
        setUser(null);
        localStorage.removeItem('nodewatch_token');
        localStorage.removeItem('nodewatch_user');
      })
      .finally(() => setLoading(false));

    const handleUnauthorized = () => {
      setUser(null);
      wsService.disconnect();
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = async (username, password) => {
    const data = await apiLogin(username, password);
    setUser(data.user);
    wsService.connect();
    return data;
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
    wsService.disconnect();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
