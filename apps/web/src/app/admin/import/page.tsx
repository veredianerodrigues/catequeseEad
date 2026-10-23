"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { normalizeStatement, QUESTION_TYPES, TYPE_LABELS, validateDraft, type ImportDraft, type QuestionType } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";

type Subject = { id: string; name: string; status: "ACTIVE" | "INACTIVE" };
type Draft = ImportDraft & { include: boolean };
type Preview = { fileName: string; subjectName: string | null; suggestedSubjectId: string | null; drafts: ImportDraft[] };
type Result = { created: number; createdKeys: string[]; skipped: { key: string; reasons: string[] }[] };

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
let manualSeq = 0;
const blankDraft = (): Draft => ({
  key: `m${++manualSeq}`, ref: null, type: "SINGLE", rawType: "", statement: "", items: [], alternatives: [{ text: "", isCorrect: false }, { text: "", isCorrect: false }],
  expectedAnswer: "", explanation: "", parseErrors: [], include: true,
});

export default function ImportPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dbDup, setDbDup] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadSubjects = () => api.get<Subject[]>("/admin/subjects").then(setSubjects).catch(() => undefined);
  useEffect(() => void loadSubjects(), []);

  // Análise de cada rascunho: erros de validação + repetidas (no arquivo ou já gravadas no assunto).
  const analysis = useMemo(() => {
    const seen = new Map<string, string>();
    return Object.fromEntries(
      drafts.map((d) => {
        const norm = normalizeStatement(d.statement);
        const errors = validateDraft(d);
        let dup: string | null = null;
        if (norm) {
          if (seen.has(norm)) dup = "Repetida no arquivo.";
          else seen.set(norm, d.key);
        }
        if (!dup && dbDup[d.key]) dup = "Já existe neste assunto.";
        return [d.key, { errors, dup, valid: errors.length === 0 && !dup }];
      }),
    );
  }, [drafts, dbDup]);

  // Consulta o banco por repetidas (ao trocar o assunto ou editar enunciados).
  const statementsKey = drafts.map((d) => d.statement).join("\u0000");
  useEffect(() => {
    if (!subjectId || drafts.length === 0) return setDbDup({});
    const t = setTimeout(() => {
      api
        .post<{ existing: boolean[] }>("/admin/import/check", { subjectId, statements: drafts.map((d) => d.statement) })
        .then((r) => setDbDup(Object.fromEntries(drafts.map((d, i) => [d.key, r.existing[i] ?? false]))))
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, statementsKey]);

  const counts = {
    valid: drafts.filter((d) => analysis[d.key]?.valid).length,
    invalid: drafts.filter((d) => analysis[d.key]?.errors.length).length,
    dup: drafts.filter((d) => analysis[d.key]?.dup).length,
  };
  const toImport = drafts.filter((d) => d.include && analysis[d.key]?.valid);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErrors([]);
    setResult(null);
    try {
      const p = await api.upload<Preview>("/admin/import/preview", file);
      setPreview(p);
      setDrafts(p.drafts.map((d) => ({ ...d, include: true })));
      setDbDup({});
      setOpen(null);
      if (p.suggestedSubjectId) setSubjectId(p.suggestedSubjectId);
    } catch (e) {
      setErrors(errorLines(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function createSuggested() {
    if (!preview?.subjectName) return;
    try {
      const s = await api.post<Subject>("/admin/subjects", { name: preview.subjectName, description: "", status: "ACTIVE" });
      await loadSubjects();
      setSubjectId(s.id);
    } catch (e) {
      setErrors(errorLines(e));
    }
  }

  const patch = (key: string, p: Partial<Draft>) => setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...p } : d)));
  /** Alterar tipo/resposta corrige o motivo detectado na leitura. */
  const edit = (key: string, p: Partial<Draft>) => patch(key, { ...p, parseErrors: [] });

  async function commit() {
    setBusy(true);
    setErrors([]);
    try {
      const questions = toImport.map(({ include: _i, ref: _r, rawType: _t, parseErrors: _p, ...q }) => q);
      const r = await api.post<Result>("/admin/import/commit", { subjectId, status: publish ? "PUBLISHED" : "DRAFT", questions });
      setResult(r);
      const done = new Set(r.createdKeys);
      setDrafts((all) => all.filter((d) => !done.has(d.key)));
      void loadSubjects();
    } catch (e) {
      setErrors(errorLines(e));
    } finally {
      setBusy(false);
    }
  }

  const activeSubjects = subjects.filter((s) => s.status === "ACTIVE");
  const suggestedMissing = preview?.subjectName && !preview.suggestedSubjectId;

  return (
    <Shell adminOnly>
      <h1>Importar questões</h1>
      <p className="hint">Envie um arquivo .md, .docx ou .doc no modelo (Assunto, Questão n, Tipo, Enunciado, Itens, Alternativas, Resposta, Explicação). Nada é gravado antes da sua confirmação. <a href="/modelo-importacao.md" download>Baixar arquivo de exemplo</a>.</p>

      <div className="card stack">
        <div className="field">
          <label htmlFor="file">Arquivo</label>
          <input id="file" ref={fileInput} type="file" accept=".md,.txt,.docx,.doc" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        <div className="field">
          <label htmlFor="isubject">Assunto de destino</label>
          <select id="isubject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Selecione…</option>
            {activeSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {preview?.subjectName && preview.suggestedSubjectId && <span className="hint">O arquivo indica o assunto “{preview.subjectName}”; você pode trocar.</span>}
          {suggestedMissing && (
            <span className="hint">
              O arquivo indica o assunto “{preview.subjectName}”, que não está cadastrado.{" "}
              <button type="button" className="link" onClick={() => void createSuggested()}>Criar este assunto</button> ou escolha outro. <Link href="/admin/subjects">Gerenciar assuntos</Link>
            </span>
          )}
        </div>
      </div>

      {errors.length > 0 && <div className="field-error" role="alert"><ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}

      {result && (
        <div className="notice success" role="status">
          <strong>{result.created} {result.created === 1 ? "questão importada" : "questões importadas"}.</strong>
          {result.skipped.length > 0 && <> {result.skipped.length} não {result.skipped.length === 1 ? "foi importada" : "foram importadas"}: {result.skipped.map((s) => `${s.key} (${s.reasons.join("; ")})`).join(" · ")}</>}
        </div>
      )}

      {(preview || drafts.length > 0) && (
        <section aria-labelledby="pre">
          <h2 id="pre">Pré-visualização{preview ? ` — ${preview.fileName}` : ""}</h2>
          <p role="status" aria-live="polite">
            <span className="tag ok">{counts.valid} válidas</span> <span className="tag">{counts.invalid} com erro</span> <span className="tag">{counts.dup} repetidas</span>
          </p>

          <ul className="list">
            {drafts.map((d, idx) => {
              const a = analysis[d.key]!;
              const isOpen = open === d.key;
              return (
                <li key={d.key} className={a.valid ? "" : "invalid"}>
                  <div className="row between">
                    <label className="inline">
                      <input type="checkbox" checked={d.include && a.valid} disabled={!a.valid} onChange={(e) => patch(d.key, { include: e.target.checked })} aria-label={`Importar questão ${idx + 1}`} />
                      <strong>{d.ref ?? idx + 1}.</strong>
                      <span className="hint">{d.type ? TYPE_LABELS[d.type] : `Tipo “${d.rawType || "—"}”`}</span>
                    </label>
                    <span className="row">
                      {a.valid ? <span className="tag ok">Válida</span> : a.errors.length ? <span className="tag">{a.errors.length} problema{a.errors.length > 1 ? "s" : ""}</span> : <span className="tag">{a.dup}</span>}
                      <button type="button" className="link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.key)}>{isOpen ? "Fechar" : "Editar"}</button>
                      <button type="button" className="link danger" onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}>Excluir</button>
                    </span>
                  </div>
                  <p style={{ margin: ".25rem 0" }}>{d.statement.slice(0, 160) || <em className="hint">(sem enunciado)</em>}{d.statement.length > 160 ? "…" : ""}</p>
                  {(a.errors.length > 0 || a.dup) && (
                    <ul className="field-error" style={{ margin: 0, paddingLeft: "1.2rem" }}>
                      {a.errors.map((m, i) => <li key={i}>{m}</li>)}
                      {a.dup && <li>{a.dup}</li>}
                    </ul>
                  )}
                  {isOpen && <DraftEditor d={d} onEdit={(p) => edit(d.key, p)} />}
                </li>
              );
            })}
          </ul>

          <div className="row">
            <button type="button" className="btn ghost small" onClick={() => { const b = blankDraft(); setDrafts((all) => [...all, b]); setOpen(b.key); }}>+ Adicionar questão manualmente</button>
          </div>

          <div className="card stack" style={{ marginTop: "1rem" }}>
            <label className="inline"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publicar as questões importadas (senão entram como rascunho)</label>
            <div className="row">
              <button className="btn" disabled={busy || !subjectId || toImport.length === 0} onClick={() => void commit()}>
                {busy ? "Importando…" : `Importar ${toImport.length} ${toImport.length === 1 ? "questão válida" : "questões válidas"}`}
              </button>
              {!subjectId && <span className="hint">Escolha o assunto de destino.</span>}
            </div>
          </div>
        </section>
      )}
    </Shell>
  );
}

