"use client";

import { useState } from "react";
import type { AttemptStatus, QuestionType } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";

export type Given =
  | { kind: "text"; text: string | null }
  | { kind: "choice"; selected: { label: string; text: string }[] }
  | { kind: "items"; items: { label: string; text: string; value: boolean | null }[] };

export type Person = { id: string; name: string; email: string };
export type Summary = { total: number; answered: number; graded: number; correct: number; wrong: number; pending: number; percent: number };
export type QuestionInfo = { id: string; title: string; type: QuestionType; subject: string; content: unknown; explanation: string | null };

export const STATUS_LABEL: Record<AttemptStatus, string> = { IN_PROGRESS: "Em andamento", COMPLETED: "Concluída", ABANDONED: "Abandonada" };
export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

export function StatusTag({ status }: { status: AttemptStatus }) {
  return <span className={`tag ${status === "COMPLETED" ? "ok" : status === "ABANDONED" ? "bad" : "warn"}`}>{STATUS_LABEL[status]}</span>;
}

/** Resposta do participante ou gabarito, em formato legível. */
export function AnswerCell({ value, empty = "— sem resposta —" }: { value: Given; empty?: string }) {
  if (value.kind === "text") return value.text ? <div className="pre">{value.text}</div> : <span className="hint">{empty}</span>;
  if (value.kind === "choice") {
    return value.selected.length ? (
      <ul className="plain">{value.selected.map((s) => <li key={s.label}><strong>{s.label})</strong> {s.text}</li>)}</ul>
    ) : <span className="hint">{empty}</span>;
  }
  return (
    <ul className="plain">
      {value.items.map((i) => (
        <li key={i.label}>
          <strong>{i.label}.</strong> {i.text}{" "}
          {i.value === null ? <span className="hint">(sem resposta)</span> : <span className={`tag ${i.value ? "ok" : "bad"}`}>{i.value ? "V" : "F"}</span>}
        </li>
      ))}
    </ul>
  );
}

export function MatchHint({ matches }: { matches: boolean | null }) {
  if (matches === null) return <span className="hintline">Resposta aberta: avalie manualmente</span>;
  return <span className="hintline">{matches ? "✓ Confere com o gabarito" : "✗ Diverge do gabarito"}</span>;
}

/** Botões "Correto" / "Errado". Clicar de novo no botão ativo limpa a avaliação. */
export function GradeButtons({
  answerId,
  isCorrect,
  disabled,
  onGraded,
}: {
  answerId: string | null;
  isCorrect: boolean | null;
  disabled?: boolean;
  onGraded: (isCorrect: boolean | null, summary: Summary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(value: boolean) {
    if (!answerId) return;
    setBusy(true);
    setError(null);
    try {
      const next = isCorrect === value ? null : value;
      const r = await api.put<{ isCorrect: boolean | null; summary: Summary }>(`/admin/reviews/answers/${answerId}/grade`, { isCorrect: next });
      onGraded(r.isCorrect, r.summary);
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  if (!answerId) return <span className="hint">Sem resposta</span>;
  const off = busy || disabled;
  return (
    <div>
      <div className="grade" role="group" aria-label="Avaliar resposta">
        <button type="button" className="btn small yes" aria-pressed={isCorrect === true} disabled={off} title={disabled ? "Só é possível avaliar tentativas concluídas" : undefined} onClick={() => void set(true)}>✓ Correto</button>
        <button type="button" className="btn small no" aria-pressed={isCorrect === false} disabled={off} title={disabled ? "Só é possível avaliar tentativas concluídas" : undefined} onClick={() => void set(false)}>✗ Errado</button>
      </div>
      {error && <span className="field-error hintline" role="alert">{error}</span>}
    </div>
  );
}

export function ScoreBox({ summary, label = "Resultado" }: { summary: Summary; label?: string }) {
  return (
    <div className="score" role="status" aria-live="polite">
      <div><span className="hint">{label}</span><br /><span className="big">{summary.correct} de {summary.total}</span> <span className="hint">corretas ({summary.percent}%)</span></div>
      <div><span className="tag ok">{summary.correct} corretas</span> <span className="tag bad">{summary.wrong} erradas</span> <span className="tag warn">{summary.pending} a avaliar</span></div>
      <div className="hint">{summary.answered} de {summary.total} questões respondidas</div>
    </div>
  );
}
