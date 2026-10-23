"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { QUESTION_TYPES, TYPE_LABELS, type QuestionStatus, type QuestionType } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { RichEditor } from "@/components/RichEditor";
import { RichContent } from "@/components/RichContent";

type Alt = { id?: string; key: string; text: string; isCorrect: boolean };
type Item = { id?: string; key: string; text: string; isTrue: boolean };
type Subject = { id: string; name: string; status: "ACTIVE" | "INACTIVE" };
type Loaded = {
  id: string;
  type: QuestionType;
  status: QuestionStatus;
  title: string;
  content: object;
  subjectId: string;
  explanation: string | null;
  expectedAnswer: string | null;
  alternatives: { id: string; text: string; isCorrect: boolean }[];
  items: { id: string; text: string; isTrue: boolean | null }[];
};

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
let keySeq = 0;
const newKey = () => `k${++keySeq}`;
const blankAlts = (n = 2): Alt[] => Array.from({ length: n }, () => ({ key: newKey(), text: "", isCorrect: false }));
const blankItems = (n = 2): Item[] => Array.from({ length: n }, () => ({ key: newKey(), text: "", isTrue: false }));

export default function QuestionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();

  const [ready, setReady] = useState(isNew);
  const [type, setType] = useState<QuestionType>("SINGLE");
  const [status, setStatus] = useState<QuestionStatus>("DRAFT");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<object>(EMPTY_DOC);
  const [initialContent, setInitialContent] = useState<object>(EMPTY_DOC);
  const [subjectId, setSubjectId] = useState("");
  const [alts, setAlts] = useState<Alt[]>(() => blankAlts());
  const [items, setItems] = useState<Item[]>(() => blankItems());
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void api.get<Subject[]>("/admin/subjects").then(setSubjects).catch(() => undefined), []);

  useEffect(() => {
    if (isNew) return;
    api
      .get<Loaded>(`/admin/questions/${id}`)
      .then((q) => {
        setType(q.type);
        setStatus(q.status);
        setTitle(q.title);
        setContent(q.content);
        setInitialContent(q.content);
        setSubjectId(q.subjectId);
        setExpectedAnswer(q.expectedAnswer ?? "");
        setExplanation(q.explanation ?? "");
        setAlts(q.alternatives.length ? q.alternatives.map((a) => ({ ...a, key: newKey() })) : blankAlts());
        setItems(q.items.length ? q.items.map((i) => ({ ...i, isTrue: !!i.isTrue, key: newKey() })) : blankItems());
        setReady(true);
      })
      .catch((e) => setErrors(errorLines(e)));
  }, [id, isNew]);

  const hasAlts = type === "SINGLE" || type === "MULTIPLE" || type === "ASSERTIONS";
  const hasItems = type === "ASSERTIONS" || type === "TRUE_FALSE";
  const exclusive = type === "SINGLE" || type === "ASSERTIONS";
  const itemLabel = (i: number) => (type === "ASSERTIONS" ? (ROMAN[i] ?? String(i + 1)) : String(i + 1));

  async function save(nextStatus: QuestionStatus) {
    setBusy(true);
    setErrors([]);
    setSaved(null);
    const body = {
      type,
      status: nextStatus,
      title,
      content,
      subjectId,
      explanation,
      expectedAnswer: type === "OPEN" ? expectedAnswer : "",
      alternatives: hasAlts ? alts.map(({ id, text, isCorrect }) => ({ id, text, isCorrect })) : [],
      items: hasItems ? items.map(({ id, text, isTrue }) => ({ id, text, ...(type === "TRUE_FALSE" ? { isTrue } : {}) })) : [],
    };
    try {
      const q = isNew ? await api.post<Loaded>("/admin/questions", body) : await api.put<Loaded>(`/admin/questions/${id}`, body);
      setStatus(q.status);
      if (q.alternatives.length) setAlts(q.alternatives.map((a) => ({ ...a, key: newKey() })));
      if (q.items.length) setItems(q.items.map((i) => ({ ...i, isTrue: !!i.isTrue, key: newKey() })));
      setSaved(nextStatus === "PUBLISHED" ? "Questão publicada." : "Rascunho salvo.");
      if (isNew) router.replace(`/admin/questions/${q.id}`);
    } catch (e) {
      setErrors(errorLines(e));
    } finally {
      setBusy(false);
    }
  }

  const updateAlt = (key: string, patch: Partial<Alt>) => setAlts((p) => p.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const setCorrect = (key: string, checked: boolean) =>
    setAlts((p) => p.map((a) => (a.key === key ? { ...a, isCorrect: checked } : exclusive && checked ? { ...a, isCorrect: false } : a)));
  const updateItem = (key: string, patch: Partial<Item>) => setItems((p) => p.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  function move<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, d: -1 | 1) {
    setter((p) => {
      const n = [...p];
      const j = i + d;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  }

  if (!ready) {
    return <Shell adminOnly>{errors.length ? <p className="field-error" role="alert">{errors[0]}</p> : <p className="hint" role="status">Carregando…</p>}</Shell>;
  }

  const activeSubjects = subjects.filter((s) => s.status === "ACTIVE" || s.id === subjectId);

  return (
    <Shell adminOnly>
      <h1>{isNew ? "Nova questão" : "Editar questão"}</h1>

      <form onSubmit={(e) => e.preventDefault()} className="stack">
        <div className="grid2">
          <div className="field">
            <label htmlFor="subject">Assunto</label>
            <select id="subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Selecione…</option>
              {activeSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "INACTIVE" ? " (inativo)" : ""}</option>)}
            </select>
            {subjects.length === 0 && <span className="hint">Cadastre um assunto em <Link href="/admin/subjects">Assuntos</Link>.</span>}
          </div>
          <div className="field">
            <label htmlFor="type">Tipo</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
              {QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="title">Título interno <span className="hint">(opcional — se vazio, usa o início do enunciado)</span></label>
          <input id="title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <div className="row between">
            <span className="label">Enunciado</span>
            <button type="button" className="link" onClick={() => setPreview((p) => !p)}>{preview ? "Voltar a editar" : "Pré-visualizar"}</button>
          </div>
          {preview ? (
            <div className="card preview">
              <RichContent content={content} />
              {hasItems && (
                <ul className="alts">
                  {items.map((it, i) => (
                    <li key={it.key} className="alt"><span className="letter">{itemLabel(i)}</span><span>{it.text}</span>{type === "TRUE_FALSE" && <span className="tag ok">{it.isTrue ? "V" : "F"}</span>}</li>
                  ))}
                </ul>
              )}
              {hasAlts && (
                <ul className="alts">
                  {alts.map((a, i) => (
                    <li key={a.key} className={`alt ${a.isCorrect ? "checked" : ""}`}>
                      <span className="letter">{String.fromCharCode(65 + i)}</span><span>{a.text}</span>{a.isCorrect && <span className="tag ok">correta</span>}
                    </li>
                  ))}
                </ul>
              )}
              {type === "OPEN" && <textarea rows={4} disabled placeholder="Campo de resposta do participante" />}
            </div>
          ) : (
            <RichEditor initial={initialContent} onChange={setContent} />
          )}
        </div>

        {hasItems && !preview && (
          <fieldset className="field">
            <legend>{type === "ASSERTIONS" ? "Assertivas" : "Afirmações"} {type === "TRUE_FALSE" && <span className="hint">(marque o gabarito V ou F)</span>}</legend>
            {items.map((it, i) => (
              <div key={it.key} className="alt-row">
                <span className="letter" aria-hidden="true">{itemLabel(i)}</span>
                <input aria-label={`Texto do item ${itemLabel(i)}`} value={it.text} onChange={(e) => updateItem(it.key, { text: e.target.value })} />
                {type === "TRUE_FALSE" && (
                  <select aria-label={`Gabarito do item ${itemLabel(i)}`} value={it.isTrue ? "V" : "F"} onChange={(e) => updateItem(it.key, { isTrue: e.target.value === "V" })} style={{ width: "5rem" }}>
                    <option value="V">V</option>
                    <option value="F">F</option>
                  </select>
                )}
                <button type="button" className="btn small ghost" aria-label="Mover para cima" disabled={i === 0} onClick={() => move(setItems, i, -1)}>↑</button>
                <button type="button" className="btn small ghost" aria-label="Mover para baixo" disabled={i === items.length - 1} onClick={() => move(setItems, i, 1)}>↓</button>
                <button type="button" className="btn small ghost" aria-label="Remover item" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}>✕</button>
              </div>
            ))}
            {items.length < 20 && <button type="button" className="btn small ghost" onClick={() => setItems((p) => [...p, { key: newKey(), text: "", isTrue: false }])}>+ Adicionar item</button>}
          </fieldset>
        )}

        {hasAlts && !preview && (
          <fieldset className="field">
            <legend>{type === "ASSERTIONS" ? "Alternativas (combinações)" : "Alternativas"} <span className="hint">({exclusive ? "marque a correta" : "marque todas as corretas"})</span></legend>
            {alts.map((a, i) => (
              <div key={a.key} className="alt-row">
                <span className="letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <input aria-label={`Texto da alternativa ${String.fromCharCode(65 + i)}`} value={a.text} onChange={(e) => updateAlt(a.key, { text: e.target.value })} />
                <label className="inline">
                  <input type={exclusive ? "radio" : "checkbox"} name="correct" checked={a.isCorrect} onChange={(e) => setCorrect(a.key, e.target.checked)} /> Correta
                </label>
                <button type="button" className="btn small ghost" aria-label="Mover para cima" disabled={i === 0} onClick={() => move(setAlts, i, -1)}>↑</button>
                <button type="button" className="btn small ghost" aria-label="Mover para baixo" disabled={i === alts.length - 1} onClick={() => move(setAlts, i, 1)}>↓</button>
                <button type="button" className="btn small ghost" aria-label="Remover alternativa" onClick={() => setAlts((p) => p.filter((x) => x.key !== a.key))}>✕</button>
              </div>
            ))}
            {alts.length < 10 && <button type="button" className="btn small ghost" onClick={() => setAlts((p) => [...p, { key: newKey(), text: "", isCorrect: false }])}>+ Adicionar alternativa</button>}
          </fieldset>
        )}

        {type === "OPEN" && (
          <div className="field">
            <label htmlFor="expected">Resposta esperada <span className="hint">(só administradores veem)</span></label>
            <textarea id="expected" rows={3} value={expectedAnswer} onChange={(e) => setExpectedAnswer(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="explanation">Explicação <span className="hint">(só administradores veem)</span></label>
          <textarea id="explanation" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </div>

        {errors.length > 0 && <div className="field-error" role="alert"><ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
        {saved && <p className="notice success" role="status">{saved}</p>}

        <div className="row">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void save("DRAFT")}>{status === "PUBLISHED" ? "Voltar para rascunho" : "Salvar rascunho"}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save("PUBLISHED")}>{status === "PUBLISHED" ? "Salvar alterações" : "Publicar"}</button>
          <span className={`tag ${status === "PUBLISHED" ? "ok" : ""}`}>{status === "PUBLISHED" ? "Publicada" : "Rascunho"}</span>
        </div>
      </form>
    </Shell>
  );
}
