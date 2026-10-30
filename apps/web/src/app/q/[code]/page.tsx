"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, errorLines } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Shell } from "@/components/Shell";

type Info = { id: string; title: string; description: string; questionCount: number; inProgressAttemptId: string | null; completedCount: number };

/** Página aberta pelo link compartilhado do questionário (/q/<código>). */
export default function SharedQuestionnairePage() {
  const { code } = useParams<{ code: string }>();
  const { me } = useAuth();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return; // sem login o AuthProvider leva ao /login e volta para cá depois
    api
      .get<Info>(`/shared/${encodeURIComponent(code)}`)
      .then(setInfo)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setInvalid(true) : setError(errorLines(e)[0] ?? "Erro ao carregar.")));
  }, [code, me]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>(`/shared/${encodeURIComponent(code)}/attempts`);
      router.push(`/attempts/${r.id}`);
    } catch (e) {
      setError(errorLines(e)[0] ?? "Não foi possível iniciar.");
      setBusy(false);
    }
  }

  return (
    <Shell>
      {invalid && (
        <div className="card" role="alert">
          <h1>Link indisponível</h1>
          <p>Este link não é válido ou o questionário não está mais disponível. Peça um novo link a quem o enviou.</p>
          <Link className="btn ghost" href="/">Ir para o início</Link>
        </div>
      )}
      {!invalid && !info && !error && <p className="hint" role="status">Carregando…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {info && (
        <div className="card" style={{ alignItems: "stretch" }}>
          <h1 style={{ margin: 0 }}>{info.title}</h1>
          {info.description && <p style={{ whiteSpace: "pre-wrap" }}>{info.description}</p>}
          <p className="hint">{info.questionCount} {info.questionCount === 1 ? "questão" : "questões"} · suas respostas são salvas automaticamente e você pode continuar depois.</p>
          {info.completedCount > 0 && <p className="notice success" role="status">Você já concluiu este questionário {info.completedCount === 1 ? "uma vez" : `${info.completedCount} vezes`}.</p>}
          <div className="row">
            {info.inProgressAttemptId ? (
              <>
                <Link className="btn" href={`/attempts/${info.inProgressAttemptId}`}>Continuar de onde parei</Link>
                <button className="btn ghost" disabled={busy} onClick={() => void start()}>Começar uma nova tentativa</button>
              </>
            ) : (
              <button className="btn" disabled={busy} onClick={() => void start()}>{busy ? "Iniciando…" : info.completedCount > 0 ? "Responder novamente" : "Iniciar"}</button>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
