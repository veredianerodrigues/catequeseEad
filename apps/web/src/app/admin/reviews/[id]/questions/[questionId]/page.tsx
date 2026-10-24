"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TYPE_LABELS, type AttemptStatus } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { RichContent } from "@/components/RichContent";
import { AnswerCell, fmtDate, GradeButtons, MatchHint, StatusTag, type Given, type Person, type QuestionInfo } from "@/components/review";

type Row = { answerId: string; attemptId: string; user: Person; attemptStatus: AttemptStatus; completedAt: string | null; canGrade: boolean; given: Given; matchesKey: boolean | null; isCorrect: boolean | null };
type Detail = {
  questionnaire: { id: string; title: string };
  question: QuestionInfo;
  key: Given;
  summary: { received: number; correct: number; wrong: number; pending: number };
  rows: Row[];
};

export default function QuestionAnswersPage() {
  const { id, questionId } = useParams<{ id: string; questionId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Detail>(`/admin/reviews/questionnaires/${id}/questions/${questionId}/answers`).then(setData).catch((e) => setError(errorLines(e)[0] ?? "Erro ao carregar."));
  }, [id, questionId]);

  const onGraded = (answerId: string, isCorrect: boolean | null) =>
    setData((d) => {
      if (!d) return d;
      const rows = d.rows.map((r) => (r.answerId === answerId ? { ...r, isCorrect } : r));
      return {
        ...d,
        rows,
        summary: { received: rows.length, correct: rows.filter((r) => r.isCorrect === true).length, wrong: rows.filter((r) => r.isCorrect === false).length, pending: rows.filter((r) => r.isCorrect === null).length },
      };
    });

  return (
    <Shell adminOnly wide>
      <p><Link href={`/admin/reviews/${id}`}>← Questionário</Link></p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!data && !error && <p className="hint" role="status">Carregando…</p>}
      {data && (
        <>
          <h1>{data.question.title}</h1>
          <p className="hint">{data.questionnaire.title} · {TYPE_LABELS[data.question.type]} · {data.question.subject}</p>

          <div className="card" style={{ alignItems: "stretch", flexDirection: "column" }}>
            <RichContent content={data.question.content} />
            <div><strong>Gabarito:</strong> <AnswerCell value={data.key} empty="— sem gabarito cadastrado —" /></div>
            {data.question.explanation && <div><strong>Explicação:</strong> <span className="pre">{data.question.explanation}</span></div>}
          </div>

          <div className="score" role="status" aria-live="polite">
            <div><span className="hint">Respostas recebidas</span><br /><span className="big">{data.summary.received}</span></div>
            <div><span className="tag ok">{data.summary.correct} corretas</span> <span className="tag bad">{data.summary.wrong} erradas</span> <span className="tag warn">{data.summary.pending} a avaliar</span></div>
          </div>

          {data.rows.length === 0 && <p className="hint">Nenhuma resposta recebida para esta questão.</p>}
          {data.rows.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Participante</th><th>E-mail</th><th>Situação</th><th>Enviada em</th><th>Resposta</th><th>Avaliação</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.answerId}>
                      <td><Link href={`/admin/reviews/${id}/attempts/${r.attemptId}`}><strong>{r.user.name}</strong></Link></td>
                      <td>{r.user.email}</td>
                      <td><StatusTag status={r.attemptStatus} /></td>
                      <td className="nowrap">{fmtDate(r.completedAt)}</td>
                      <td><AnswerCell value={r.given} /></td>
                      <td className="nowrap">
                        <GradeButtons answerId={r.answerId} isCorrect={r.isCorrect} disabled={!r.canGrade} onGraded={(v) => onGraded(r.answerId, v)} />
                        <MatchHint matches={r.matchesKey} />
                      </td>
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
