"use client";

import { useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { extractYoutubeId, isSafeHref, LIMITS } from "@quiz/shared";
import { api, errorLines } from "@/lib/api";
import { extensions } from "@/lib/tiptap";

type Props = { initial: unknown; onChange: (doc: object) => void };
type Panel = "link" | "youtube" | null;

export function RichEditor({ initial, onChange }: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions,
    content: (initial as object) ?? { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: { attributes: { class: "rich editor-surface", role: "textbox", "aria-multiline": "true", "aria-label": "Enunciado da questão" } },
  });

  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: !!editor?.isActive("bold"),
      italic: !!editor?.isActive("italic"),
      h2: !!editor?.isActive("heading", { level: 2 }),
      h3: !!editor?.isActive("heading", { level: 3 }),
      bullet: !!editor?.isActive("bulletList"),
      ordered: !!editor?.isActive("orderedList"),
      quote: !!editor?.isActive("blockquote"),
      link: !!editor?.isActive("link"),
    }),
  });

  if (!editor) return <div className="editor-skeleton" aria-busy="true" />;
  const chain = () => editor.chain().focus();

  const closePanel = () => {
    setPanel(null);
    setValue("");
    setMsg(null);
  };

  async function uploadFile(file: File | undefined, kind: "image" | "pdf") {
    if (!file) return;
    const max = kind === "image" ? LIMITS.imageBytes : LIMITS.pdfBytes;
    if (file.size > max) return setMsg(`Arquivo acima de ${max / 1024 / 1024} MB.`);
    setBusy(true);
    setMsg(null);
    try {
      const media = await api.upload<{ id: string }>("/admin/media", file);
      chain().insertContent({ type: kind, attrs: { mediaId: media.id, title: file.name } }).run();
    } catch (e) {
      setMsg(errorLines(e).join(" "));
    } finally {
      setBusy(false);
    }
  }

  async function submitPanel() {
    if (panel === "link") {
      if (!value) chain().unsetLink().run();
      else if (isSafeHref(value)) chain().extendMarkRange("link").setLink({ href: value }).run();
      else return setMsg("Use um endereço http://, https:// ou mailto:.");
    } else if (panel === "youtube") {
      const videoId = extractYoutubeId(value);
      if (!videoId) return setMsg("Cole uma URL válida do YouTube.");
      chain().insertContent({ type: "youtube", attrs: { videoId } }).run();
    }
    closePanel();
  }

  const Btn = ({ label, on, run, children }: { label: string; on?: boolean; run: () => void; children: React.ReactNode }) => (
    <button type="button" className={`tb ${on ? "on" : ""}`} aria-pressed={on} aria-label={label} title={label} onClick={run}>
      {children}
    </button>
  );

  return (
    <div className="editor">
      <div className="toolbar" role="toolbar" aria-label="Formatação">
        <Btn label="Negrito" on={active?.bold} run={() => chain().toggleBold().run()}><b>N</b></Btn>
        <Btn label="Itálico" on={active?.italic} run={() => chain().toggleItalic().run()}><i>I</i></Btn>
        <Btn label="Título" on={active?.h2} run={() => chain().toggleHeading({ level: 2 }).run()}>T1</Btn>
        <Btn label="Subtítulo" on={active?.h3} run={() => chain().toggleHeading({ level: 3 }).run()}>T2</Btn>
        <Btn label="Lista" on={active?.bullet} run={() => chain().toggleBulletList().run()}>• Lista</Btn>
        <Btn label="Lista numerada" on={active?.ordered} run={() => chain().toggleOrderedList().run()}>1. Lista</Btn>
        <Btn label="Citação" on={active?.quote} run={() => chain().toggleBlockquote().run()}>“ ”</Btn>
        <span className="sep" />
        <Btn label="Link" on={active?.link} run={() => { setPanel("link"); setValue(editor.getAttributes("link").href ?? ""); }}>Link</Btn>
        <Btn label="Inserir imagem" run={() => imageInput.current?.click()}>Imagem</Btn>
        <Btn label="Inserir PDF" run={() => pdfInput.current?.click()}>PDF</Btn>
        <Btn label="Inserir vídeo do YouTube" run={() => setPanel("youtube")}>Vídeo</Btn>
        <input ref={imageInput} type="file" accept={LIMITS.imageMimes.join(",")} hidden onChange={(e) => { void uploadFile(e.target.files?.[0], "image"); e.target.value = ""; }} />
        <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { void uploadFile(e.target.files?.[0], "pdf"); e.target.value = ""; }} />
      </div>

      {panel && (
        <form className="panel-row" onSubmit={(e) => { e.preventDefault(); void submitPanel(); }}>
          <label className="sr-only" htmlFor="editor-panel-input">{panel === "link" ? "Endereço do link" : "URL do YouTube"}</label>
          <input id="editor-panel-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={panel === "link" ? "https://exemplo.com (vazio remove o link)" : "https://www.youtube.com/watch?v=…"} />
          <button type="submit" className="btn small">Aplicar</button>
          <button type="button" className="btn small ghost" onClick={closePanel}>Cancelar</button>
        </form>
      )}
      {(msg || busy) && <p className={busy ? "hint" : "field-error"} role="status">{busy ? "Enviando arquivo…" : msg}</p>}

      <EditorContent editor={editor} />
    </div>
  );
}
