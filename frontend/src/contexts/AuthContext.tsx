import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type AuthContextType = {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("mcp_token"));

  function login(t: string) {
    localStorage.setItem("mcp_token", t);
    setToken(t);
  }

  function logout() {
    localStorage.removeItem("mcp_token");
    setToken(null);
  }

  useEffect(() => {
    const stored = localStorage.getItem("mcp_token");
    if (stored) setToken(stored);
  }, []);

  return <AuthContext.Provider value={{ token, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
