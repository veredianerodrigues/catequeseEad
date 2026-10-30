"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TYPE_LABELS, type QuestionType } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { ShareBox } from "@/components/ShareBox";

type QItem = { id: string; title: string; type: string; status: "DRAFT" | "PUBLISHED"; subject?: { name: string } };
type Subject = { id: string; name: string; status: "ACTIVE" | "INACTIVE"; questionCount: number };
type DrawResult = { questions: QItem[]; shortages: { subjectId: string; requested: number; got: number }[] };
type Loaded = { id: string; title: string; description: string; status: "DRAFT" | "PUBLISHED"; shuffleAlternatives: boolean; listed: boolean; shareCode: string; questions: { question: QItem }[] };

export default function QuestionnaireEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();

  const [ready, setReady] = useState(isNew);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  const [shuffleAlternatives, setShuffle] = useState(false);
  const [listed, setListed] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [selected, setSelected] = useState<QItem[]>([]);
  const [available, setAvailable] = useState<QItem[]>([]);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [rules, setRules] = useState<{ subjectId: string; count: number }[]>([{ subjectId: "", count: 5 }]);
  const [drawMsg, setDrawMsg] = useState<string | null>(null);

  useEffect(() => void api.get<Subject[]>("/admin/subjects?status=ACTIVE").then(setSubjects).catch(() => undefined), []);

  async function draw() {
    setDrawMsg(null);
    const valid = rules.filter((r) => r.subjectId && r.count > 0);
    if (!valid.length) return setDrawMsg("Escolha um assunto e a quantidade.");
    try {
      const r = await api.post<DrawResult>("/admin/questionnaires/draw", { rules: valid, excludeIds: selected.map((s) => s.id) });
      setSelected((p) => [...p, ...r.questions]);
      const short = r.shortages.map((x) => `${subjects.find((s) => s.id === x.subjectId)?.name ?? "assunto"}: pedidas ${x.requested}, disponíveis ${x.got}`);
      setDrawMsg(`${r.questions.length} questões sorteadas e adicionadas.${short.length ? ` Faltaram — ${short.join("; ")}.` : ""}`);
    } catch (e) {
      setDrawMsg(errorLines(e)[0] ?? "Erro ao sortear.");
    }
  }

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
      setShareCode(q.shareCode);
        setShuffle(q.shuffleAlternatives);
        setListed(q.listed);
        setShareCode(q.shareCode);
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
    const body = { title, description, status: nextStatus, shuffleAlternatives, listed, questionIds: selected.map((s) => s.id) };
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

        <label className="inline"><input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} /> Listar na página inicial de todos os participantes <span className="hint">(desmarcado: só quem tiver o link acessa)</span></label>

        {!isNew && shareCode && <ShareBox id={id} shareCode={shareCode} published={status === "PUBLISHED"} onChange={setShareCode} />}

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
                  <span>{a.title} <span className="hint">{TYPE_LABELS[a.type as QuestionType] ?? a.type}</span> {a.status === "DRAFT" && <span className="tag">rascunho</span>}</span>
                  <button type="button" className="btn small ghost" onClick={() => setSelected((p) => [...p, a])}>Adicionar</button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card stack" aria-labelledby="sort">
          <h2 id="sort" style={{ margin: 0 }}>Sortear por assunto</h2>
          <p className="hint">Adiciona questões publicadas ao questionário, sem repetir as que já estão nele. Só entram assuntos ativos.</p>
          {rules.map((r, i) => (
            <div key={i} className="alt-row">
              <select aria-label="Assunto" value={r.subjectId} onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, subjectId: e.target.value } : x)))}>
                <option value="">Assunto…</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input aria-label="Quantidade" type="number" min={1} max={200} value={r.count} style={{ width: "6rem", flex: "none" }} onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) } : x)))} />
              {rules.length > 1 && <button type="button" className="btn small ghost" aria-label="Remover regra" onClick={() => setRules((p) => p.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn small ghost" onClick={() => setRules((p) => [...p, { subjectId: "", count: 5 }])}>+ Outro assunto</button>
            <button type="button" className="btn small" onClick={() => void draw()}>Sortear e adicionar</button>
          </div>
          {drawMsg && <p role="status" className="hint">{drawMsg}</p>}
        </section>

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
