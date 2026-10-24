import { Router, type RequestHandler } from "express";
import multer from "multer";
import type { PrismaClient } from "@prisma/client";
import {
  importCheckSchema,
  importCommitSchema,
  LIMITS,
  normalizeStatement,
  parseQuestionsText,
  textToDoc,
  validateDraft,
  type ImportDraft,
} from "@quiz/shared";
import { HttpError, notFound, unprocessable } from "../lib/errors";
import { extractText } from "../lib/importFile";
import { hashStatement, isFkError, prepareQuestion, writeQuestion } from "../lib/questions";

export function importRouter(prisma: PrismaClient, uploadLimiter: RequestHandler) {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.importBytes, files: 1 } });

  /** Para cada enunciado, indica se já existe questão igual no assunto. */
  async function existsInSubject(subjectId: string, statements: string[]): Promise<boolean[]> {
    const hashes = statements.map((s) => hashStatement(s));
    const found = await prisma.question.findMany({ where: { subjectId, contentHash: { in: [...new Set(hashes)] } }, select: { contentHash: true } });
    const set = new Set(found.map((f) => f.contentHash));
    return hashes.map((h, i) => !!statements[i]?.trim() && set.has(h));
  }

  // Lê o arquivo e devolve a pré-visualização — nada é gravado.
  r.post("/preview", uploadLimiter, upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "Envie um arquivo no campo 'file'.");
    const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
    const text = await extractText(fileName, file.buffer);
    const { subjectName, subjectNames, drafts } = parseQuestionsText(text);
    if (subjectNames.length > 1) {
      throw unprocessable(`O arquivo tem ${subjectNames.length} assuntos (${subjectNames.join(", ")}). Importe um arquivo por assunto.`);
    }
    if (!drafts.length) throw unprocessable('Nenhuma questão encontrada. Confira se o arquivo usa "Questão 1", "Tipo:", "Enunciado:"…');

    let suggestedSubjectId: string | null = null;
    if (subjectName) {
      const wanted = normalizeStatement(subjectName);
      const subjects = await prisma.subject.findMany({ select: { id: true, name: true } });
      suggestedSubjectId = subjects.find((s) => normalizeStatement(s.name) === wanted)?.id ?? null;
    }
    res.json({
      fileName,
      subjectName,
      suggestedSubjectId,
      drafts: drafts.map((d) => ({ ...d, errors: validateDraft(d) })),
    });
  });

  r.post("/check", async (req, res) => {
    const { subjectId, statements } = importCheckSchema.parse(req.body);
    if (!(await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } }))) throw notFound("Assunto");
    res.json({ existing: await existsInSubject(subjectId, statements) });
  });

  // Grava apenas o que está válido e não é repetido; o restante volta com o motivo.
  r.post("/commit", async (req, res) => {
    const { subjectId, status, questions } = importCommitSchema.parse(req.body);
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw notFound("Assunto");
    if (subject.status === "INACTIVE") throw unprocessable("O assunto está inativo e não aceita novas questões.");

    const existing = await existsInSubject(subjectId, questions.map((q) => q.statement));
    const seen = new Set<string>();
    const skipped: { key: string; reasons: string[] }[] = [];
    const prepared: { key: string; p: Awaited<ReturnType<typeof prepareQuestion>> }[] = [];

    for (const [i, q] of questions.entries()) {
      const draft: Pick<ImportDraft, "type" | "statement" | "items" | "alternatives" | "parseErrors"> = { ...q, parseErrors: [] };
      const reasons = validateDraft(draft);
      const norm = normalizeStatement(q.statement);
      if (existing[i]) reasons.push("Questão repetida neste assunto.");
      else if (seen.has(norm)) reasons.push("Questão repetida no próprio arquivo.");
      if (!reasons.length) {
        try {
          prepared.push({
            key: q.key,
            p: await prepareQuestion(prisma, {
              type: q.type,
              status,
              title: "",
              content: textToDoc(q.statement),
              subjectId,
              alternatives: q.alternatives,
              items: q.type === "TRUE_FALSE" ? q.items : q.items.map(({ text }) => ({ text })),
              expectedAnswer: q.expectedAnswer,
              explanation: q.explanation,
            }),
          });
          seen.add(norm);
          continue;
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
          reasons.push(...(Array.isArray(e.details) ? (e.details as string[]) : [e.message]));
        }
      }
      skipped.push({ key: q.key, reasons });
    }

    let created: string[] = [];
    try {
      created = await prisma.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const { p } of prepared) ids.push(await writeQuestion(tx, p, req.user!.id));
        return ids;
      });
    } catch (e) {
      if (isFkError(e)) throw unprocessable("Falha ao gravar as questões. Nada foi importado.");
      throw e;
    }
    res.status(201).json({ created: created.length, createdKeys: prepared.map((x) => x.key), skipped });
  });

  return r;
}
