"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TYPE_LABELS, QUESTION_TYPES, type QuestionType } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";

type Item = { id: string; title: string; type: QuestionType; status: "DRAFT" | "PUBLISHED"; updatedAt: string; subject: { id: string; name: string } };
type Page = { total: number; page: number; pageSize: number; items: Item[] };
type Subject = { id: string; name: string };

export default function AdminQuestionsPage() {
  const [filters, setFilters] = useState({ q: "", status: "", type: "", subjectId: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => void api.get<Subject[]>("/admin/subjects").then(setSubjects).catch(() => undefined), []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: "20" });
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    try {
      setData(await api.get<Page>(`/admin/questions?${qs}`));
      setError(null);
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro ao carregar.");
    }
  }, [filters, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k: keyof typeof filters, v: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };

  async function remove(item: Item) {
    if (!window.confirm(`Excluir a questão "${item.title}"?`)) return;
    try {
      await api.del(`/admin/questions/${item.id}`);
      await load();
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro ao excluir.");
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Shell adminOnly>
      <div className="page-head">
        <h1>Questões</h1>
        <Link className="btn" href="/admin/questions/new">Nova questão</Link>
      </div>

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <label>Buscar<input type="search" value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Título ou enunciado" /></label>
        <label>Status<select value={filters.status} onChange={(e) => set("status", e.target.value)}><option value="">Todos</option><option value="DRAFT">Rascunho</option><option value="PUBLISHED">Publicada</option></select></label>
        <label>Tipo<select value={filters.type} onChange={(e) => set("type", e.target.value)}><option value="">Todos</option>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></label>
        <label>Assunto<select value={filters.subjectId} onChange={(e) => set("subjectId", e.target.value)}><option value="">Todos</option>{subjects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </form>

      {error && <p className="field-error" role="alert">{error}</p>}
      {data && data.items.length === 0 && <p className="hint">Nenhuma questão encontrada.</p>}
      <ul className="list rows">
        {data?.items.map((it) => (
          <li key={it.id}>
            <Link href={`/admin/questions/${it.id}`}>
              <strong>{it.title}</strong>
              <span className="hint"> {TYPE_LABELS[it.type]} · {it.subject.name}</span>
            </Link>
            <span className={`tag ${it.status === "PUBLISHED" ? "ok" : ""}`}>{it.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</span>
            <button className="link danger" onClick={() => void remove(it)}>Excluir</button>
          </li>
        ))}
      </ul>

      {data && pages > 1 && (
        <div className="row pager">
          <button className="btn small ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Anterior</button>
          <span>Página {page} de {pages}</span>
          <button className="btn small ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima →</button>
        </div>
      )}
    </Shell>
  );
}
