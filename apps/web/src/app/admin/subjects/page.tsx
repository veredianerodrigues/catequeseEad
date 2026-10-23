"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorLines } from "@/lib/api";
import { Shell } from "@/components/Shell";

type Subject = { id: string; name: string; description: string | null; status: "ACTIVE" | "INACTIVE"; questionCount: number };
type Form = { id?: string; name: string; description: string; status: "ACTIVE" | "INACTIVE" };
const EMPTY: Form = { name: "", description: "", status: "ACTIVE" };

export default function SubjectsPage() {
  const [items, setItems] = useState<Subject[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (status) qs.set("status", status);
    try {
      setItems(await api.get<Subject[]>(`/admin/subjects?${qs}`));
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro ao carregar.");
    }
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function submit() {
    if (!form) return;
    setErrors([]);
    const body = { name: form.name, description: form.description, status: form.status };
    try {
      if (form.id) await api.put(`/admin/subjects/${form.id}`, body);
      else await api.post("/admin/subjects", body);
      setForm(null);
      await load();
    } catch (e) {
      setErrors(errorLines(e));
    }
  }

  async function toggle(s: Subject) {
    try {
      await api.put(`/admin/subjects/${s.id}`, { name: s.name, description: s.description ?? "", status: s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      setError(null);
      await load();
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro");
    }
  }

  async function remove(s: Subject) {
    if (!window.confirm(`Excluir o assunto "${s.name}"?`)) return;
    try {
      await api.del(`/admin/subjects/${s.id}`);
      setError(null);
      await load();
    } catch (e) {
      setError(errorLines(e)[0] ?? "Erro");
    }
  }

  return (
    <Shell adminOnly>
      <div className="row between">
        <h1>Assuntos</h1>
        <button className="btn" onClick={() => { setForm(EMPTY); setErrors([]); }}>Novo assunto</button>
      </div>

      {form && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={form.id ? "Editar assunto" : "Novo assunto"}>
          <div className="field"><label htmlFor="sname">Nome</label><input id="sname" value={form.name} maxLength={100} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="sdesc">Descrição (opcional)</label><textarea id="sdesc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="sstatus">Status</label>
            <select id="sstatus" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Form["status"] })}>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
          </div>
          {errors.length > 0 && <div className="field-error" role="alert"><ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
          <div className="row">
            <button className="btn" type="submit">Salvar</button>
            <button className="btn ghost" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <label>Buscar<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do assunto" /></label>
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option></select></label>
      </form>

      {error && <p className="field-error" role="alert">{error}</p>}
      {items?.length === 0 && <p className="hint">Nenhum assunto encontrado.</p>}
      <ul className="list rows">
        {items?.map((s) => (
          <li key={s.id}>
            <span style={{ flex: 1, minWidth: "12rem" }}>
              <strong>{s.name}</strong> <span className="hint">{s.questionCount} {s.questionCount === 1 ? "questão" : "questões"}</span>
              {s.description && <span className="hint" style={{ display: "block" }}>{s.description}</span>}
            </span>
            <span className={`tag ${s.status === "ACTIVE" ? "ok" : ""}`}>{s.status === "ACTIVE" ? "Ativo" : "Inativo"}</span>
            <button className="link" onClick={() => { setForm({ id: s.id, name: s.name, description: s.description ?? "", status: s.status }); setErrors([]); }}>Editar</button>
            <button className="link" onClick={() => void toggle(s)}>{s.status === "ACTIVE" ? "Inativar" : "Ativar"}</button>
            {s.questionCount === 0 && <button className="link danger" onClick={() => void remove(s)}>Excluir</button>}
          </li>
        ))}
      </ul>
    </Shell>
  );
}
