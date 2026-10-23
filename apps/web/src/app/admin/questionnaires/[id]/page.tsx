"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";

type QItem = { id: string; title: string; type: "OPEN" | "MULTIPLE"; status: "DRAFT" | "PUBLISHED" };
type Loaded = { id: string; title: string; description: string; status: "DRAFT" | "PUBLISHED"; shuffleAlternatives: boolean; questions: { question: QItem }[] };

export default function QuestionnaireEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();

  const [ready, setReady] = useState(isNew);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  const [shuffleAlternatives, setShuffle] = useState(false);
  const [selected, setSelected] = useState<QItem[]>([]);
  const [available, setAvailable] = useState<QItem[]>([]);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ pageSize: "50" });
      if (search) qs.set("q", search);
      api.get<{ items: QItem[] }>(`/admin/questions?${qs}`).then((r) => setAvailable(r.items)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (isNew) return;
    api
      .get<Loaded>(`/admin/questionnaires/${id}`)
      .then((q) => {
        setTitle(q.title);
        setDescription(q.description);
        setStatus(q.status);
        setShuffle(q.shuffleAlternatives);
        setSelected(q.questions.map((x) => x.question));
        setReady(true);
      })
      .catch((e) => setErrors(errorLines(e)));
  }, [id, isNew]);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const move = (i: number, d: -1 | 1) =>
    setSelected((p) => {
      const n = [...p];
      const j = i + d;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  async function save(nextStatus: "DRAFT" | "PUBLISHED") {
    setBusy(true);
    setErrors([]);
    setSaved(false);
    const body = { title, description, status: nextStatus, shuffleAlternatives, questionIds: selected.map((s) => s.id) };
    try {
      const q = isNew ? await api.post<Loaded>("/admin/questionnaires", body) : await api.put<Loaded>(`/admin/questionnaires/${id}`, body);
      setStatus(q.status);
      setSelected(q.questions.map((x) => x.question));
      setSaved(true);
      if (isNew) router.replace(`/admin/questionnaires/${q.id}`);
    } catch (e) {
      setErrors(errorLines(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Shell adminOnly>{errors.length ? <p className="field-error" role="alert">{errors[0]}</p> : <p className="hint" role="status">Carregando…</p>}</Shell>;

  return (
    <Shell adminOnly>
      <h1>{isNew ? "Novo questionário" : "Editar questionário"}</h1>
      <form className="stack" onSubmit={(e) => e.preventDefault()}>
        <div className="field"><label htmlFor="t">Título</label><input id="t" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="d">Descrição</label><textarea id="d" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="inline"><input type="checkbox" checked={shuffleAlternatives} onChange={(e) => setShuffle(e.target.checked)} /> Embaralhar também as alternativas</label>

        <div className="grid2">
          <section aria-labelledby="sel">
            <h2 id="sel">No questionário ({selected.length})</h2>
            <p className="hint">A ordem abaixo é a base; cada tentativa a embaralha.</p>
            <ol className="list rows">
              {selected.map((s, i) => (
                <li key={s.id}>
                  <span>{s.title} {s.status === "DRAFT" && <span className="tag">rascunho</span>}</span>
                  <span className="row">
                    <button type="button" className="btn small ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="btn small ghost" aria-label="Descer" disabled={i === selected.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="btn small ghost" aria-label="Remover" onClick={() => setSelected((p) => p.filter((x) => x.id !== s.id))}>✕</button>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="av">
            <h2 id="av">Adicionar questões</h2>
            <input type="search" aria-label="Buscar questões" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul className="list rows">
              {available.filter((a) => !selectedIds.has(a.id)).map((a) => (
                <li key={a.id}>
                  <span>{a.title} <span className="hint">{a.type === "OPEN" ? "aberta" : "múltipla"}</span> {a.status === "DRAFT" && <span className="tag">rascunho</span>}</span>
                  <button type="button" className="btn small ghost" onClick={() => setSelected((p) => [...p, a])}>Adicionar</button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {errors.length > 0 && <div className="field-error" role="alert"><ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
        {saved && <p className="notice success" role="status">Questionário salvo.</p>}
        <div className="row">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void save("DRAFT")}>{status === "PUBLISHED" ? "Voltar para rascunho" : "Salvar rascunho"}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save("PUBLISHED")}>{status === "PUBLISHED" ? "Salvar alterações" : "Publicar"}</button>
          <span className={`tag ${status === "PUBLISHED" ? "ok" : ""}`}>{status === "PUBLISHED" ? "Publicado" : "Rascunho"}</span>
        </div>
      </form>
    </Shell>
  );
}
