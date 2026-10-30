import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";

export const ORIGIN = "http://localhost:3000";
export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? "mysql://root:root@localhost:3307/quiz_test" } },
});

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-uploads-"));
const config = loadConfig({ NODE_ENV: "test", ADMIN_EMAILS: "admin@test.com", UPLOAD_DIR: uploadDir, APP_ORIGIN: ORIGIN });

/** Token de teste = "sub|email|nome". */
export const app = createApp({
  prisma,
  config,
  verifyGoogle: async (token) => {
    const [sub, email, name] = token.split("|");
    if (!sub || !email) throw new Error("token inválido");
    return { sub, email, name: name ?? sub };
  },
});

export async function resetDb() {
  // Ordem respeita as chaves estrangeiras.
  await prisma.answerAlternative.deleteMany();
  await prisma.answerItem.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.attemptQuestion.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.questionnaireQuestion.deleteMany();
  await prisma.questionnaire.deleteMany();
  await prisma.media.deleteMany();
  await prisma.questionItem.deleteMany();
  await prisma.alternative.deleteMany();
  await prisma.question.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

export type Client = ReturnType<typeof makeClient>;

/** Cliente autenticado que carrega cookie de sessão e CSRF automaticamente. */
export async function login(sub: string, email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/auth/google").set("Origin", ORIGIN).send({ idToken: `${sub}|${email}|Usuário ${sub}` });
  if (res.status !== 200) throw new Error(`login falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return makeClient(agent, res.body.csrfToken as string, res.body.id as string);
}

function makeClient(agent: ReturnType<typeof request.agent>, csrf: string, userId: string) {
  const w = (t: request.Test) => t.set("Origin", ORIGIN).set("x-csrf-token", csrf);
  return {
    agent,
    csrf,
    userId,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => w(agent.post(url)).send(body ?? {}),
    put: (url: string, body?: object) => w(agent.put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => w(agent.patch(url)).send(body ?? {}),
    del: (url: string) => w(agent.delete(url)),
    upload: (url: string, buf: Buffer, filename: string) => w(agent.post(url)).attach("file", buf, filename),
  };
}

export const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

export async function makeSubject(admin: Client, name = "Geral", status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  const r = await admin.post("/admin/subjects", { name, description: "", status });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.id as string;
}

export async function seedQuestionnaire(admin: Client, opts: { open?: number; multiple?: number; shuffleAlternatives?: boolean; subjectId?: string } = {}) {
  const ids: string[] = [];
  const subjectId = opts.subjectId ?? (await makeSubject(admin));
  for (let i = 0; i < (opts.open ?? 2); i++) {
    const r = await admin.post("/admin/questions", { type: "OPEN", status: "PUBLISHED", subjectId, title: `Aberta ${i}`, content: doc(`Enunciado aberto ${i}`) });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    ids.push(r.body.id);
  }
  for (let i = 0; i < (opts.multiple ?? 4); i++) {
    const r = await admin.post("/admin/questions", {
      type: "MULTIPLE",
      status: "PUBLISHED",
      subjectId,
      title: `Múltipla ${i}`,
      content: doc(`Enunciado múltiplo ${i}`),
      alternatives: [
        { text: "Alt 1", isCorrect: true },
        { text: "Alt 2", isCorrect: true },
        { text: "Alt 3", isCorrect: false },
        { text: "Alt 4", isCorrect: false },
      ],
    });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    ids.push(r.body.id);
  }
  const qn = await admin.post("/admin/questionnaires", {
    title: "Questionário teste",
    description: "",
    status: "PUBLISHED",
    shuffleAlternatives: opts.shuffleAlternatives ?? false,
    listed: true,
    questionIds: ids,
  });
  if (qn.status !== 201) throw new Error(JSON.stringify(qn.body));
  return { questionnaireId: qn.body.id as string, questionIds: ids, subjectId };
}
