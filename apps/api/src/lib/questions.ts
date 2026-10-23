import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  hasMeaningfulContent,
  normalizeStatement,
  publishIssues,
  questionInputSchema,
  richTextToPlain,
  sanitizeRichText,
  type QuestionInput,
  type RichNode,
} from "@quiz/shared";
import { conflict, notFound, unprocessable } from "./errors";

export const hashStatement = (plain: string) => crypto.createHash("sha256").update(normalizeStatement(plain)).digest("hex");

export const questionInclude = {
  alternatives: { orderBy: { position: "asc" as const } },
  items: { orderBy: { position: "asc" as const } },
  subject: { select: { id: true, name: true, status: true } },
};

export function isFkError(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014");
}

export type PreparedQuestion = {
  data: QuestionInput;
  doc: RichNode;
  mediaIds: string[];
  youtubeIds: string[];
  title: string;
  hash: string;
  alternatives: QuestionInput["alternatives"];
  items: QuestionInput["items"];
};

/** Valida, sanitiza e normaliza uma questão. Lança HttpError com o motivo quando inválida. */
export async function prepareQuestion(prisma: PrismaClient, input: unknown, currentSubjectId?: string): Promise<PreparedQuestion> {
  const data = questionInputSchema.parse(input);
  let sanitized;
  try {
    sanitized = sanitizeRichText(data.content);
  } catch (e) {
    throw unprocessable((e as Error).message);
  }
  const hasAlternatives = ["SINGLE", "MULTIPLE", "ASSERTIONS"].includes(data.type);
  const hasItems = data.type === "ASSERTIONS" || data.type === "TRUE_FALSE";
  const alternatives = hasAlternatives ? data.alternatives : [];
  const items = hasItems ? data.items.map((i) => (data.type === "TRUE_FALSE" ? i : { ...i, isTrue: undefined })) : [];

  if (data.status === "PUBLISHED") {
    const issues = publishIssues({ type: data.type, alternatives, items });
    if (!hasMeaningfulContent(sanitized.doc)) issues.unshift("O enunciado está vazio.");
    if (issues.length) throw unprocessable("A questão não pode ser publicada.", issues);
  }
  if (sanitized.mediaIds.length) {
    const found = await prisma.media.count({ where: { id: { in: sanitized.mediaIds }, kind: { in: ["IMAGE", "PDF"] } } });
    if (found !== sanitized.mediaIds.length) throw unprocessable("O enunciado referencia um arquivo inexistente.");
  }
  const subject = await prisma.subject.findUnique({ where: { id: data.subjectId } });
  if (!subject) throw unprocessable("Assunto inexistente.");
  if (subject.status === "INACTIVE" && subject.id !== currentSubjectId) throw unprocessable("O assunto está inativo e não aceita novas questões.");

  const plain = richTextToPlain(sanitized.doc);
  return {
    data,
    doc: sanitized.doc,
    mediaIds: sanitized.mediaIds,
    youtubeIds: sanitized.youtubeIds,
    title: data.title || (plain.slice(0, 80) || "Questão sem título"),
    hash: hashStatement(plain),
    alternatives,
    items,
  };
}

