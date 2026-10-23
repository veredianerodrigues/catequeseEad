import path from "node:path";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { HttpError, unprocessable } from "./errors";

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Extrai o texto de .md/.txt, .docx ou .doc; o tipo é conferido pelo conteúdo, não só pela extensão. */
export async function extractText(fileName: string, buf: Buffer): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  if (![".md", ".txt", ".docx", ".doc"].includes(ext)) throw unprocessable("Formato não aceito. Envie .md, .docx ou .doc.");
  try {
    if (ext === ".docx") {
      if (!buf.subarray(0, 4).equals(ZIP)) throw unprocessable("O arquivo não é um .docx válido.");
      return (await mammoth.extractRawText({ buffer: buf })).value;
    }
    if (ext === ".doc") {
      if (!buf.subarray(0, 8).equals(OLE)) throw unprocessable("O arquivo não é um .doc válido.");
      return (await new WordExtractor().extract(buf)).getBody();
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw unprocessable("Não foi possível ler o arquivo. Ele pode estar corrompido ou protegido.");
  }
  if (buf.includes(0)) throw unprocessable("O arquivo de texto contém dados binários.");
  return buf.toString("utf8").replace(/^﻿/, "");
}
