"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { errorLines } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginArt } from "@/components/LoginArt";
import { ChurchLogo } from "@/components/ChurchLogo";
import { PasswordAccess } from "@/components/PasswordAccess";

type GoogleId = {
  initialize: (o: { client_id: string; use_fedcm_for_button: boolean; callback: (r: { credential: string }) => void }) => void;
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
const SIGN_IN_TIMEOUT_MS = 20_000;

function LoginInner() {
  const { me, loading, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  /** Envia o token à API mostrando "Entrando…"; se demorar demais, avisa (uma resposta tardia ainda conclui o login). */
  const enter = useCallback(
    (token: string) => {
      setError(null);
      setSigningIn(true);
      const timer = setTimeout(() => {
        setSigningIn(false);
        setError("O login está demorando mais que o normal. Verifique sua conexão e tente novamente.");
      }, SIGN_IN_TIMEOUT_MS);
      signIn(token)
        .catch((e) => setError(errorLines(e)[0] ?? "Falha no login."))
        .finally(() => {
          clearTimeout(timer);
          setSigningIn(false);
        });
    },
    [signIn],
  );

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
        // Com FedCM, o próprio navegador conduz a janela de login (onde houver suporte).
        use_fedcm_for_button: true,
        callback: ({ credential }) => enter(credential),
      });
      // O botão é o oficial do Google (largura máxima permitida: 400).
      g.renderButton(button.current, { theme: "outline", size: "large", text: "continue_with", logo_alignment: "left", locale: "pt-BR", width: Math.max(220, Math.min(400, window.innerWidth - 56)) });
    };
    if (window.google) return init();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = init;
    script.onerror = () => setError("Não foi possível carregar o login do Google. Verifique sua conexão.");
    document.head.appendChild(script);
  }, [loading, me, enter]);

  return (
    <div className="login-split">
      <LoginArt />
      <section className="login-panel">
        <span className="panel-curve" aria-hidden="true">
          <svg viewBox="0 0 60 1000" preserveAspectRatio="none"><path d="M60 0 L38 0 C8 180 4 300 30 430 C56 560 52 760 12 1000 L60 1000 Z" /></svg>
        </span>
        <div className="theme-corner"><ThemeToggle /></div>
        <main className="login-content">
          <ChurchLogo />
          <h1>Saber Catequese</h1>
          <div className="login-rule" aria-hidden="true"><span /><svg viewBox="0 0 24 22" width="18" height="16"><path d="M12 21 C-4 9 3 -3 12 5 C21 -3 28 9 12 21 Z" fill="#e3a21a" /></svg><span /></div>
          <p className="login-sub">
            <span>Material de apoio para catequese</span>
            <span>Paróquia Perpétuo Socorro — Cascavel — PR</span>
          </p>
          <h2 className="login-welcome">Bem-vindo(a)!</h2>
          <p className="login-lead">Entre com sua conta Google para responder e continuar de onde parou.</p>
          {params.get("expired") && <p className="notice" role="alert">Sua sessão expirou. Entre novamente — suas respostas salvas continuam guardadas.</p>}
          {DEV_AUTH && (
            <form
              className="stack"
              style={{ width: "100%" }}
              onSubmit={(e) => {
                e.preventDefault();
                const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
                enter(`dev:${email}:${email.split("@")[0]}`);
              }}
            >
              <label htmlFor="dev-email">E-mail (login de desenvolvimento)</label>
              <input id="dev-email" name="email" type="email" required />
              <button className="btn" type="submit">Entrar (dev)</button>
            </form>
          )}
          {!CLIENT_ID && !DEV_AUTH ? <p className="field-error">Login indisponível: NEXT_PUBLIC_GOOGLE_CLIENT_ID não configurado.</p> : <div className="google-slot" ref={button} aria-label="Entrar com Google" />}
          {(signingIn || me) && <p className="hint" role="status">Entrando…</p>}
          {error && !me && <p className="field-error" role="alert">{error}</p>}
          <PasswordAccess />
          <p className="hint login-links"><a href="/privacidade">Privacidade</a> <span aria-hidden="true">·</span> <a href="/termos">Termos</a></p>
        </main>
        <svg className="olive-sprig" viewBox="0 0 120 160" aria-hidden="true" focusable="false">
          <path d="M60 158 C58 110 70 60 108 10" stroke="#b9c9a8" strokeWidth="3" fill="none" strokeLinecap="round" />
          {[[66, 120, -35], [78, 92, -28], [92, 62, -20], [54, 100, 30], [62, 70, 36], [76, 42, 40]].map(([x, y, r], i) => (
            <ellipse key={i} cx={x} cy={y} rx="7" ry="17" fill="#cfdcc0" transform={`rotate(${r} ${x} ${y})`} />
          ))}
        </svg>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
