"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { QuestionStatus, QuestionType } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { RichEditor } from "@/components/RichEditor";
import { RichContent } from "@/components/RichContent";

type Alt = { id?: string; key: string; text: string; isCorrect: boolean };
type Category = { id: string; name: string };
type Loaded = {
  id: string;
  type: QuestionType;
  status: QuestionStatus;
  title: string;
  content: object;
  categoryId: string | null;
  alternatives: { id: string; text: string; isCorrect: boolean }[];
};

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
let keySeq = 0;
const newKey = () => `k${++keySeq}`;

export default function QuestionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();

  const [ready, setReady] = useState(isNew);
  const [type, setType] = useState<QuestionType>("MULTIPLE");
  const [status, setStatus] = useState<QuestionStatus>("DRAFT");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<object>(EMPTY_DOC);
  const [initialContent, setInitialContent] = useState<object>(EMPTY_DOC);
  const [categoryId, setCategoryId] = useState("");
  const [alts, setAlts] = useState<Alt[]>(() => [0, 1].map(() => ({ key: newKey(), text: "", isCorrect: false })));
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void api.get<Category[]>("/admin/categories").then(setCategories).catch(() => undefined), []);

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
        setCategoryId(q.categoryId ?? "");
        setAlts(q.alternatives.map((a) => ({ ...a, key: newKey() })));
        setReady(true);
      })
      .catch((e) => setErrors(errorLines(e)));
  }, [id, isNew]);

  async function save(nextStatus: QuestionStatus) {
    setBusy(true);
    setErrors([]);
    setSaved(null);
    const body = {
      type,
      status: nextStatus,
      title,
      content,
      categoryId: categoryId || null,
      alternatives: type === "MULTIPLE" ? alts.map(({ id, text, isCorrect }) => ({ id, text, isCorrect })) : [],
    };
    try {
      const q = isNew ? await api.post<Loaded>("/admin/questions", body) : await api.put<Loaded>(`/admin/questions/${id}`, body);
      setStatus(q.status);
      setAlts(q.alternatives.map((a) => ({ ...a, key: newKey() })));
      setSaved(nextStatus === "PUBLISHED" ? "Questão publicada." : "Rascunho salvo.");
      if (isNew) router.replace(`/admin/questions/${q.id}`);
    } catch (e) {
      setErrors(errorLines(e));
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    try {
      const c = await api.post<Category>("/admin/categories", { name: newCategory });
      setCategories((p) => [...p, c].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(c.id);
      setNewCategory("");
    } catch (e) {
      setErrors(errorLines(e));
    }
  }

  const updateAlt = (key: string, patch: Partial<Alt>) => setAlts((p) => p.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const move = (i: number, d: -1 | 1) =>
    setAlts((p) => {
      const n = [...p];
      const j = i + d;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  if (!ready) {
    return (
      <Shell adminOnly>
        {errors.length ? <p className="field-error" role="alert">{errors[0]}</p> : <p className="hint" role="status">Carregando…</p>}
      </Shell>
    );
  }

  return (
    <Shell adminOnly>
      <h1>{isNew ? "Nova questão" : "Editar questão"}</h1>

      <form onSubmit={(e) => e.preventDefault()} className="stack">
        <div className="field">
          <label htmlFor="title">Título (uso interno)</label>
          <input id="title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid2">
          <fieldset className="field">
            <legend>Tipo</legend>
            <label className="inline"><input type="radio" name="type" checked={type === "OPEN"} onChange={() => setType("OPEN")} /> Resposta aberta</label>
            <label className="inline"><input type="radio" name="type" checked={type === "MULTIPLE"} onChange={() => setType("MULTIPLE")} /> Múltipla resposta</label>
          </fieldset>
          <div className="field">
            <label htmlFor="cat">Categoria</label>
            <select id="cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sem categoria</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="row">
              <input aria-label="Nova categoria" placeholder="Nova categoria" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
              <button type="button" className="btn small ghost" onClick={() => void addCategory()}>Criar</button>
            </div>
          </div>
        </div>

        <div className="field">
          <div className="row between">
            <span className="label">Enunciado</span>
            <button type="button" className="link" onClick={() => setPreview((p) => !p)}>{preview ? "Voltar a editar" : "Pré-visualizar"}</button>
          </div>
          {preview ? (
            <div className="card preview">
              <RichContent content={content} />
              {type === "MULTIPLE" && (
                <ul className="alts">
                  {alts.map((a, i) => (
                    <li key={a.key} className={`alt ${a.isCorrect ? "checked" : ""}`}>
                      <span className="letter">{String.fromCharCode(65 + i)}</span>
                      <span>{a.text}</span>
                      {a.isCorrect && <span className="tag ok">correta</span>}
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

        {type === "MULTIPLE" && !preview && (
          <fieldset className="field">
            <legend>Alternativas <span className="hint">(marque todas as corretas)</span></legend>
            {alts.map((a, i) => (
              <div key={a.key} className="alt-row">
                <span className="letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <input aria-label={`Texto da alternativa ${String.fromCharCode(65 + i)}`} value={a.text} onChange={(e) => updateAlt(a.key, { text: e.target.value })} />
                <label className="inline"><input type="checkbox" checked={a.isCorrect} onChange={(e) => updateAlt(a.key, { isCorrect: e.target.checked })} /> Correta</label>
                <button type="button" className="btn small ghost" aria-label="Mover para cima" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn small ghost" aria-label="Mover para baixo" disabled={i === alts.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn small ghost" aria-label="Remover alternativa" onClick={() => setAlts((p) => p.filter((x) => x.key !== a.key))}>✕</button>
              </div>
            ))}
            {alts.length < 10 && <button type="button" className="btn small ghost" onClick={() => setAlts((p) => [...p, { key: newKey(), text: "", isCorrect: false }])}>+ Adicionar alternativa</button>}
          </fieldset>
        )}

        {errors.length > 0 && (
          <div className="field-error" role="alert">
            <ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
        {saved && <p className="notice success" role="status">{saved}</p>}

        <div className="row">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void save("DRAFT")}>
            {status === "PUBLISHED" ? "Voltar para rascunho" : "Salvar rascunho"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save("PUBLISHED")}>
            {status === "PUBLISHED" ? "Salvar alterações" : "Publicar"}
          </button>
          <span className={`tag ${status === "PUBLISHED" ? "ok" : ""}`}>{status === "PUBLISHED" ? "Publicada" : "Rascunho"}</span>
        </div>
      </form>
    </Shell>
  );
}
