"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { AttemptQuestionView, AttemptView } from "@quiz/shared";
import { api, ApiError, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { RichContent } from "@/components/RichContent";

type LocalAnswer = { text: string; alternativeIds: string[]; items: { itemId: string; value: boolean }[] };
const EMPTY: LocalAnswer = { text: "", alternativeIds: [], items: [] };
type SaveState = "saving" | "saved" | "error";

const DEBOUNCE_MS = 800;
const hasContent = (a?: LocalAnswer) => !!a && (a.text.trim().length > 0 || a.alternativeIds.length > 0 || a.items.length > 0);

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [confirm, setConfirm] = useState<"finish" | "abandon" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  // Valores mais recentes e controle de gravações (por questão) fora do ciclo de render.
  const latest = useRef<Record<string, LocalAnswer>>({});
  const running = useRef(new Map<string, Promise<boolean>>());
  const dirty = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const failed = useRef(new Set<string>());

  const readOnly = attempt?.status !== "IN_PROGRESS";

  const load = useCallback(async () => {
    try {
      const a = await api.get<AttemptView>(`/attempts/${id}`);
      const initial: Record<string, LocalAnswer> = {};
      for (const q of a.questions) if (q.answer) initial[q.questionId] = { text: q.answer.text ?? "", alternativeIds: q.answer.alternativeIds, items: q.answer.items };
      latest.current = initial;
      setAnswers(initial);
      setAttempt(a);
      setIndex(Math.min(a.currentIndex, a.total - 1));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError && e.status === 404 ? "Tentativa não encontrada." : (errorLines(e)[0] ?? "Erro ao carregar."));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const mark = (qid: string, s: SaveState) => setSaveState((p) => ({ ...p, [qid]: s }));

  /** Grava a versão mais recente. Chamadas simultâneas coalescem: se algo mudou durante o envio, reenvia. */
  const save = useCallback(
    (qid: string): Promise<boolean> => {
      const t = timers.current.get(qid);
      if (t) {
        clearTimeout(t);
        timers.current.delete(qid);
      }
      const current = running.current.get(qid);
      if (current) {
        dirty.current.add(qid);
        return current;
      }
      const p = (async () => {
        try {
          do {
            dirty.current.delete(qid);
            mark(qid, "saving");
            const v = latest.current[qid] ?? EMPTY;
            const q = attemptRef.current?.questions.find((x) => x.questionId === qid);
            await api.put(`/attempts/${id}/answers/${qid}`, q?.type === "OPEN" ? { text: v.text } : q?.type === "TRUE_FALSE" ? { items: v.items } : { alternativeIds: v.alternativeIds });
          } while (dirty.current.has(qid));
          failed.current.delete(qid);
          setOffline(false);
          mark(qid, "saved"); // só depois da confirmação da API
          return true;
        } catch (e) {
          failed.current.add(qid);
          mark(qid, "error");
          if (e instanceof ApiError && e.isNetwork) setOffline(true);
          if (e instanceof ApiError && e.status === 409) {
            failed.current.delete(qid);
            void load(); // tentativa foi encerrada em outra aba: recarrega em modo leitura
          }
          return false;
        } finally {
          running.current.delete(qid);
        }
      })();
      running.current.set(qid, p);
      return p;
    },
    [id, load],
  );

  const attemptRef = useRef<AttemptView | null>(null);
  attemptRef.current = attempt;

  const flushAll = useCallback(async () => {
    const pending = new Set([...timers.current.keys(), ...failed.current, ...running.current.keys()]);
    const results = await Promise.all([...pending].map((qid) => save(qid)));
    return results.every(Boolean);
  }, [save]);

  function change(q: AttemptQuestionView, next: LocalAnswer, immediate: boolean) {
    latest.current[q.questionId] = next;
    setAnswers((p) => ({ ...p, [q.questionId]: next }));
    const existing = timers.current.get(q.questionId);
    if (existing) clearTimeout(existing);
    if (immediate) void save(q.questionId);
    else {
      mark(q.questionId, "saving");
      timers.current.set(q.questionId, setTimeout(() => void save(q.questionId), DEBOUNCE_MS));
    }
  }

  // Retoma gravações com falha quando a conexão volta.
  useEffect(() => {
    const online = () => void flushAll();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flushAll]);

  // Avisa antes de fechar a página se ainda houver respostas não confirmadas pela API.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (timers.current.size || running.current.size || failed.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hidden = () => document.visibilityState === "hidden" && void flushAll();
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flushAll]);

  async function goTo(next: number) {
    if (!attempt || next < 0 || next >= attempt.total || next === index) return;
    const current = attempt.questions[index];
    if (current && !readOnly) void save(current.questionId);
    setIndex(next);
    setConfirm(null);
    window.scrollTo({ top: 0 });
    if (!readOnly) void api.patch(`/attempts/${id}/progress`, { currentIndex: next }).catch(() => undefined);
  }

  async function finish(kind: "complete" | "abandon") {
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "complete" && !(await flushAll())) {
        setActionError("Algumas respostas ainda não foram salvas. Verifique a conexão e tente novamente.");
        return;
      }
      setAttempt(await api.post<AttemptView>(`/attempts/${id}/${kind}`));
      setConfirm(null);
    } catch (e) {
      setActionError(errorLines(e)[0] ?? "Erro ao concluir.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Shell>
        <p className="field-error" role="alert">{loadError}</p>
        <button className="btn" onClick={() => void load()}>Tentar novamente</button> <Link className="btn ghost" href="/">Início</Link>
      </Shell>
    );
  }
  if (!attempt) return <Shell><p className="hint" role="status">Carregando…</p></Shell>;

  const q = attempt.questions[index];
  if (!q) return <Shell><p>Esta tentativa não tem questões.</p></Shell>;
  const a = answers[q.questionId] ?? EMPTY;
  const answeredCount = attempt.questions.filter((x) => hasContent(answers[x.questionId])).length;
  const state = saveState[q.questionId];
  const unanswered = attempt.total - answeredCount;

  return (
    <Shell>
      <div className="runner-head">
        <h1>{attempt.questionnaire.title}</h1>
        <p className="progress-line" aria-live="polite">
          Questão <strong>{index + 1}</strong> de {attempt.total} · {answeredCount} respondida{answeredCount === 1 ? "" : "s"}
        </p>
        <progress value={answeredCount} max={attempt.total} aria-label="Questões respondidas" />
      </div>

      {attempt.status === "COMPLETED" && (
        <div className="notice success" role="status">
          <strong>Tentativa concluída.</strong> Você respondeu {answeredCount} de {attempt.total} questões. Suas respostas estão registradas e não podem mais ser alteradas.{" "}
          <Link href="/">Voltar ao início</Link>
        </div>
      )}
      {attempt.status === "ABANDONED" && <div className="notice" role="status">Tentativa abandonada — somente leitura. <Link href="/">Voltar ao início</Link></div>}
      {offline && !readOnly && <div className="notice warn" role="alert">Sem conexão. Suas respostas serão enviadas assim que a internet voltar.</div>}

      <nav className="qnav" aria-label="Navegação entre questões">
        {attempt.questions.map((x, i) => (
          <button
            key={x.questionId}
            className={`qdot ${i === index ? "current" : ""} ${hasContent(answers[x.questionId]) ? "done" : ""} ${saveState[x.questionId] === "error" ? "err" : ""}`}
            aria-current={i === index ? "step" : undefined}
            aria-label={`Questão ${i + 1}${hasContent(answers[x.questionId]) ? ", respondida" : ""}${saveState[x.questionId] === "error" ? ", falha ao salvar" : ""}`}
            onClick={() => void goTo(i)}
          >
            {i + 1}
          </button>
        ))}
      </nav>

      <article className="card question" key={q.questionId}>
        <RichContent content={q.content} />

        {q.items.length > 0 && q.type === "ASSERTIONS" && (
          <ol className="assertions" aria-label="Assertivas">
            {q.items.map((it) => (
              <li key={it.id}><span className="letter">{it.label}.</span> {it.text}</li>
            ))}
          </ol>
        )}

        {q.type === "OPEN" && (
          <div className="field">
            <label htmlFor="resposta">Sua resposta</label>
            <textarea
              id="resposta"
              rows={6}
              maxLength={10000}
              value={a.text}
              readOnly={readOnly}
              onChange={(e) => change(q, { ...a, text: e.target.value }, false)}
              onBlur={() => !readOnly && timers.current.has(q.questionId) && void save(q.questionId)}
            />
          </div>
        )}

        {q.type === "TRUE_FALSE" && (
          <fieldset className="alts" disabled={readOnly}>
            <legend>Marque Verdadeiro ou Falso em cada afirmação</legend>
            {q.items.map((it) => {
              const current = a.items.find((x) => x.itemId === it.id)?.value;
              const set = (value: boolean) =>
                change(q, { ...a, items: [...a.items.filter((x) => x.itemId !== it.id), { itemId: it.id, value }] }, true);
              return (
                <div key={it.id} className="alt tf">
                  <span className="letter" aria-hidden="true">{it.label}</span>
                  <span style={{ flex: 1 }} id={`tf-${it.id}`}>{it.text}</span>
                  <span className="row" role="radiogroup" aria-labelledby={`tf-${it.id}`}>
                    <label className="inline"><input type="radio" name={`tf-${it.id}`} checked={current === true} onChange={() => set(true)} /> V</label>
                    <label className="inline"><input type="radio" name={`tf-${it.id}`} checked={current === false} onChange={() => set(false)} /> F</label>
                  </span>
                </div>
              );
            })}
          </fieldset>
        )}

        {(q.type === "SINGLE" || q.type === "MULTIPLE" || q.type === "ASSERTIONS") && (
          <fieldset className="alts" disabled={readOnly}>
            <legend>{q.type === "MULTIPLE" ? "Selecione uma ou mais alternativas" : "Selecione uma alternativa"}</legend>
            {q.alternatives.map((alt) => {
              const checked = a.alternativeIds.includes(alt.id);
              const exclusive = q.type !== "MULTIPLE";
              return (
                <label key={alt.id} className={`alt ${checked ? "checked" : ""}`}>
                  <input
                    type={exclusive ? "radio" : "checkbox"}
                    name={`alt-${q.questionId}`}
                    checked={checked}
                    onChange={() =>
                      change(q, { ...a, alternativeIds: exclusive ? [alt.id] : checked ? a.alternativeIds.filter((x) => x !== alt.id) : [...a.alternativeIds, alt.id] }, true)
                    }
                  />
                  <span className="letter" aria-hidden="true">{alt.label}</span>
                  <span>{alt.text}</span>
                </label>
              );
            })}
          </fieldset>
        )}

        {!readOnly && (
          <p className={`save-badge ${state ?? ""}`} role="status" aria-live="polite">
            {state === "saving" && "Salvando…"}
            {state === "saved" && "✓ Resposta salva"}
            {state === "error" && (
              <>
                Não foi possível salvar. <button className="link" onClick={() => void save(q.questionId)}>Tentar novamente</button>
              </>
            )}
          </p>
        )}
      </article>

      <div className="runner-actions">
        <button className="btn ghost" disabled={index === 0} onClick={() => void goTo(index - 1)}>← Anterior</button>
        {index < attempt.total - 1 ? (
          <button className="btn" onClick={() => void goTo(index + 1)}>Próxima →</button>
        ) : !readOnly ? (
          <button className="btn" onClick={() => setConfirm("finish")}>Concluir</button>
        ) : null}
      </div>

      {!readOnly && (
        <div className="runner-foot">
          <button className="link" onClick={() => setConfirm("finish")}>Concluir questionário</button>
          <button className="link danger" onClick={() => setConfirm("abandon")}>Abandonar tentativa</button>
        </div>
      )}

      {confirm && (
        <div className="notice" role="alertdialog" aria-labelledby="confirm-title">
          <p id="confirm-title">
            {confirm === "finish"
              ? unanswered > 0
                ? `Você deixou ${unanswered} questão${unanswered === 1 ? "" : "ões"} sem resposta. Concluir mesmo assim? Depois não será possível alterar.`
                : "Concluir o questionário? Depois não será possível alterar as respostas."
              : "Abandonar esta tentativa? As respostas ficam guardadas no histórico, mas você não poderá continuá-la."}
          </p>
          <button className="btn" disabled={busy} onClick={() => void finish(confirm === "finish" ? "complete" : "abandon")}>
            {busy ? "Aguarde…" : confirm === "finish" ? "Concluir" : "Abandonar"}
          </button>{" "}
          <button className="btn ghost" disabled={busy} onClick={() => setConfirm(null)}>Voltar</button>
        </div>
      )}
      {actionError && <p className="field-error" role="alert">{actionError}</p>}
    </Shell>
  );
}