function DraftEditor({ d, onEdit }: { d: Draft; onEdit: (p: Partial<Draft>) => void }) {
  const type = d.type;
  const hasAlts = type === "SINGLE" || type === "MULTIPLE" || type === "ASSERTIONS";
  const hasItems = type === "ASSERTIONS" || type === "TRUE_FALSE";
  const exclusive = type === "SINGLE" || type === "ASSERTIONS";
  const itemLabel = (i: number) => (type === "ASSERTIONS" ? (ROMAN[i] ?? String(i + 1)) : String(i + 1));
  const setAlt = (i: number, p: Partial<Draft["alternatives"][number]>) => onEdit({ alternatives: d.alternatives.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const setCorrect = (i: number, checked: boolean) => onEdit({ alternatives: d.alternatives.map((a, j) => (j === i ? { ...a, isCorrect: checked } : exclusive && checked ? { ...a, isCorrect: false } : a)) });
  const setItem = (i: number, p: Partial<Draft["items"][number]>) => onEdit({ items: d.items.map((a, j) => (j === i ? { ...a, ...p } : a)) });

  return (
    <div className="stack" style={{ marginTop: ".75rem" }}>
      <div className="field">
        <label>Tipo
          <select value={d.type ?? ""} onChange={(e) => onEdit({ type: (e.target.value || null) as QuestionType | null })}>
            <option value="">Selecione…</option>
            {QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </label>
      </div>
      <div className="field">
        <label>Enunciado<textarea rows={4} value={d.statement} onChange={(e) => onEdit({ statement: e.target.value })} /></label>
      </div>

      {hasItems && (
        <fieldset className="field">
          <legend>{type === "ASSERTIONS" ? "Assertivas" : "Afirmações"}</legend>
          {d.items.map((it, i) => (
            <div key={i} className="alt-row">
              <span className="letter" aria-hidden="true">{itemLabel(i)}</span>
              <input aria-label={`Texto do item ${itemLabel(i)}`} value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} />
              {type === "TRUE_FALSE" && (
                <select aria-label={`Gabarito do item ${itemLabel(i)}`} value={it.isTrue ? "V" : "F"} onChange={(e) => setItem(i, { isTrue: e.target.value === "V" })} style={{ width: "5rem" }}>
                  <option value="V">V</option>
                  <option value="F">F</option>
                </select>
              )}
              <button type="button" className="btn small ghost" aria-label="Remover item" onClick={() => onEdit({ items: d.items.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          {d.items.length < 20 && <button type="button" className="btn small ghost" onClick={() => onEdit({ items: [...d.items, { text: "", isTrue: false }] })}>+ Item</button>}
        </fieldset>
      )}

      {hasAlts && (
        <fieldset className="field">
          <legend>Alternativas</legend>
          {d.alternatives.map((a, i) => (
            <div key={i} className="alt-row">
              <span className="letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
              <input aria-label={`Texto da alternativa ${String.fromCharCode(65 + i)}`} value={a.text} onChange={(e) => setAlt(i, { text: e.target.value })} />
              <label className="inline"><input type={exclusive ? "radio" : "checkbox"} name={`correct-${d.key}`} checked={a.isCorrect} onChange={(e) => setCorrect(i, e.target.checked)} /> Correta</label>
              <button type="button" className="btn small ghost" aria-label="Remover alternativa" onClick={() => onEdit({ alternatives: d.alternatives.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          {d.alternatives.length < 10 && <button type="button" className="btn small ghost" onClick={() => onEdit({ alternatives: [...d.alternatives, { text: "", isCorrect: false }] })}>+ Alternativa</button>}
        </fieldset>
      )}

      {type === "OPEN" && <div className="field"><label>Resposta esperada<textarea rows={2} value={d.expectedAnswer} onChange={(e) => onEdit({ expectedAnswer: e.target.value })} /></label></div>}
      <div className="field"><label>Explicação<textarea rows={2} value={d.explanation} onChange={(e) => onEdit({ explanation: e.target.value })} /></label></div>
    </div>
  );
}
