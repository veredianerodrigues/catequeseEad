import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

export const mediaUrl = (id: string) => `/api/media/${id}`;
export const youtubeEmbedUrl = (videoId: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;

const Image = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ mediaId: { default: null }, title: { default: null } }),
  parseHTML: () => [{ tag: "figure[data-media-image]" }],
  renderHTML: ({ node }) => [
    "figure",
    { class: "embed embed-image", "data-media-image": node.attrs.mediaId },
    ["img", { src: mediaUrl(String(node.attrs.mediaId)), alt: node.attrs.title ?? "Imagem do enunciado", loading: "lazy" }],
  ],
});

const Pdf = Node.create({
  name: "pdf",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ mediaId: { default: null }, title: { default: null } }),
  parseHTML: () => [{ tag: "figure[data-media-pdf]" }],
  renderHTML: ({ node }) => [
    "figure",
    { class: "embed embed-pdf", "data-media-pdf": node.attrs.mediaId },
    ["iframe", { src: mediaUrl(String(node.attrs.mediaId)), title: node.attrs.title ?? "Documento PDF", loading: "lazy" }],
    ["a", { href: mediaUrl(String(node.attrs.mediaId)), target: "_blank", rel: "noopener noreferrer" }, "Abrir PDF em nova aba"],
  ],
});

const Youtube = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ videoId: { default: null } }),
  parseHTML: () => [{ tag: "div[data-youtube]" }],
  renderHTML: ({ node }) => [
    "div",
    { class: "embed embed-video", "data-youtube": node.attrs.videoId },
    [
      "iframe",
      {
        src: youtubeEmbedUrl(String(node.attrs.videoId)),
        title: "Vídeo do YouTube",
        allow: "encrypted-media; picture-in-picture; fullscreen",
        allowfullscreen: "true",
        referrerpolicy: "strict-origin-when-cross-origin",
        loading: "lazy",
      },
    ],
  ],
});

/** Mesmo conjunto do sanitizador do backend (@quiz/shared/richtext). */
export const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    code: false,
    codeBlock: false,
    strike: false,
    underline: false,
    link: { openOnClick: false, autolink: false, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" } },
  }),
  Image,
  Pdf,
  Youtube,
];
