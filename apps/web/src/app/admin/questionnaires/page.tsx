"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";

type Item = { id: string; title: string; status: "DRAFT" | "PUBLISHED"; _count: { questions: number; attempts: number }; createdBy: { name: string } | null };

export default function QuestionnairesPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.get<Item[]>("/admin/questionnaires").then(setItems).catch((e) => setError(errorLines(e)[0] ?? "Erro")), []);
  useEffect(() => void load(), [load]);

  async function remove(it: Item) {
    if (!window.confirm(`Excluir o questionário "${it.title}"?`)) return;
    try {
      await api.del(`/admin/questionnaires/${it.id}`);
      setError(null);
      await load();
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro ao excluir.");
    }
  }

  return (
    <Shell adminOnly>
      <div className="row between">
        <h1>Questionários</h1>
        <Link className="btn" href="/admin/questionnaires/new">Novo questionário</Link>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {items?.length === 0 && <p className="hint">Nenhum questionário criado.</p>}
      <ul className="list rows">
        {items?.map((it) => (
          <li key={it.id}>
            <Link href={`/admin/questionnaires/${it.id}`}>
              <strong>{it.title}</strong> <span className="hint">{it._count.questions} questões · {it._count.attempts} tentativas{it.createdBy ? ` · criado por ${it.createdBy.name}` : ""}</span>
            </Link>
            <span className={`tag ${it.status === "PUBLISHED" ? "ok" : ""}`}>{it.status === "PUBLISHED" ? "Publicado" : "Rascunho"}</span>
            <button className="link danger" onClick={() => void remove(it)}>Excluir</button>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
