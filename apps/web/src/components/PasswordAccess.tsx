"use client";

import { useState, type FormEvent } from "react";
import { PASSWORD_MIN } from "@quiz/shared";
import { errorLines } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Mode = "entrar" | "criar";

/** Acesso por e-mail e senha, para quem tem dificuldade com o login do Google. */
export function PasswordAccess() {
  const { signInPassword, register } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("entrar");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  if (!open) {
    return (
      <button type="button" className="link access-open" onClick={() => setOpen(true)}>
        Não consegue entrar com o Google? Use e-mail e senha
      </button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "criar" && password !== confirm) return setErrors(["As duas senhas precisam ser iguais."]);
    setBusy(true);
    setErrors([]);
    try {
      if (mode === "criar") await register(name, email, password);
      else await signInPassword(email, password);
    } catch (err) {
      setErrors(errorLines(err));
      setBusy(false);
    }
  }

  return (
    <section className="access" aria-labelledby="access-title">
      <h2 id="access-title">Entrar com e-mail e senha</h2>
      <div className="access-tabs" role="tablist" aria-label="Escolha uma opção">
        {(["entrar", "criar"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`btn small ${mode === m ? "" : "ghost"}`}
            onClick={() => {
              setMode(m);
              setErrors([]);
            }}
          >
            {m === "entrar" ? "Já tenho acesso" : "Criar meu acesso"}
          </button>
        ))}
      </div>

      <form className="stack access-form" onSubmit={(e) => void submit(e)}>
        {mode === "criar" && (
          <div className="field">
            <label htmlFor="pw-name">Nome completo</label>
            <input id="pw-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={5} placeholder="Ex.: Maria da Silva" />
          </div>
        )}
        <div className="field">
          <label htmlFor="pw-email">E-mail</label>
          <input id="pw-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required placeholder="seunome@email.com" />
        </div>
        <div className="field">
          <label htmlFor="pw-pass">Senha</label>
          <input
            id="pw-pass"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "criar" ? "new-password" : "current-password"}
            required
            minLength={mode === "criar" ? PASSWORD_MIN : 1}
          />
          {mode === "criar" && <span className="hint">Pelo menos {PASSWORD_MIN} caracteres. Anote a senha em um lugar seguro.</span>}
        </div>
        {mode === "criar" && (
          <div className="field">
            <label htmlFor="pw-confirm">Repita a senha</label>
            <input id="pw-confirm" type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
        )}
        <label className="inline">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar a senha
        </label>

        {errors.length > 0 && (
          <div className="field-error" role="alert">
            {errors.map((l, i) => (
              <p key={i} style={{ margin: 0 }}>{l}</p>
            ))}
          </div>
        )}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Aguarde…" : mode === "criar" ? "Criar meu acesso" : "Entrar"}
        </button>
        {mode === "entrar" && <p className="hint" style={{ margin: 0 }}>Esqueceu a senha? Peça para um administrador gerar uma senha temporária.</p>}
      </form>
    </section>
  );
}
