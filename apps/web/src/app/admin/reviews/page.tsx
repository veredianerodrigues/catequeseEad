"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { fmtDate } from "@/components/review";

type Item = {
  id: string; title: string; status: "DRAFT" | "PUBLISHED"; createdAt: string; questionCount: number;
  completed: number; inProgress: number; abandoned: number; pendingAnswers: number;
};

export default function ReviewsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Item[]>("/admin/reviews").then(setItems).catch((e) => setError(errorLines(e)[0] ?? "Erro ao carregar."));
  }, []);

  return (
    <Shell adminOnly wide>
      <h1>Respostas recebidas</h1>
      <p className="hint">Questionários que você criou. Abra um para ver quem respondeu e avaliar as respostas.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!items && !error && <p className="hint" role="status">Carregando…</p>}
      {items?.length === 0 && <p className="hint">Você ainda não criou questionários. Crie um em “Montar questionários”.</p>}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Questionário</th><th>Situação</th><th>Criado em</th>
                <th className="num">Questões</th><th className="num">Concluídas</th><th className="num">Em andamento</th><th className="num">Respostas a avaliar</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id}>
                  <td><Link href={`/admin/reviews/${q.id}`}><strong>{q.title}</strong></Link></td>
                  <td><span className={`tag ${q.status === "PUBLISHED" ? "ok" : ""}`}>{q.status === "PUBLISHED" ? "Publicado" : "Rascunho"}</span></td>
                  <td className="nowrap">{fmtDate(q.createdAt)}</td>
                  <td className="num">{q.questionCount}</td>
                  <td className="num">{q.completed}</td>
                  <td className="num">{q.inProgress}</td>
                  <td className="num">{q.pendingAnswers > 0 ? <span className="tag warn">{q.pendingAnswers}</span> : 0}</td>
                  <td className="num"><Link className="btn small ghost" href={`/admin/reviews/${q.id}`}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
