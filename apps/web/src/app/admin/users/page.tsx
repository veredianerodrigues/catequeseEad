"use client";

import { useEffect, useState } from "react";
import type { Role } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Shell } from "@/components/Shell";

type User = { id: string; name: string; email: string; role: Role };

export default function UsersPage() {
  const { me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Shell adminOnly>
      <h1>Usuários</h1>
      {error && <p className="field-error" role="alert">{error}</p>}
      <ul className="list rows">
        {users?.map((u) => (
          <li key={u.id}>
            <span><strong>{u.name}</strong> <span className="hint">{u.email}</span></span>
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