/** Grava (cria ou atualiza) uma questão já preparada, dentro de uma transação. */
export async function writeQuestion(tx: Prisma.TransactionClient, p: PreparedQuestion, userId: string, id?: string) {
  const { data } = p;
  const base = {
    type: data.type,
    status: data.status,
    title: p.title,
    content: p.doc as unknown as Prisma.InputJsonValue,
    searchText: `${p.title} ${richTextToPlain(p.doc)}`.slice(0, 60000),
    subjectId: data.subjectId,
    contentHash: p.hash,
    expectedAnswer: data.type === "OPEN" && data.expectedAnswer ? data.expectedAnswer : null,
    explanation: data.explanation || null,
  };
  let questionId = id;
  if (id) {
    if (!(await tx.question.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Questão");
    await tx.question.update({ where: { id }, data: base });
  } else {
    questionId = (await tx.question.create({ data: base })).id;
  }
  const qid = questionId!;

  // Alternativas e itens: atualiza os existentes por id, cria os novos, remove os ausentes.
  const existingAlts = new Set((await tx.alternative.findMany({ where: { questionId: qid }, select: { id: true } })).map((a) => a.id));
  const keepAlts = new Set<string>();
  for (const [position, alt] of p.alternatives.entries()) {
    if (alt.id && existingAlts.has(alt.id)) {
      keepAlts.add(alt.id);
      await tx.alternative.update({ where: { id: alt.id }, data: { position, text: alt.text, isCorrect: alt.isCorrect } });
    } else {
      await tx.alternative.create({ data: { questionId: qid, position, text: alt.text, isCorrect: alt.isCorrect } });
    }
  }
  const removeAlts = [...existingAlts].filter((x) => !keepAlts.has(x));
  if (removeAlts.length) await tx.alternative.deleteMany({ where: { id: { in: removeAlts } } });

  const existingItems = new Set((await tx.questionItem.findMany({ where: { questionId: qid }, select: { id: true } })).map((a) => a.id));
  const keepItems = new Set<string>();
  for (const [position, it] of p.items.entries()) {
    const isTrue = it.isTrue ?? null;
    if (it.id && existingItems.has(it.id)) {
      keepItems.add(it.id);
      await tx.questionItem.update({ where: { id: it.id }, data: { position, text: it.text, isTrue } });
    } else {
      await tx.questionItem.create({ data: { questionId: qid, position, text: it.text, isTrue } });
    }
  }
  const removeItems = [...existingItems].filter((x) => !keepItems.has(x));
  if (removeItems.length) await tx.questionItem.deleteMany({ where: { id: { in: removeItems } } });

  // Mídias: vincula arquivos usados e registra vídeos do YouTube.
  await tx.media.updateMany({ where: { questionId: qid, kind: { in: ["IMAGE", "PDF"] }, id: { notIn: p.mediaIds } }, data: { questionId: null } });
  if (p.mediaIds.length) await tx.media.updateMany({ where: { id: { in: p.mediaIds } }, data: { questionId: qid } });
  await tx.media.deleteMany({ where: { questionId: qid, kind: "YOUTUBE" } });
  if (p.youtubeIds.length) {
    await tx.media.createMany({ data: p.youtubeIds.map((youtubeId) => ({ kind: "YOUTUBE" as const, youtubeId, uploadedById: userId, questionId: qid })) });
  }
  return qid;
}

export async function saveQuestion(prisma: PrismaClient, input: unknown, userId: string, id?: string) {
  const current = id ? await prisma.question.findUnique({ where: { id }, select: { subjectId: true } }) : null;
  if (id && !current) throw notFound("Questão");
  const prepared = await prepareQuestion(prisma, input, current?.subjectId);
  try {
    return await prisma.$transaction(async (tx) => {
      const qid = await writeQuestion(tx, prepared, userId, id);
      return tx.question.findUniqueOrThrow({ where: { id: qid }, include: questionInclude });
    });
  } catch (e) {
    if (isFkError(e)) throw conflict("Uma alternativa ou item removido já foi usado em respostas. Despublique a questão em vez de removê-lo.");
    throw e;
  }
}

/** Completa o hash de questões antigas (criadas antes da detecção de repetidas). */
export async function backfillContentHashes(prisma: PrismaClient) {
  const rows = await prisma.question.findMany({ where: { contentHash: "" }, select: { id: true, content: true, title: true }, take: 5000 });
  for (const r of rows) {
    const plain = richTextToPlain(r.content as unknown as RichNode);
    await prisma.question.update({ where: { id: r.id }, data: { contentHash: hashStatement(plain || r.title) } });
  }
  return rows.length;
}
