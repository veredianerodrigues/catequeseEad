"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TYPE_LABELS, type AttemptStatus, type QuestionType } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { fmtDate, StatusTag, type Person, type Summary } from "@/components/review";

type AttemptRow = Summary & { attemptId: string; attemptNumber: number; user: Person; status: AttemptStatus; startedAt: string; completedAt: string | null };
type Participants = { questionnaire: { id: string; title: string; createdBy: string | null }; attempts: AttemptRow[] };
type QuestionRow = { position: number; id: string; title: string; type: QuestionType; subject: string; received: number; correct: number; wrong: number; pending: number };
type Questions = { questionnaire: { id: string; title: string }; questions: QuestionRow[] };

export default function QuestionnaireReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"users" | "questions">("users");
  const [people, setPeople] = useState<Participants | null>(null);
  const [questions, setQuestions] = useState<Questions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Participants>(`/admin/reviews/questionnaires/${id}`).then(setPeople).catch((e) => setError(errorLines(e)[0] ?? "Erro ao carregar."));
  }, [id]);

  useEffect(() => {
    if (tab === "questions" && !questions) {
      api.get<Questions>(`/admin/reviews/questionnaires/${id}/questions`).then(setQuestions).catch((e) => setError(errorLines(e)[0] ?? "Erro ao carregar."));
    }
  }, [tab, questions, id]);

  return (
    <Shell adminOnly wide>
      <p><Link href="/admin/reviews">← Questionários</Link></p>
      <h1>{people?.questionnaire.title ?? "Questionário"}</h1>
      {error && <p className="field-error" role="alert">{error}</p>}

      <div className="tabs" role="tablist" aria-label="Visões">
        <button role="tab" aria-selected={tab === "users"} onClick={() => setTab("users")}>Por participante</button>
        <button role="tab" aria-selected={tab === "questions"} onClick={() => setTab("questions")}>Por questão</button>
      </div>

      {tab === "users" && (
        <>
          {!people && !error && <p className="hint" role="status">Carregando…</p>}
          {people?.attempts.length === 0 && <p className="hint">Ninguém respondeu este questionário ainda.</p>}
          {people && people.attempts.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Participante</th><th>E-mail</th><th className="num">Tentativa</th><th>Situação</th><th>Enviada em</th>
                    <th className="num">Respondidas</th><th className="num">Avaliadas</th><th className="num">Corretas</th><th className="num">Resultado</th><th />
                  </tr>
                </thead>
                <tbody>
                  {people.attempts.map((a) => (
                    <tr key={a.attemptId}>
                      <td><Link href={`/admin/reviews/${id}/attempts/${a.attemptId}`}><strong>{a.user.name}</strong></Link></td>
                      <td>{a.user.email}</td>
                      <td className="num">{a.attemptNumber}ª</td>
                      <td><StatusTag status={a.status} /></td>
                      <td className="nowrap">{fmtDate(a.completedAt)}</td>
                      <td className="num">{a.answered}/{a.total}</td>
                      <td className="num">{a.graded}/{a.answered}{a.pending > 0 && <span className="tag warn" style={{ marginLeft: 6 }}>{a.pending} a avaliar</span>}</td>
                      <td className="num">{a.correct}/{a.total}</td>
                      <td className="num">{a.graded > 0 ? <strong>{a.percent}%</strong> : <span className="hint">—</span>}</td>
                      <td className="num"><Link className="btn small ghost" href={`/admin/reviews/${id}/attempts/${a.attemptId}`}>Ver respostas</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "questions" && (
        <>
          {!questions && !error && <p className="hint" role="status">Carregando…</p>}
          {questions && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th className="num">#</th><th>Questão</th><th>Tipo</th><th>Assunto</th><th className="num">Recebidas</th><th className="num">Corretas</th><th className="num">Erradas</th><th className="num">A avaliar</th><th /></tr>
                </thead>
                <tbody>
                  {questions.questions.map((q) => (
                    <tr key={q.id}>
                      <td className="num">{q.position}</td>
                      <td><Link href={`/admin/reviews/${id}/questions/${q.id}`}><strong>{q.title}</strong></Link></td>
                      <td>{TYPE_LABELS[q.type]}</td>
                      <td>{q.subject}</td>
                      <td className="num">{q.received}</td>
                      <td className="num">{q.correct}</td>
                      <td className="num">{q.wrong}</td>
                      <td className="num">{q.pending > 0 ? <span className="tag warn">{q.pending}</span> : 0}</td>
                      <td className="num"><Link className="btn small ghost" href={`/admin/reviews/${id}/questions/${q.id}`}>Ver respostas</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
