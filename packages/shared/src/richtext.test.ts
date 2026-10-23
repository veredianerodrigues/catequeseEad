import { describe, expect, it } from "vitest";
import { extractYoutubeId, sanitizeRichText, shuffle } from "./index";

describe("sanitizeRichText", () => {
  it("remove nós, marcas e links perigosos", () => {
    const { doc } = sanitizeRichText({
      type: "doc",
      content: [
        { type: "script", content: [{ type: "text", text: "alert(1)" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "oi", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "bold" }] },
            { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "https://a.com" } }] },
          ],
        },
      ],
    });
    expect(doc.content).toHaveLength(1);
    const [bad, good] = doc.content![0]!.content!;
    expect(bad!.marks).toEqual([{ type: "bold" }]);
    expect(good!.marks![0]!.attrs!.href).toBe("https://a.com");
  });

  it("valida ids de mídia e youtube", () => {
    const r = sanitizeRichText({
      type: "doc",
      content: [
        { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
        { type: "youtube", attrs: { videoId: '"><script>' } },
        { type: "image", attrs: { mediaId: "../../etc" } },
      ],
    });
    expect(r.doc.content).toHaveLength(1);
    expect(r.youtubeIds).toEqual(["dQw4w9WgXcQ"]);
  });

  it("rejeita documento sem type doc", () => {
    expect(() => sanitizeRichText({ type: "paragraph" })).toThrow();
  });
});

describe("extractYoutubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=3", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://evil.com/watch?v=dQw4w9WgXcQ", null],
    ["javascript:alert(1)", null],
  ])("%s", (url, id) => expect(extractYoutubeId(url)).toBe(id));
});

describe("shuffle", () => {
  it("preserva os elementos", () => {
    expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
