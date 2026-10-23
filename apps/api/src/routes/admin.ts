import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  drawInputSchema,
  extractYoutubeId,
  LIMITS,
  questionnaireInputSchema,
  roleInputSchema,
  shuffle,
  youtubeInputSchema,
} from "@quiz/shared";
import type { Config } from "../config";
import { conflict, HttpError, notFound, unprocessable } from "../lib/errors";
import { isFkError, questionInclude, saveQuestion } from "../lib/questions";
import { sniffMime } from "../lib/media";
import { importRouter } from "./import";
import { subjectsRouter } from "./subjects";

const paramId = (v: unknown) => String(v);

export function adminRouter(prisma: PrismaClient, config: Config, uploadLimiter: import("express").RequestHandler) {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.pdfBytes, files: 1 } });

  // ---------- Questões ----------
  r.get("/questions", async (req, res) => {
    const { q, status, type, subjectId } = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
    const where: Prisma.QuestionWhereInput = {
      ...(q ? { searchText: { contains: q } } : {}),
      ...(status === "DRAFT" || status === "PUBLISHED" ? { status } : {}),
      ...(["OPEN", "SINGLE", "MULTIPLE", "ASSERTIONS", "TRUE_FALSE"].includes(type ?? "") ? { type: type as "OPEN" } : {}),
      ...(subjectId ? { subjectId } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, title: true, type: true, status: true, updatedAt: true, subject: { select: { id: true, name: true } } },
      }),
    ]);
    res.json({ total, page, pageSize, items });
  });

  r.get("/questions/:id", async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: paramId(req.params.id) }, include: questionInclude });
    if (!q) throw notFound("Questão");
    res.json(q);
  });
  r.post("/questions", async (req, res) => res.status(201).json(await saveQuestion(prisma, req.body, req.user!.id)));
  r.put("/questions/:id", async (req, res) => res.json(await saveQuestion(prisma, req.body, req.user!.id, paramId(req.params.id))));
  r.delete("/questions/:id", async (req, res) => {
    try {
      await prisma.question.delete({ where: { id: paramId(req.params.id) } });
    } catch (e) {
      if (isFkError(e)) throw conflict("A questão está em questionários ou tentativas. Remova-a dos questionários ou volte-a para rascunho.");
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw notFound("Questão");
      throw e;
    }
    res.status(204).end();
  });

  r.use("/subjects", subjectsRouter(prisma));
  r.use("/import", importRouter(prisma, uploadLimiter));

  // ---------- Questionários ----------
  async function saveQuestionnaire(input: unknown, id?: string) {
    const data = questionnaireInputSchema.parse(input);
    const unique = [...new Set(data.questionIds)];
    const questions = await prisma.question.findMany({ where: { id: { in: unique } }, select: { id: true, status: true } });
    if (questions.length !== unique.length) throw unprocessable("Há questões inexistentes na lista.");
    if (data.status === "PUBLISHED" && !questions.some((q) => q.status === "PUBLISHED")) {
      throw unprocessable("Publique ao menos uma questão publicada no questionário.");
    }
    return prisma.$transaction(async (tx) => {
      const base = { title: data.title, description: data.description, status: data.status, shuffleAlternatives: data.shuffleAlternatives };
      let qid = id;
      if (id) {
        if (!(await tx.questionnaire.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Questionário");
        await tx.questionnaire.update({ where: { id }, data: base });
        await tx.questionnaireQuestion.deleteMany({ where: { questionnaireId: id } });
      } else {
        qid = (await tx.questionnaire.create({ data: base })).id;
      }
      await tx.questionnaireQuestion.createMany({ data: unique.map((questionId, position) => ({ questionnaireId: qid!, questionId, position })) });
      return tx.questionnaire.findUniqueOrThrow({
        where: { id: qid! },
        include: { questions: { orderBy: { position: "asc" }, include: { question: { select: { id: true, title: true, type: true, status: true, subject: { select: { name: true } } } } } } },
      });
    });
  }

  // Sorteia questões publicadas por assunto, sem repetir entre assuntos nem com as já escolhidas.
  r.post("/questionnaires/draw", async (req, res) => {
    const { rules, excludeIds } = drawInputSchema.parse(req.body);
    const taken = new Set(excludeIds);
    const drawn: { id: string; title: string; type: string; status: string; subject: { name: string } }[] = [];
    const shortages: { subjectId: string; requested: number; got: number }[] = [];
    for (const rule of rules) {
      const pool = await prisma.question.findMany({
        where: { subjectId: rule.subjectId, status: "PUBLISHED", subject: { status: "ACTIVE" }, id: { notIn: [...taken] } },
        select: { id: true, title: true, type: true, status: true, subject: { select: { name: true } } },
      });
      const picked = shuffle(pool).slice(0, rule.count);
      picked.forEach((p) => taken.add(p.id));
      drawn.push(...picked);
      if (picked.length < rule.count) shortages.push({ subjectId: rule.subjectId, requested: rule.count, got: picked.length });
    }
    res.json({ questions: drawn, shortages });
  });

  r.get("/questionnaires", async (_req, res) => {
    const items = await prisma.questionnaire.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { questions: true, attempts: true } } },
    });
    res.json(items);
  });
  r.get("/questionnaires/:id", async (req, res) => {
    const item = await prisma.questionnaire.findUnique({
      where: { id: paramId(req.params.id) },
      include: { questions: { orderBy: { position: "asc" }, include: { question: { select: { id: true, title: true, type: true, status: true } } } } },
    });
    if (!item) throw notFound("Questionário");
    res.json(item);
  });
  r.post("/questionnaires", async (req, res) => res.status(201).json(await saveQuestionnaire(req.body)));
  r.put("/questionnaires/:id", async (req, res) => res.json(await saveQuestionnaire(req.body, paramId(req.params.id))));
  r.delete("/questionnaires/:id", async (req, res) => {
    try {
      await prisma.questionnaire.delete({ where: { id: paramId(req.params.id) } });
    } catch (e) {
      if (isFkError(e)) throw conflict("O questionário já possui tentativas. Volte-o para rascunho.");
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw notFound("Questionário");
      throw e;
    }
    res.status(204).end();
  });

  // ---------- Mídia ----------
  r.post("/media", uploadLimiter, upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "Envie um arquivo no campo 'file'.");
    const sniffed = sniffMime(file.buffer);
    if (!sniffed) throw unprocessable("Tipo de arquivo não permitido. Use JPEG, PNG, WebP ou PDF.");
    const max = sniffed.kind === "IMAGE" ? LIMITS.imageBytes : LIMITS.pdfBytes;
    if (file.size > max) throw new HttpError(413, `Arquivo acima do limite de ${max / 1024 / 1024} MB.`);

    const media = await prisma.media.create({
      data: {
        kind: sniffed.kind,
        mimeType: sniffed.mime,
        sizeBytes: file.size,
        originalName: file.originalname.slice(0, 200),
        uploadedById: req.user!.id,
      },
    });
    const storageKey = `${media.id}${sniffed.ext}`;
    try {
      await fs.mkdir(config.uploadDir, { recursive: true });
      await fs.writeFile(path.join(config.uploadDir, storageKey), file.buffer, { flag: "wx" });
      await prisma.media.update({ where: { id: media.id }, data: { storageKey } });
    } catch (e) {
      await prisma.media.delete({ where: { id: media.id } }).catch(() => undefined);
      throw e;
    }
    res.status(201).json({ id: media.id, kind: media.kind, mimeType: media.mimeType, originalName: media.originalName });
  });

  r.post("/youtube", (req, res) => {
    const { url } = youtubeInputSchema.parse(req.body);
    const videoId = extractYoutubeId(url);
    if (!videoId) throw unprocessable("URL do YouTube inválida.");
    res.json({ videoId });
  });

  // ---------- Usuários ----------
  r.get("/users", async (_req, res) => {
    res.json(await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, createdAt: true } }));
  });
  r.patch("/users/:id/role", async (req, res) => {
    const { role } = roleInputSchema.parse(req.body);
    const id = paramId(req.params.id);
    if (id === req.user!.id && role !== "ADMIN") throw conflict("Você não pode remover seu próprio acesso de administrador.");
    try {
      const user = await prisma.user.update({ where: { id }, data: { role }, select: { id: true, name: true, email: true, role: true } });
      res.json(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw notFound("Usuário");
      throw e;
    }
  });

  return r;
}
