"use client";

import { useState } from "react";
import { api, errorLines } from "@/lib/api";
import { copyText, shareUrl } from "@/lib/clipboard";

/** Link de compartilhamento do questionário: copiar e gerar novo código. */
export function ShareBox({ id, shareCode, published, onChange }: { id: string; shareCode: string; published: boolean; onChange: (code: string) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = typeof window === "undefined" ? `/q/${shareCode}` : shareUrl(shareCode);

  async function copy() {
    setMsg((await copyText(url)) ? "Link copiado." : "Não foi possível copiar; selecione o link e copie manualmente.");
  }

  async function regenerate() {
    setBusy(true);
    try {
      const r = await api.post<{ shareCode: string }>(`/admin/questionnaires/${id}/share-code`);
      onChange(r.shareCode);
      setConfirming(false);
      setMsg("Novo código gerado. O link anterior deixou de funcionar.");
    } catch (e) {
      setMsg(errorLines(e)[0] ?? "Erro ao gerar o código.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="share-title" style={{ alignItems: "stretch" }}>
      <h2 id="share-title" style={{ margin: 0 }}>Compartilhar</h2>
      {!published && <p className="notice warn" role="status">Publique o questionário para o link funcionar. Enquanto for rascunho, quem abrir o link verá “indisponível”.</p>}
      <div className="field">
        <label htmlFor="share-url">Link para enviar aos participantes</label>
        <div className="row">
          <input id="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 240 }} />
          <button type="button" className="btn small" onClick={() => void copy()}>Copiar link</button>
        </div>
        <span className="hint">Quem abrir o link entra com a conta Google e responde; as respostas ficam identificadas para você avaliar.</span>
      </div>
      {!confirming ? (
        <div><button type="button" className="link" onClick={() => setConfirming(true)}>Gerar novo código…</button></div>
      ) : (
        <div className="notice" role="alertdialog" aria-label="Confirmar novo código">
          <p style={{ marginTop: 0 }}>Um novo código invalida o link atual: quem ainda não abriu precisará do novo. Tentativas já iniciadas continuam.</p>
          <button type="button" className="btn small" disabled={busy} onClick={() => void regenerate()}>{busy ? "Gerando…" : "Gerar novo código"}</button>{" "}
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
        </div>
      )}
      {msg && <p className="hint" role="status">{msg}</p>}
    </section>
  );
}
