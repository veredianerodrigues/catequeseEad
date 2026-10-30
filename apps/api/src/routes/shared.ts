import { Router, type RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { HttpError } from "../lib/errors";
import { SHARE_CODE_RE } from "../lib/shareCode";
import { createAttempt } from "./attempts";

const invalid = () => new HttpError(404, "Link inválido ou questionário indisponível.");

/** Acesso ao questionário pelo link compartilhado (/q/<código>). Exige login: as respostas são identificadas. */
export function sharedRouter(prisma: PrismaClient, limiter: RequestHandler) {
  const r = Router();

  r.get("/:code", limiter, async (req, res) => {
    const code = String(req.params.code);
    if (!SHARE_CODE_RE.test(code)) throw invalid();
    const q = await prisma.questionnaire.findFirst({
      where: { shareCode: code, status: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        description: true,
        questions: { where: { question: { status: "PUBLISHED" } }, select: { questionId: true } },
        attempts: { where: { userId: req.user!.id }, select: { id: true, status: true }, orderBy: { startedAt: "desc" } },
      },
    });
    if (!q || q.questions.length === 0) throw invalid();
    res.json({
      id: q.id,
      title: q.title,
      description: q.description,
      questionCount: q.questions.length,
      inProgressAttemptId: q.attempts.find((a) => a.status === "IN_PROGRESS")?.id ?? null,
      completedCount: q.attempts.filter((a) => a.status === "COMPLETED").length,
    });
  });

  r.post("/:code/attempts", limiter, async (req, res) => {
    const code = String(req.params.code);
    if (!SHARE_CODE_RE.test(code)) throw invalid();
    try {
      res.status(201).json({ id: await createAttempt(prisma, req.user!.id, { shareCode: code }) });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) throw invalid();
      throw e;
    }
  });

  return r;
}
