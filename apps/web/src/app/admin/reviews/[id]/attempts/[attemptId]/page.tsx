"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TYPE_LABELS, type AttemptStatus } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { RichContent } from "@/components/RichContent";
import { AnswerCell, fmtDate, GradeButtons, MatchHint, ScoreBox, StatusTag, type Given, type Person, type QuestionInfo, type Summary } from "@/components/review";

type Row = {
  position: number; question: QuestionInfo; answerId: string | null; answered: boolean;
  given: Given; key: Given; matchesKey: boolean | null; isCorrect: boolean | null;
};
type Detail = {
  attempt: { id: string; status: AttemptStatus; startedAt: string; completedAt: string | null; canGrade: boolean };
  user: Person;
  questionnaire: { id: string; title: string };
  summary: Summary;
  rows: Row[];
};

export default function AttemptReviewPage() {
  const { id, attemptId } = useParams<{ id: string; attemptId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Detail>(`/admin/reviews/attempts/${attemptId}`).then(setData).catch((e) => setError(errorLines(e)[0] ?? "Erro ao carregar."));
  }, [attemptId]);

  const onGraded = (answerId: string | null, isCorrect: boolean | null, summary: Summary) =>
    setData((d) => (d ? { ...d, summary, rows: d.rows.map((r) => (r.answerId === answerId ? { ...r, isCorrect } : r)) } : d));

  return (
    <Shell adminOnly wide>
      <p><Link href={`/admin/reviews/${id}`}>← Participantes do questionário</Link></p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!data && !error && <p className="hint" role="status">Carregando…</p>}
      {data && (
        <>
          <h1>{data.user.name}</h1>
          <p className="hint">
            {data.user.email} · {data.questionnaire.title} · <StatusTag status={data.attempt.status} /> · iniciada em {fmtDate(data.attempt.startedAt)}
            {data.attempt.completedAt && <> · enviada em {fmtDate(data.attempt.completedAt)}</>}
          </p>
          {!data.attempt.canGrade && <p className="notice warn" role="status">Esta tentativa ainda não foi enviada. A avaliação fica disponível quando for concluída.</p>}

          <ScoreBox summary={data.summary} />

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th className="num">#</th><th>Questão</th><th>Resposta do participante</th><th>Gabarito</th><th>Avaliação</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.question.id}>
                    <td className="num">{r.position}</td>
                    <td style={{ minWidth: "14rem", maxWidth: "26rem" }}>
                      <strong>{r.question.title}</strong>
                      <span className="hintline">{TYPE_LABELS[r.question.type]} · {r.question.subject}</span>
                      <details className="enun"><summary>Ver enunciado</summary><RichContent content={r.question.content} /></details>
                    </td>
                    <td><AnswerCell value={r.given} /></td>
                    <td>
                      <AnswerCell value={r.key} empty="— sem gabarito cadastrado —" />
                      {r.question.explanation && <details className="enun"><summary>Explicação</summary><div className="pre">{r.question.explanation}</div></details>}
                    </td>
                    <td className="nowrap">
                      <GradeButtons answerId={r.answerId} isCorrect={r.isCorrect} disabled={!data.attempt.canGrade} onGraded={(v, s) => onGraded(r.answerId, v, s)} />
                      {r.answered && <MatchHint matches={r.matchesKey} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Clique de novo em “Correto” ou “Errado” para desfazer a avaliação. Questões sem resposta não somam pontos.</p>
        </>
      )}
    </Shell>
  );
}
