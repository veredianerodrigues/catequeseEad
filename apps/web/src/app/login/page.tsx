"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { errorLines } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

/** Só aceita caminhos internos (evita redirecionar para outro site). */
const safeNext = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/");

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const DEV_AUTH = process.env.NEXT_PUBLIC_DEV_AUTH === "true";

function LoginInner() {
  const { me, loading, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && me) router.replace(safeNext(params.get("next")));
  }, [loading, me, router, params]);

  useEffect(() => {
    if (!CLIENT_ID || loading || me) return;
    const init = () => {
      const g = window.google?.accounts.id;
      if (!g || !button.current) return;
      g.initialize({
        client_id: CLIENT_ID,
        callback: ({ credential }) => {
          setError(null);
          signIn(credential).catch((e) => setError(errorLines(e)[0] ?? "Falha no login."));
        },
      });
      g.renderButton(button.current, { theme: "outline", size: "large", text: "signin_with", locale: "pt-BR", width: 280 });
    };
    if (window.google) return init();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = init;
    script.onerror = () => setError("Não foi possível carregar o login do Google. Verifique sua conexão.");
    document.head.appendChild(script);
  }, [loading, me, signIn]);

  return (
    <main className="center">
      <div className="theme-corner"><ThemeToggle /></div>
      <h1>Questionários</h1>
      <p>Entre com sua conta Google para responder e continuar de onde parou.</p>
      {params.get("expired") && <p className="notice" role="alert">Sua sessão expirou. Entre novamente — suas respostas salvas continuam guardadas.</p>}
      {DEV_AUTH && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
            signIn(`dev:${email}:${email.split("@")[0]}`).catch((err) => setError(errorLines(err)[0] ?? "Falha no login."));
          }}
        >
          <label htmlFor="dev-email">E-mail (login de desenvolvimento)</label>
          <input id="dev-email" name="email" type="email" required />
          <button className="btn" type="submit">Entrar (dev)</button>
        </form>
      )}
      {!CLIENT_ID && !DEV_AUTH ? <p className="field-error">Login indisponível: NEXT_PUBLIC_GOOGLE_CLIENT_ID não configurado.</p> : <div ref={button} aria-label="Entrar com Google" />}
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="hint"><a href="/privacidade">Privacidade</a> · <a href="/termos">Termos</a></p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
