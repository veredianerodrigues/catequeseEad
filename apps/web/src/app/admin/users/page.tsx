"use client";

import { useEffect, useState } from "react";
import type { Role } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Shell } from "@/components/Shell";

type User = { id: string; name: string; email: string; role: Role; authMethod: "google" | "password"; emailVerified: boolean };

export default function UsersPage() {
  const { me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => void api.get<User[]>("/admin/users").then(setUsers).catch((e) => setError(errorLines(e)[0] ?? "Erro")), []);

  async function setRole(u: User, role: Role) {
    try {
      const updated = await api.patch<User>(`/admin/users/${u.id}/role`, { role });
      setUsers((p) => p?.map((x) => (x.id === u.id ? updated : x)) ?? p);
      setError(null);
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro");
    }
  }

  async function resetPassword(u: User) {
    if (!confirm(`Gerar uma senha temporária para ${u.name}? A senha atual deixa de valer e a pessoa será desconectada.`)) return;
    try {
      const r = await api.post<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`);
      setTemp({ name: u.name, password: r.temporaryPassword });
      setCopied(false);
      setError(null);
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro");
    }
  }

  return (
    <Shell adminOnly>
      <h1>Usuários</h1>
      {error && <p className="field-error" role="alert">{error}</p>}
      {temp && (
        <div className="notice warn" role="status">
          <p style={{ margin: 0 }}>Senha temporária de <strong>{temp.name}</strong> (aparece só agora; passe à pessoa por um canal seguro):</p>
          <p style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: ".08em", margin: ".4rem 0" }}>{temp.password}</p>
          <div className="row">
            <button className="btn small" onClick={() => void navigator.clipboard.writeText(temp.password).then(() => setCopied(true))}>{copied ? "Copiada ✓" : "Copiar"}</button>
            <button className="btn small ghost" onClick={() => setTemp(null)}>Fechar</button>
          </div>
          <p className="hint" style={{ margin: ".4rem 0 0" }}>No primeiro acesso, a pessoa é obrigada a escolher uma senha nova.</p>
        </div>
      )}
      <ul className="list rows">
        {users?.map((u) => (
          <li key={u.id}>
            <span>
              <strong>{u.name}</strong> <span className="hint">{u.email}</span>{" "}
              <span className="tag">{u.authMethod === "google" ? "Google" : "E-mail e senha"}</span>
              {!u.emailVerified && <span className="tag" title="O e-mail foi digitado pela própria pessoa e não foi confirmado">e-mail não confirmado</span>}
            </span>
            {u.authMethod === "password" && <button className="btn small ghost" onClick={() => void resetPassword(u)}>Redefinir senha</button>}
            <select aria-label={`Papel de ${u.name}`} value={u.role} disabled={u.id === me?.id} onChange={(e) => void setRole(u, e.target.value as Role)}>
              <option value="USER">Usuário</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
