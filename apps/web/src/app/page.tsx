"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AttemptStatus, AttemptView } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";

type QuestionnaireItem = { id: string; title: string; description: string; questionCount: number; inProgressAttemptId: string | null };
type AttemptItem = { id: string; status: AttemptStatus; startedAt: string; completedAt: string | null; total: number; answered: number; currentIndex: number; questionnaire: { id: string; title: string } };

const STATUS_LABEL: Record<AttemptStatus, string> = { IN_PROGRESS: "Em andamento", COMPLETED: "Concluída", ABANDONED: "Abandonada" };
const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function HomePage() {
  const router = useRouter();
  const [items, setItems] = useState<QuestionnaireItem[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, a] = await Promise.all([api.get<QuestionnaireItem[]>("/questionnaires"), api.get<AttemptItem[]>("/attempts")]);
      setItems(q);
      setAttempts(a);
      setError(null);
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro ao carregar.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function start(id: string) {
    setStarting(id);
    try {
      const attempt = await api.post<AttemptView>(`/questionnaires/${id}/attempts`);
      router.push(`/attempts/${attempt.id}`);
    } catch (e) {
      setError(errorLines(e)[0] ?? "Não foi possível iniciar.");
      setStarting(null);
    }
  }

  const inProgress = attempts.filter((a) => a.status === "IN_PROGRESS");
  const history = attempts.filter((a) => a.status !== "IN_PROGRESS");

  return (
    <Shell>
      <h1>Questionários</h1>
      {error && (
        <p className="field-error" role="alert">
          {error} <button className="link" onClick={() => void load()}>Tentar novamente</button>
        </p>
      )}

      {inProgress.length > 0 && (
        <section aria-labelledby="em-andamento">
          <h2 id="em-andamento">Continuar de onde parou</h2>
          <ul className="cards">
            {inProgress.map((a) => (
              <li key={a.id} className="card">
                <h3>{a.questionnaire.title}</h3>
                <p className="hint">Iniciada em {fmt(a.startedAt)} · {a.answered} de {a.total} respondidas</p>
                <progress value={a.answered} max={a.total} aria-label="Progresso" />
                <Link className="btn" href={`/attempts/${a.id}`}>Continuar</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="disponiveis">
        <h2 id="disponiveis">Disponíveis</h2>
        {items === null && !error && <p className="hint" role="status">Carregando…</p>}
        {items?.length === 0 && <p className="hint">Nenhum questionário listado. Para responder um questionário, abra o link que você recebeu.</p>}
        <ul className="cards">
          {items?.map((q) => (
            <li key={q.id} className="card">
              <h3>{q.title}</h3>
              {q.description && <p>{q.description}</p>}
              <p className="hint">{q.questionCount} {q.questionCount === 1 ? "questão" : "questões"}</p>
              <button className={q.inProgressAttemptId ? "btn ghost" : "btn"} disabled={starting === q.id} onClick={() => void start(q.id)}>
                {starting === q.id ? "Iniciando…" : q.inProgressAttemptId ? "Nova tentativa" : "Iniciar"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {history.length > 0 && (
        <section aria-labelledby="historico">
          <h2 id="historico">Histórico</h2>
          <ul className="list">
            {history.map((a) => (
              <li key={a.id}>
                <Link href={`/attempts/${a.id}`}>
                  <strong>{a.questionnaire.title}</strong> — {STATUS_LABEL[a.status]} · {a.answered}/{a.total} respondidas · {fmt(a.completedAt ?? a.startedAt)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}
