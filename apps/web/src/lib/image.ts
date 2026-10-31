import { LIMITS } from "@quiz/shared";

const ACCEPTED = new Set<string>(LIMITS.imageMimes);
const MAX_SIDE = 2400;

const toBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/**
 * Prepara a foto para envio. Foto já aceita (JPG/PNG/WebP) e dentro do limite vai como está.
 * Foto grande (comum em celulares) ou em formato diferente (ex.: HEIC) é reduzida e convertida para JPG no próprio aparelho.
 */
export async function prepareImage(file: File, maxBytes: number = LIMITS.imageBytes): Promise<File> {
  if (ACCEPTED.has(file.type) && file.size <= maxBytes) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Não foi possível ler esta imagem. Envie uma foto nos formatos JPG, PNG ou WebP.");
  }

  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  for (let round = 0; round < 3; round++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff"; // PNG com transparência vira JPG sobre fundo branco
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await toBlob(canvas, quality);
      if (blob && blob.size <= maxBytes) {
        bitmap.close();
        return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "foto"}.jpg`, { type: "image/jpeg" });
      }
    }
    scale *= 0.7;
  }
  bitmap.close();
  throw new Error("A foto continua grande demais mesmo reduzida. Tente tirar outra foto.");
}
