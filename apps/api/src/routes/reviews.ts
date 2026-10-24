import { Router } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { conflict, HttpError, notFound } from "../lib/errors";
import type { AuthUser } from "../lib/auth";

const paramId = (v: unknown) => String(v);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const gradeSchema = z.object({ isCorrect: z.boolean().nullable() });

type Given =
  | { kind: "text"; text: string | null }
  | { kind: "choice"; selected: { label: string; text: string }[] }
  | { kind: "items"; items: { label: string; text: string; value: boolean | null }[] };

type QuestionFull = Prisma.QuestionGetPayload<{ include: { alternatives: true; items: true; subject: { select: { name: true } } } }>;
type AnswerFull = Prisma.AnswerGetPayload<{ include: { alternatives: true; items: true } }>;

const QUESTION_INCLUDE = {
  alternatives: { orderBy: { position: "asc" as const } },
  items: { orderBy: { position: "asc" as const } },
  subject: { select: { name: true } },
};
const ANSWER_INCLUDE = { alternatives: true, items: true };

/** Resposta dada × gabarito, já legíveis, na ordem em que o participante viu as alternativas. */
function present(question: QuestionFull, alternativeOrder: unknown, answer: AnswerFull | undefined) {
  const order = Array.isArray(alternativeOrder) ? (alternativeOrder as string[]) : null;
  const shown = order ? order.map((id) => question.alternatives.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a) : question.alternatives;
  const labeled = shown.map((a, i) => ({ ...a, label: LETTERS[i] ?? String(i + 1) }));
  const itemRows = question.items.map((it, i) => ({
    ...it,
    label: question.type === "ASSERTIONS" ? ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][i] ?? String(i + 1) : String(i + 1),
  }));

  let given: Given;
  let key: Given;
  let matchesKey: boolean | null = null;

  if (question.type === "OPEN") {
    given = { kind: "text", text: answer?.text ?? null };
    key = { kind: "text", text: question.expectedAnswer };
  } else if (question.type === "TRUE_FALSE") {
    const byItem = new Map(answer?.items.map((x) => [x.itemId, x.value]) ?? []);
    given = { kind: "items", items: itemRows.map((it) => ({ label: it.label, text: it.text, value: byItem.get(it.id) ?? null })) };
    key = { kind: "items", items: itemRows.map((it) => ({ label: it.label, text: it.text, value: it.isTrue })) };
    if (answer) matchesKey = itemRows.every((it) => byItem.get(it.id) === it.isTrue);
  } else {
    const picked = new Set(answer?.alternatives.map((a) => a.alternativeId) ?? []);
    given = { kind: "choice", selected: labeled.filter((a) => picked.has(a.id)).map(({ label, text }) => ({ label, text })) };
    key = { kind: "choice", selected: labeled.filter((a) => a.isCorrect).map(({ label, text }) => ({ label, text })) };
    if (answer) matchesKey = labeled.every((a) => picked.has(a.id) === a.isCorrect);
  }
  return { given, key, matchesKey };
}

/** Totais da tentativa: `total` = questões da tentativa; só respostas existentes podem ser avaliadas. */
const summarize = (total: number, answers: { isCorrect: boolean | null }[]) => {
  const answered = answers.length;
  const graded = answers.filter((a) => a.isCorrect !== null).length;
  const correct = answers.filter((a) => a.isCorrect === true).length;
  return { total, answered, graded, correct, wrong: graded - correct, pending: answered - graded, percent: total ? Math.round((correct / total) * 100) : 0 };
};

