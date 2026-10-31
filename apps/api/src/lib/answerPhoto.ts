import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config";
import { randomToken } from "./auth";

/** Caminho (relativo à API) da foto de uma resposta; `version` evita mostrar a foto antiga depois de trocar. */
export const answerPhotoUrl = (attemptId: string, questionId: string, version: Date | number) =>
  `/attempts/${attemptId}/answers/${questionId}/photo?v=${typeof version === "number" ? version : version.getTime()}`;

export const storedPath = (config: Config, key: string) => path.join(config.uploadDir, key);

/** Grava a foto em UPLOAD_DIR/answers com um nome aleatório (não adivinhável) e devolve a chave. */
export async function writeAnswerPhoto(config: Config, buf: Buffer, ext: string): Promise<string> {
  const key = `answers/${randomToken(18)}${ext}`;
  const file = storedPath(config, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf, { flag: "wx" });
  return key;
}

export const removeStoredFile = (config: Config, key: string | null | undefined) =>
  key ? fs.rm(storedPath(config, key), { force: true }).catch(() => undefined) : Promise.resolve();
