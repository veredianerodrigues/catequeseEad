"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "@/lib/tiptap";

/** Renderiza o JSON do TipTap em modo somente leitura (sem HTML bruto). */
export function RichContent({ content }: { content: unknown }) {
  const editor = useEditor({
    extensions,
    content: content as object,
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: "rich", "aria-label": "Enunciado" } },
  });
  useEffect(() => {
    if (editor && content) editor.commands.setContent(content as object, { emitUpdate: false });
  }, [editor, content]);
  return <EditorContent editor={editor} />;
}