export function reviewsRouter(prisma: PrismaClient) {
  const r = Router();

  /** Só quem criou o questionário avalia as respostas (legado sem criador: qualquer administrador). */
  async function ownedQuestionnaire(id: string, user: AuthUser) {
    const q = await prisma.questionnaire.findUnique({ where: { id }, select: { id: true, title: true, createdById: true, createdBy: { select: { name: true } } } });
    if (!q) throw notFound("Questionário");
    if (q.createdById && q.createdById !== user.id) throw new HttpError(403, "Somente quem criou o questionário pode avaliar as respostas.");
    return q;
  }

  // 1) Questionários que o usuário pode avaliar, com contagens.
  r.get("/", async (req, res) => {
    const list = await prisma.questionnaire.findMany({
      where: { OR: [{ createdById: req.user!.id }, { createdById: null }] },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, status: true, createdAt: true, _count: { select: { questions: true } } },
    });
    const ids = list.map((q) => q.id);
    const attempts = ids.length ? await prisma.attempt.groupBy({ by: ["questionnaireId", "status"], where: { questionnaireId: { in: ids } }, _count: true }) : [];
    const pendingRows = ids.length
      ? await prisma.$queryRaw<{ questionnaireId: string; pending: bigint }[]>`
          SELECT a.questionnaireId, COUNT(*) AS pending
          FROM Answer an JOIN Attempt a ON a.id = an.attemptId
          WHERE a.status = 'COMPLETED' AND an.isCorrect IS NULL AND a.questionnaireId IN (${Prisma.join(ids)})
          GROUP BY a.questionnaireId`
      : [];
    const pending = new Map(pendingRows.map((p) => [p.questionnaireId, Number(p.pending)]));
    res.json(
      list.map((q) => {
        const by = (s: string) => attempts.find((a) => a.questionnaireId === q.id && a.status === s)?._count ?? 0;
        return { id: q.id, title: q.title, status: q.status, createdAt: q.createdAt, questionCount: q._count.questions, completed: by("COMPLETED"), inProgress: by("IN_PROGRESS"), abandoned: by("ABANDONED"), pendingAnswers: pending.get(q.id) ?? 0 };
      }),
    );
  });

  // 2) Participantes (uma linha por tentativa) de um questionário.
  r.get("/questionnaires/:id", async (req, res) => {
    const q = await ownedQuestionnaire(paramId(req.params.id), req.user!);
    const attempts = await prisma.attempt.findMany({
      where: { questionnaireId: q.id },
      orderBy: [{ startedAt: "asc" }],
      include: { user: { select: { id: true, name: true, email: true } }, _count: { select: { questions: true } }, answers: { select: { isCorrect: true } } },
    });
    const seen = new Map<string, number>();
    const rows = attempts.map((a) => {
      const n = (seen.get(a.userId) ?? 0) + 1;
      seen.set(a.userId, n);
      const sum = summarize(a._count.questions, a.answers);
      return { attemptId: a.id, attemptNumber: n, user: a.user, status: a.status, startedAt: a.startedAt, completedAt: a.completedAt, ...sum };
    });
    res.json({ questionnaire: { id: q.id, title: q.title, createdBy: q.createdBy?.name ?? null }, attempts: rows.reverse() });
  });

  // 3) Respostas de um participante (uma linha por questão), com gabarito e nota.
  r.get("/attempts/:attemptId", async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: paramId(req.params.attemptId) },
      include: {
        user: { select: { id: true, name: true, email: true } },
        questionnaire: { select: { id: true, title: true, createdById: true } },
        questions: { orderBy: { position: "asc" }, include: { question: { include: QUESTION_INCLUDE } } },
        answers: { include: ANSWER_INCLUDE },
      },
    });
    if (!attempt) throw notFound("Tentativa");
    await ownedQuestionnaire(attempt.questionnaire.id, req.user!);

    const byQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const rows = attempt.questions.map((aq) => {
      const answer = byQuestion.get(aq.questionId);
      const p = present(aq.question, aq.alternativeOrder, answer);
      return {
        position: aq.position + 1,
        question: { id: aq.question.id, title: aq.question.title, type: aq.question.type, subject: aq.question.subject.name, content: aq.question.content, explanation: aq.question.explanation },
        answerId: answer?.id ?? null,
        answered: !!answer,
        given: p.given,
        key: p.key,
        matchesKey: p.matchesKey,
        isCorrect: answer?.isCorrect ?? null,
        gradedAt: answer?.gradedAt ?? null,
      };
    });
    res.json({
      attempt: { id: attempt.id, status: attempt.status, startedAt: attempt.startedAt, completedAt: attempt.completedAt, canGrade: attempt.status === "COMPLETED" },
      user: attempt.user,
      questionnaire: { id: attempt.questionnaire.id, title: attempt.questionnaire.title },
      summary: summarize(rows.length, rows.filter((x) => x.answered)),
      rows,
    });
  });

  // Avaliação: marcar uma resposta como correta, errada (ou limpar). Só em tentativas concluídas.
  r.put("/answers/:answerId/grade", async (req, res) => {
    const { isCorrect } = gradeSchema.parse(req.body);
    const answer = await prisma.answer.findUnique({ where: { id: paramId(req.params.answerId) }, include: { attempt: { select: { id: true, status: true, questionnaireId: true } } } });
    if (!answer) throw notFound("Resposta");
    await ownedQuestionnaire(answer.attempt.questionnaireId, req.user!);
    if (answer.attempt.status !== "COMPLETED") throw conflict("Só é possível avaliar respostas de tentativas concluídas.");

    await prisma.answer.update({
      where: { id: answer.id },
      data: { isCorrect, gradedById: isCorrect === null ? null : req.user!.id, gradedAt: isCorrect === null ? null : new Date() },
    });
    const [total, answers] = await Promise.all([
      prisma.attemptQuestion.count({ where: { attemptId: answer.attempt.id } }),
      prisma.answer.findMany({ where: { attemptId: answer.attempt.id }, select: { isCorrect: true } }),
    ]);
    const summary = summarize(total, answers);
    res.json({ answerId: answer.id, isCorrect, summary });
  });

  // Visão por questão: quais questões e quantas respostas cada uma recebeu.
  r.get("/questionnaires/:id/questions", async (req, res) => {
    const q = await ownedQuestionnaire(paramId(req.params.id), req.user!);
    const [links, grouped] = await Promise.all([
      prisma.questionnaireQuestion.findMany({
        where: { questionnaireId: q.id },
        orderBy: { position: "asc" },
        include: { question: { select: { id: true, title: true, type: true, subject: { select: { name: true } } } } },
      }),
      prisma.answer.groupBy({ by: ["questionId", "isCorrect"], where: { attempt: { questionnaireId: q.id } }, _count: true }),
    ]);
    const count = (qid: string, f: (g: { isCorrect: boolean | null }) => boolean) => grouped.filter((g) => g.questionId === qid && f(g)).reduce((n, g) => n + g._count, 0);
    res.json({
      questionnaire: { id: q.id, title: q.title },
      questions: links.map((l, i) => ({
        position: i + 1,
        ...l.question,
        subject: l.question.subject.name,
        received: count(l.questionId, () => true),
        correct: count(l.questionId, (g) => g.isCorrect === true),
        wrong: count(l.questionId, (g) => g.isCorrect === false),
        pending: count(l.questionId, (g) => g.isCorrect === null),
      })),
    });
  });

  // Respostas recebidas de uma questão (todas as pessoas), para avaliar em sequência.
  r.get("/questionnaires/:id/questions/:questionId/answers", async (req, res) => {
    const q = await ownedQuestionnaire(paramId(req.params.id), req.user!);
    const questionId = paramId(req.params.questionId);
    const question = await prisma.question.findUnique({ where: { id: questionId }, include: QUESTION_INCLUDE });
    if (!question) throw notFound("Questão");
    const answers = await prisma.answer.findMany({
      where: { questionId, attempt: { questionnaireId: q.id } },
      include: { ...ANSWER_INCLUDE, attempt: { select: { id: true, status: true, completedAt: true, user: { select: { id: true, name: true, email: true } } } } },
      orderBy: { updatedAt: "asc" },
    });
    const orders = await prisma.attemptQuestion.findMany({ where: { questionId, attemptId: { in: answers.map((a) => a.attemptId) } }, select: { attemptId: true, alternativeOrder: true } });
    const orderByAttempt = new Map(orders.map((o) => [o.attemptId, o.alternativeOrder]));
    const rows = answers.map((a) => {
      const p = present(question, orderByAttempt.get(a.attemptId), a);
      return { answerId: a.id, attemptId: a.attemptId, user: a.attempt.user, attemptStatus: a.attempt.status, completedAt: a.attempt.completedAt, canGrade: a.attempt.status === "COMPLETED", given: p.given, matchesKey: p.matchesKey, isCorrect: a.isCorrect };
    });
    const key = present(question, null, undefined).key;
    res.json({
      questionnaire: { id: q.id, title: q.title },
      question: { id: question.id, title: question.title, type: question.type, subject: question.subject.name, content: question.content, explanation: question.explanation },
      key,
      summary: { received: rows.length, correct: rows.filter((x) => x.isCorrect === true).length, wrong: rows.filter((x) => x.isCorrect === false).length, pending: rows.filter((x) => x.isCorrect === null).length },
      rows,
    });
  });

  return r;
}
