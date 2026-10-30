"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Me } from "@quiz/shared";
import { api, ApiError, SESSION_EXPIRED_EVENT, setCsrfToken } from "./api";

type AuthState = {
  me: Me | null;
  loading: boolean;
  signIn: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const applyMe = useCallback((m: Me | null) => {
    setMe(m);
    setCsrfToken(m?.csrfToken ?? "");
  }, []);

  useEffect(() => {
    api
      .get<Me>("/auth/me")
      .then(applyMe)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
        applyMe(null);
      })
      .finally(() => setLoading(false));
  }, [applyMe]);

  useEffect(() => {
    const onExpired = () => {
      applyMe(null);
      const here = window.location.pathname;
      router.replace(`/login?expired=1${here !== "/" && here !== "/login" ? `&next=${encodeURIComponent(here)}` : ""}`);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [applyMe, router]);

  useEffect(() => {
    if (!loading && !me && pathname !== "/login") router.replace(pathname && pathname !== "/" ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
  }, [loading, me, pathname, router]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      signIn: async (idToken) => applyMe(await api.post<Me>("/auth/google", { idToken })),
      signOut: async () => {
        await api.post("/auth/logout").catch(() => undefined);
        applyMe(null);
        router.replace("/login");
      },
    }),
    [me, loading, applyMe, router],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
