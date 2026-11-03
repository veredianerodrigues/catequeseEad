"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Me } from "@quiz/shared";
import { api, ApiError, SESSION_EXPIRED_EVENT, setCsrfToken } from "./api";

type AuthState = {
  me: Me | null;
  loading: boolean;
  signIn: (idToken: string) => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
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

  // Ao voltar para a página, confere se a sessão já existe (ex.: a janela do Google travou depois de aprovar, ou o login foi feito em outra aba).
  useEffect(() => {
    if (loading || me) return;
    let checking = false;
    const recheck = () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      api
        .get<Me>("/auth/me")
        .then(applyMe)
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [loading, me, applyMe]);

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
    if (!loading && me?.mustChangePassword && pathname !== "/senha") router.replace("/senha");
  }, [loading, me, pathname, router]);

  useEffect(() => {
    if (!loading && !me && pathname !== "/login" && pathname !== "/privacidade" && pathname !== "/termos") router.replace(pathname && pathname !== "/" ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
  }, [loading, me, pathname, router]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      signIn: async (idToken) => applyMe(await api.post<Me>("/auth/google", { idToken })),
      signInPassword: async (email, password) => applyMe(await api.post<Me>("/auth/login", { email, password })),
      register: async (name, email, password) => applyMe(await api.post<Me>("/auth/register", { name, email, password })),
      changePassword: async (currentPassword, newPassword) => applyMe(await api.post<Me>("/auth/password", { currentPassword, newPassword })),
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
