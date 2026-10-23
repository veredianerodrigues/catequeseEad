/** Sanitização do JSON do TipTap por allowlist: nós, marcas e atributos desconhecidos são descartados. */

export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MEDIA_ID_RE = /^[a-z0-9]{20,32}$/;

const BLOCK = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "image", "pdf", "youtube", "horizontalRule"];
const INLINE = ["text", "hardBreak"];

const CONTENT: Record<string, string[]> = {
  doc: BLOCK,
  paragraph: INLINE,
  heading: INLINE,
  blockquote: ["paragraph", "bulletList", "orderedList"],
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  listItem: ["paragraph", "bulletList", "orderedList"],
};
const LEAVES = new Set(["image", "pdf", "youtube", "horizontalRule", "hardBreak"]);

export function isSafeHref(href: string): boolean {
  try {
    const u = new URL(href);
    return ["http:", "https:", "mailto:"].includes(u.protocol);
  } catch {
    return false;
  }
}

/** Extrai o ID de uma URL do YouTube (watch, youtu.be, embed, shorts) ou de um ID puro. */
export function extractYoutubeId(input: string): string | null {
  const value = input.trim();
  if (YOUTUBE_ID_RE.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
      id = m?.[2] ?? null;
    }
  }
  return id && YOUTUBE_ID_RE.test(id) ? id : null;
}

export class RichTextError extends Error {}

function cleanNode(node: unknown, parent: string, mediaIds: Set<string>, youtubeIds: Set<string>): RichNode | null {
  if (!node || typeof node !== "object") return null;
  const n = node as RichNode;
  if (typeof n.type !== "string" || !CONTENT[parent]?.includes(n.type)) return null;

  const out: RichNode = { type: n.type };
  switch (n.type) {
    case "text": {
      if (typeof n.text !== "string" || n.text.length === 0) return null;
      out.text = n.text.slice(0, 20000);
      const marks: NonNullable<RichNode["marks"]> = [];
      for (const m of Array.isArray(n.marks) ? n.marks : []) {
        if (m?.type === "bold" || m?.type === "italic") marks.push({ type: m.type });
        else if (m?.type === "link") {
          const href = (m.attrs as { href?: unknown } | undefined)?.href;
          if (typeof href === "string" && isSafeHref(href)) {
            marks.push({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } });
          }
        }
      }
      if (marks.length) out.marks = marks;
      return out;
    }
    case "heading": {
      const level = Number((n.attrs as { level?: unknown } | undefined)?.level);
      out.attrs = { level: level >= 1 && level <= 3 ? level : 2 };
      break;
    }
    case "image":
    case "pdf": {
      const a = (n.attrs ?? {}) as { mediaId?: unknown; title?: unknown };
      if (typeof a.mediaId !== "string" || !MEDIA_ID_RE.test(a.mediaId)) return null;
      mediaIds.add(a.mediaId);
      out.attrs = { mediaId: a.mediaId };
      if (typeof a.title === "string") out.attrs.title = a.title.slice(0, 200);
      return out;
    }
    case "youtube": {
      const id = (n.attrs as { videoId?: unknown } | undefined)?.videoId;
      if (typeof id !== "string" || !YOUTUBE_ID_RE.test(id)) return null;
      youtubeIds.add(id);
      out.attrs = { videoId: id };
      return out;
    }
  }
  if (LEAVES.has(n.type)) return out;

  const children: RichNode[] = [];
  for (const c of Array.isArray(n.content) ? n.content : []) {
    const cleaned = cleanNode(c, n.type, mediaIds, youtubeIds);
    if (cleaned) children.push(cleaned);
  }
  if (children.length) out.content = children;
  return out;
}

export type SanitizedDoc = { doc: RichNode; mediaIds: string[]; youtubeIds: string[] };

export function sanitizeRichText(input: unknown): SanitizedDoc {
  if (!input || typeof input !== "object" || (input as RichNode).type !== "doc") {
    throw new RichTextError("Conteúdo inválido: o documento deve ter type doc.");
  }
  const mediaIds = new Set<string>();
  const youtubeIds = new Set<string>();
  const raw = (input as RichNode).content;
  const content: RichNode[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const cleaned = cleanNode(c, "doc", mediaIds, youtubeIds);
    if (cleaned) content.push(cleaned);
  }
  return { doc: { type: "doc", content }, mediaIds: [...mediaIds], youtubeIds: [...youtubeIds] };
}

/** Texto puro do documento (para busca e verificação de enunciado vazio). */
export function richTextToPlain(doc: RichNode): string {
  const parts: string[] = [];
  const walk = (n: RichNode) => {
    if (n.text) parts.push(n.text);
    n.content?.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function hasMeaningfulContent(doc: RichNode): boolean {
  if (richTextToPlain(doc).length > 0) return true;
  const has = (n: RichNode): boolean => ["image", "pdf", "youtube"].includes(n.type) || !!n.content?.some(has);
  return has(doc);
}
