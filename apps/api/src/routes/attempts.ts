import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { answerInputSchema, progressInputSchema, shuffle, type AttemptView } from "@quiz/shared";
import type { Config } from "../config";
import { conflict, notFound, unprocessable } from "../lib/errors";

const paramId = (v: unknown) => String(v);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
/// Apenas estes tipos têm a ordem das alternativas embaralhada (combinações de assertivas mantêm a ordem).
const SHUFFLES_ALTERNATIVES = new Set(["SINGLE", "MULTIPLE"]);

type Tx = Prisma.TransactionClient;

/** Bloqueia a linha da tentativa até o fim da transação: serializa gravações concorrentes e
 *  impede salvar resposta numa tentativa que acabou de ser concluída em outra aba. */
async function lockAttempt(tx: Tx, attemptId: string, userId: string) {
  const rows = await tx.$queryRaw<{ status: string; userId: string }[]>`
    SELECT status, userId FROM Attempt WHERE id = ${attemptId} FOR UPDATE`;
  const row = rows[0];
  if (!row || row.userId !== userId) throw notFound("Tentativa");
  return row;
}

const requireInProgress = (status: string) => {
  if (status !== "IN_PROGRESS") throw conflict("Esta tentativa não está mais em andamento.");
};

export function attemptsRouter(prisma: PrismaClient, config: Config, answerLimiter: import("express").RequestHandler) {
  const r = Router();

  async function buildView(attemptId: string, userId: string): Promise<AttemptView> {
    const attempt = await prisma.attempt.findFirst({
      where: { id: attemptId, userId },
      include: {
        questionnaire: { select: { id: true, title: true } },
        questions: {
          orderBy: { position: "asc" },
          include: {
            question: {
              include: {
                alternatives: { orderBy: { position: "asc" }, select: { id: true, text: true } },
                items: { orderBy: { position: "asc" }, select: { id: true, text: true } },
              },
            },
          },
        },
        answers: { include: { alternatives: true, items: true } },
      },
    });
    if (!attempt) throw notFound("Tentativa");
    const answerByQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
    let answered = 0;
    const questions = attempt.questions.map((aq) => {
      const alts = aq.question.alternatives;
      const order = Array.isArray(aq.alternativeOrder) ? (aq.alternativeOrder as string[]) : null;
      const sorted = order ? order.map((id) => alts.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a) : alts;
      const a = answerByQuestion.get(aq.questionId);
      const alternativeIds = a?.alternatives.map((x) => x.alternativeId) ?? [];
      const itemAnswers = a?.items.map((x) => ({ itemId: x.itemId, value: x.value })) ?? [];
      if (a && (a.text || alternativeIds.length || itemAnswers.length)) answered++;
      return {
        questionId: aq.questionId,
        position: aq.position,
        type: aq.question.type,
        content: aq.question.content,
        // Nunca expor isCorrect ao participante.
        alternatives: sorted.map((alt, i) => ({ id: alt.id, label: LETTERS[i] ?? String(i + 1), text: alt.text })),
        items: aq.question.items.map((it, i) => ({ id: it.id, label: aq.question.type === "ASSERTIONS" ? (ROMAN[i] ?? String(i + 1)) : String(i + 1), text: it.text })),
        answer: a ? { text: a.text, alternativeIds, items: itemAnswers } : null,
      };
    });
    return {
      id: attempt.id,
      questionnaire: attempt.questionnaire,
      status: attempt.status,
      currentIndex: attempt.currentIndex,
      total: questions.length,
      answered,
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
      questions,
    };
  }

  // Questionários publicados + tentativa em andamento do usuário
  r.get("/questionnaires", async (req, res) => {
    const items = await prisma.questionnaire.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        questions: { where: { question: { status: "PUBLISHED" } }, select: { questionId: true } },
        attempts: { where: { userId: req.user!.id, status: "IN_PROGRESS" }, select: { id: true }, orderBy: { startedAt: "desc" }, take: 1 },
      },
    });
    res.json(
      items
        .filter((q) => q.questions.length > 0)
        .map((q) => ({ id: q.id, title: q.title, description: q.description, questionCount: q.questions.length, inProgressAttemptId: q.attempts[0]?.id ?? null })),
    );
  });

  // Nova tentativa: sorteia e persiste a ordem uma única vez.
  r.post("/questionnaires/:id/attempts", async (req, res) => {
    const questionnaire = await prisma.questionnaire.findFirst({
      where: { id: paramId(req.params.id), status: "PUBLISHED" },
      include: {
        questions: {
          where: { question: { status: "PUBLISHED" } },
          orderBy: { position: "asc" },
          include: { question: { include: { alternatives: { select: { id: true } } } } },
        },
      },
    });
    if (!questionnaire) throw notFound("Questionário");
    if (!questionnaire.questions.length) throw unprocessable("Este questionário ainda não tem questões publicadas.");

    const ordered = shuffle(questionnaire.questions);
    const attempt = await prisma.$transaction(async (tx) => {
      const created = await tx.attempt.create({ data: { userId: req.user!.id, questionnaireId: questionnaire.id } });
      await tx.attemptQuestion.createMany({
        data: ordered.map((qq, position) => ({
          attemptId: created.id,
          questionId: qq.questionId,
          position,
          alternativeOrder:
            questionnaire.shuffleAlternatives && SHUFFLES_ALTERNATIVES.has(qq.question.type)
              ? shuffle(qq.question.alternatives.map((a) => a.id))
              : Prisma.JsonNull,
        })),
      });
      return created;
    });
    res.status(201).json(await buildView(attempt.id, req.user!.id));
  });

  r.get("/attempts", async (req, res) => {
    const status = req.query.status;
    const items = await prisma.attempt.findMany({
      where: { userId: req.user!.id, ...(status === "IN_PROGRESS" || status === "COMPLETED" || status === "ABANDONED" ? { status } : {}) },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        currentIndex: true,
        startedAt: true,
        completedAt: true,
        questionnaire: { select: { id: true, title: true } },
        _count: { select: { questions: true, answers: true } },
      },
    });
    res.json(items.map(({ _count, ...a }) => ({ ...a, total: _count.questions, answered: _count.answers })));
  });

  r.get("/attempts/:id", async (req, res) => res.json(await buildView(paramId(req.params.id), req.user!.id)));

  // Uma resposta por (tentativa, questão): regravar substitui a anterior.
  r.put("/attempts/:id/answers/:questionId", answerLimiter, async (req, res) => {
    const input = answerInputSchema.parse(req.body);
    const attemptId = paramId(req.params.id);
    const questionId = paramId(req.params.questionId);

    const saved = await prisma.$transaction(async (tx) => {
      const { status } = await lockAttempt(tx, attemptId, req.user!.id);
      requireInProgress(status);

      const aq = await tx.attemptQuestion.findUnique({
        where: { attemptId_questionId: { attemptId, questionId } },
        include: { question: { include: { alternatives: { select: { id: true } }, items: { select: { id: true } } } } },
      });
      if (!aq) throw notFound("Questão da tentativa");
      const type = aq.question.type;

      let text: string | null = null;
      let alternativeIds: string[] = [];
      let itemAnswers: { itemId: string; value: boolean }[] = [];
      const hasAlternatives = type === "SINGLE" || type === "MULTIPLE" || type === "ASSERTIONS";
      if (!hasAlternatives && input.alternativeIds?.length) throw unprocessable("Este tipo de questão não aceita alternativas.");
      if (type !== "OPEN" && input.text) throw unprocessable("Este tipo de questão não aceita texto.");
      if (type !== "TRUE_FALSE" && input.items?.length) throw unprocessable("Este tipo de questão não aceita itens.");

      if (type === "OPEN") {
        text = input.text?.trim() ? input.text : null;
      } else if (hasAlternatives) {
        alternativeIds = [...new Set(input.alternativeIds ?? [])];
        const valid = new Set(aq.question.alternatives.map((a) => a.id));
        if (alternativeIds.some((id) => !valid.has(id))) throw unprocessable("Alternativa inválida para esta questão.");
        if (type !== "MULTIPLE" && alternativeIds.length > 1) throw unprocessable("Esta questão aceita apenas uma alternativa.");
      } else {
        const valid = new Set(aq.question.items.map((i) => i.id));
        const byItem = new Map<string, boolean>();
        for (const it of input.items ?? []) {
          if (!valid.has(it.itemId)) throw unprocessable("Item inválido para esta questão.");
          byItem.set(it.itemId, it.value);
        }
        itemAnswers = [...byItem].map(([itemId, value]) => ({ itemId, value }));
      }

      if (text === null && alternativeIds.length === 0 && itemAnswers.length === 0) {
        await tx.answer.deleteMany({ where: { attemptId, questionId } });
        return { empty: true };
      }
      const answer = await tx.answer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        create: { attemptId, questionId, text },
        update: { text },
      });
      await tx.answerAlternative.deleteMany({ where: { answerId: answer.id } });
      await tx.answerItem.deleteMany({ where: { answerId: answer.id } });
      if (alternativeIds.length) await tx.answerAlternative.createMany({ data: alternativeIds.map((alternativeId) => ({ answerId: answer.id, alternativeId })) });
      if (itemAnswers.length) await tx.answerItem.createMany({ data: itemAnswers.map((x) => ({ answerId: answer.id, ...x })) });
      return { empty: false };
    });

    const answered = await prisma.answer.count({ where: { attemptId } });
    res.json({ saved: true, cleared: saved.empty, answered, savedAt: new Date().toISOString() });
  });

  r.patch("/attempts/:id/progress", async (req, res) => {
    const { currentIndex } = progressInputSchema.parse(req.body);
    const attemptId = paramId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const { status } = await lockAttempt(tx, attemptId, req.user!.id);
      requireInProgress(status);
      const total = await tx.attemptQuestion.count({ where: { attemptId } });
      if (currentIndex >= total) throw unprocessable("Posição fora do questionário.");
      await tx.attempt.update({ where: { id: attemptId }, data: { currentIndex } });
    });
    res.json({ currentIndex });
  });

  const finish = (target: "COMPLETED" | "ABANDONED") => async (req: import("express").Request, res: import("express").Response) => {
    const attemptId = paramId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const { status } = await lockAttempt(tx, attemptId, req.user!.id);
      if (status === target) return; // idempotente
      requireInProgress(status);
      await tx.attempt.update({ where: { id: attemptId }, data: { status: target, completedAt: target === "COMPLETED" ? new Date() : null } });
    });
    res.json(await buildView(attemptId, req.user!.id));
  };
  r.post("/attempts/:id/complete", finish("COMPLETED"));
  r.post("/attempts/:id/abandon", finish("ABANDONED"));

  // Arquivos enviados (qualquer usuário autenticado; ids não adivinháveis).
  r.get("/media/:id", async (req, res) => {
    const media = await prisma.media.findUnique({ where: { id: paramId(req.params.id) } });
    if (!media?.storageKey || !media.mimeType) throw notFound("Arquivo");
    const file = path.join(config.uploadDir, media.storageKey);
    if (!fs.existsSync(file)) throw notFound("Arquivo");
    res.setHeader("Content-Type", media.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    // Arquivos são imutáveis por id; cache apenas no navegador do usuário.
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    fs.createReadStream(file).pipe(res);
  });

  return r;
}
