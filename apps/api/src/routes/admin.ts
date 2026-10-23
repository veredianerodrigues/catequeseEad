import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  categoryInputSchema,
  extractYoutubeId,
  hasMeaningfulContent,
  LIMITS,
  publishIssues,
  questionInputSchema,
  questionnaireInputSchema,
  richTextToPlain,
  roleInputSchema,
  sanitizeRichText,
  youtubeInputSchema,
  type RichNode,
} from "@quiz/shared";
import type { Config } from "../config";
import { conflict, HttpError, notFound, unprocessable } from "../lib/errors";
import { sniffMime } from "../lib/media";

const paramId = (v: unknown) => String(v);

function isFkError(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014");
}

export function adminRouter(prisma: PrismaClient, config: Config, uploadLimiter: import("express").RequestHandler) {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.pdfBytes, files: 1 } });

  // ---------- Questões ----------
  const questionInclude = { alternatives: { orderBy: { position: "asc" as const } }, category: true };

  async function saveQuestion(input: unknown, userId: string, id?: string) {
    const data = questionInputSchema.parse(input);
    let sanitized;
    try {
      sanitized = sanitizeRichText(data.content);
    } catch (e) {
      throw unprocessable((e as Error).message);
    }
    const alternatives = data.type === "MULTIPLE" ? data.alternatives : [];
    if (data.status === "PUBLISHED") {
      const issues = publishIssues({ type: data.type, alternatives });
      if (!hasMeaningfulContent(sanitized.doc)) issues.unshift("O enunciado está vazio.");
      if (issues.length) throw unprocessable("A questão não pode ser publicada.", issues);
    }
    if (sanitized.mediaIds.length) {
      const found = await prisma.media.count({ where: { id: { in: sanitized.mediaIds }, kind: { in: ["IMAGE", "PDF"] } } });
      if (found !== sanitized.mediaIds.length) throw unprocessable("O enunciado referencia um arquivo inexistente.");
    }
    if (data.categoryId && !(await prisma.category.findUnique({ where: { id: data.categoryId } }))) {
      throw unprocessable("Categoria inexistente.");
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const base = {
          type: data.type,
          status: data.status,
          title: data.title,
          content: sanitized.doc as unknown as Prisma.InputJsonValue,
          searchText: `${data.title} ${richTextToPlain(sanitized.doc as RichNode)}`.slice(0, 60000),
          categoryId: data.categoryId ?? null,
        };
        let questionId = id;
        if (id) {
          if (!(await tx.question.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Questão");
          await tx.question.update({ where: { id }, data: base });
        } else {
          questionId = (await tx.question.create({ data: base })).id;
        }
        const qid = questionId!;

        // Alternativas: atualiza as existentes por id, cria as novas, remove as ausentes.
        const existing = await tx.alternative.findMany({ where: { questionId: qid }, select: { id: true } });
        const existingIds = new Set(existing.map((a) => a.id));
        const keep = new Set<string>();
        for (const [position, alt] of alternatives.entries()) {
          if (alt.id && existingIds.has(alt.id)) {
            keep.add(alt.id);
            await tx.alternative.update({ where: { id: alt.id }, data: { position, text: alt.text, isCorrect: alt.isCorrect } });
          } else {
            await tx.alternative.create({ data: { questionId: qid, position, text: alt.text, isCorrect: alt.isCorrect } });
          }
        }
        const remove = [...existingIds].filter((x) => !keep.has(x));
        if (remove.length) await tx.alternative.deleteMany({ where: { id: { in: remove } } });

        // Mídias: vincula arquivos usados e registra vídeos do YouTube.
        await tx.media.updateMany({ where: { questionId: qid, kind: { in: ["IMAGE", "PDF"] }, id: { notIn: sanitized.mediaIds } }, data: { questionId: null } });
        if (sanitized.mediaIds.length) await tx.media.updateMany({ where: { id: { in: sanitized.mediaIds } }, data: { questionId: qid } });
        await tx.media.deleteMany({ where: { questionId: qid, kind: "YOUTUBE" } });
        if (sanitized.youtubeIds.length) {
          await tx.media.createMany({
            data: sanitized.youtubeIds.map((youtubeId) => ({ kind: "YOUTUBE" as const, youtubeId, uploadedById: userId, questionId: qid })),
          });
        }
        return tx.question.findUniqueOrThrow({ where: { id: qid }, include: questionInclude });
      });
    } catch (e) {
      if (isFkError(e)) throw conflict("Uma alternativa removida já foi usada em respostas. Despublique a questão em vez de removê-la.");
      throw e;
    }
  }

  r.get("/questions", async (req, res) => {
    const { q, status, type, categoryId } = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
    const where: Prisma.QuestionWhereInput = {
      ...(q ? { searchText: { contains: q } } : {}),
      ...(status === "DRAFT" || status === "PUBLISHED" ? { status } : {}),
      ...(type === "OPEN" || type === "MULTIPLE" ? { type } : {}),
      ...(categoryId ? { categoryId } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, title: true, type: true, status: true, updatedAt: true, category: { select: { id: true, name: true } } },
      }),
    ]);
    res.json({ total, page, pageSize, items });
  });

  r.get("/questions/:id", async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: paramId(req.params.id) }, include: questionInclude });
    if (!q) throw notFound("Questão");
    res.json(q);
  });
  r.post("/questions", async (req, res) => res.status(201).json(await saveQuestion(req.body, req.user!.id)));
  r.put("/questions/:id", async (req, res) => res.json(await saveQuestion(req.body, req.user!.id, paramId(req.params.id))));
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

  // ---------- Categorias ----------
  r.get("/categories", async (_req, res) => res.json(await prisma.category.findMany({ orderBy: { name: "asc" } })));
  r.post("/categories", async (req, res) => {
    const { name } = categoryInputSchema.parse(req.body);
    try {
      res.status(201).json(await prisma.category.create({ data: { name } }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("Categoria já existe.");
      throw e;
    }
  });

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
        include: { questions: { orderBy: { position: "asc" }, include: { question: { select: { id: true, title: true, type: true, status: true } } } } },
      });
    });
  }

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
