"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PASSWORD_MIN } from "@quiz/shared";
import { errorLines } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Shell } from "@/components/Shell";

/** Troca de senha. Também é a única tela liberada depois de entrar com uma senha temporária. */
export default function PasswordPage() {
  const { me, changePassword, signOut } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const forced = me?.mustChangePassword ?? false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setErrors(["As duas senhas novas precisam ser iguais."]);
    setBusy(true);
    setErrors([]);
    try {
      await changePassword(current, next);
      router.replace("/");
    } catch (err) {
      setErrors(errorLines(err));
      setBusy(false);
    }
  }

  const form = (
    <form className="stack" onSubmit={(e) => void submit(e)} style={{ maxWidth: 460 }}>
      {forced && <p className="notice warn">Você entrou com uma senha temporária. Escolha uma senha nova para continuar.</p>}
      <div className="field">
        <label htmlFor="cur">{forced ? "Senha temporária" : "Senha atual"}</label>
        <input id="cur" type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </div>
      <div className="field">
        <label htmlFor="new">Senha nova</label>
        <input id="new" type={show ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={PASSWORD_MIN} />
        <span className="hint">Pelo menos {PASSWORD_MIN} caracteres.</span>
      </div>
      <div className="field">
        <label htmlFor="rep">Repita a senha nova</label>
        <input id="rep" type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </div>
      <label className="inline">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar as senhas
      </label>
      {errors.length > 0 && (
        <div className="field-error" role="alert">
          {errors.map((l, i) => (
            <p key={i} style={{ margin: 0 }}>{l}</p>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar senha nova"}</button>
        {forced ? (
          <button type="button" className="btn ghost" onClick={() => void signOut()}>Sair</button>
        ) : (
          <Link className="btn ghost" href="/">Cancelar</Link>
        )}
      </div>
    </form>
  );

  // Com senha temporária o resto do sistema está bloqueado: mostra só o formulário, sem o menu.
  if (forced) {
    return (
      <main className="container">
        <h1>Trocar a senha</h1>
        {form}
      </main>
    );
  }
  return (
    <Shell>
      <h1>Trocar a senha</h1>
      {form}
    </Shell>
  );
}
