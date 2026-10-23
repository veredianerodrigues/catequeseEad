import { z } from "zod";

export const QUESTION_TYPES = ["SINGLE", "MULTIPLE", "ASSERTIONS", "TRUE_FALSE", "OPEN"] as const;
export const SUBJECT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const QUESTION_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export const ATTEMPT_STATUSES = ["IN_PROGRESS", "COMPLETED", "ABANDONED"] as const;
export const ROLES = ["USER", "ADMIN"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];
export type Role = (typeof ROLES)[number];

export const LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  pdfBytes: 20 * 1024 * 1024,
  imageMimes: ["image/jpeg", "image/png", "image/webp"],
  pdfMimes: ["application/pdf"],
  openAnswerChars: 10000,
  alternativesMax: 10,
  itemsMax: 20,
  importBytes: 5 * 1024 * 1024,
} as const;

const id = z.string().min(1).max(40);
const richDoc = z.object({ type: z.literal("doc") }).passthrough();

export const googleLoginSchema = z.object({ idToken: z.string().min(8).max(4096) });

export const alternativeInputSchema = z.object({
  id: id.optional(),
  text: z.string().trim().min(1, "Alternativa vazia").max(2000),
  isCorrect: z.boolean(),
});

export const itemInputSchema = z.object({
  id: id.optional(),
  text: z.string().trim().min(1, "Item vazio").max(2000),
  /// Gabarito do item — usado apenas em verdadeiro/falso.
  isTrue: z.boolean().optional(),
});

export const questionInputSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  status: z.enum(QUESTION_STATUSES),
  /// Opcional: se vazio, o servidor gera a partir do enunciado.
  title: z.string().trim().max(200).default(""),
  content: richDoc,
  subjectId: id,
  alternatives: z.array(alternativeInputSchema).max(LIMITS.alternativesMax).default([]),
  items: z.array(itemInputSchema).max(LIMITS.itemsMax).default([]),
  expectedAnswer: z.string().trim().max(10000).default(""),
  explanation: z.string().trim().max(10000).default(""),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const subjectInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(100),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(SUBJECT_STATUSES).default("ACTIVE"),
});
export type SubjectInput = z.infer<typeof subjectInputSchema>;

export const questionnaireInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(QUESTION_STATUSES),
  shuffleAlternatives: z.boolean().default(false),
  questionIds: z.array(id).max(500).default([]),
});
export type QuestionnaireInput = z.infer<typeof questionnaireInputSchema>;

export const answerInputSchema = z.object({
  text: z.string().max(LIMITS.openAnswerChars).optional(),
  alternativeIds: z.array(id).max(LIMITS.alternativesMax).optional(),
  /// Verdadeiro/falso: resposta por item (itens ausentes ficam sem resposta).
  items: z.array(z.object({ itemId: id, value: z.boolean() })).max(LIMITS.itemsMax).optional(),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const progressInputSchema = z.object({ currentIndex: z.number().int().min(0).max(1000) });
export const roleInputSchema = z.object({ role: z.enum(ROLES) });
export const youtubeInputSchema = z.object({ url: z.string().min(1).max(500) });

type StructureInput = {
  type: QuestionType;
  alternatives: { isCorrect: boolean }[];
  items: { isTrue?: boolean }[];
};

/** Regras de estrutura por tipo. Rascunhos podem violá-las; publicação e importação não. */
export function structureIssues(q: StructureInput): string[] {
  const issues: string[] = [];
  const correct = q.alternatives.filter((a) => a.isCorrect).length;
  const needAlternatives = () => {
    if (q.alternatives.length < 2) issues.push("É preciso ter ao menos 2 alternativas.");
  };
  switch (q.type) {
    case "SINGLE":
      needAlternatives();
      if (q.alternatives.length >= 2 && correct !== 1) issues.push("Múltipla escolha exige exatamente 1 alternativa correta.");
      break;
    case "MULTIPLE":
      needAlternatives();
      if (q.alternatives.length >= 2 && correct < 1) issues.push("Marque ao menos uma alternativa correta.");
      break;
    case "ASSERTIONS":
      if (q.items.length < 2) issues.push("Análise de assertivas exige ao menos 2 itens.");
      needAlternatives();
      if (q.alternatives.length >= 2 && correct !== 1) issues.push("Assertivas exigem exatamente 1 alternativa correta.");
      break;
    case "TRUE_FALSE":
      if (q.items.length < 2) issues.push("Verdadeiro ou falso exige ao menos 2 itens.");
      if (q.items.some((i) => typeof i.isTrue !== "boolean")) issues.push("Defina V ou F para todos os itens.");
      break;
    case "OPEN":
      break;
  }
  return issues;
}

/** Validação de publicação. */
export function publishIssues(q: StructureInput): string[] {
  return structureIssues(q);
}

export const TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE: "Múltipla escolha",
  MULTIPLE: "Múltipla seleção",
  ASSERTIONS: "Análise de assertivas",
  TRUE_FALSE: "Verdadeiro ou falso",
  OPEN: "Aberta",
};

// Tipos de resposta da API
export type Me = { id: string; name: string; email: string; role: Role; csrfToken: string };

export type AttemptQuestionView = {
  questionId: string;
  position: number;
  type: QuestionType;
  content: unknown;
  alternatives: { id: string; label: string; text: string }[];
  /// Itens (assertivas I..IV ou afirmações de V/F), sem gabarito.
  items: { id: string; label: string; text: string }[];
  answer: { text: string | null; alternativeIds: string[]; items: { itemId: string; value: boolean }[] } | null;
};

export type AttemptView = {
  id: string;
  questionnaire: { id: string; title: string };
  status: AttemptStatus;
  currentIndex: number;
  total: number;
  answered: number;
  startedAt: string;
  completedAt: string | null;
  questions: AttemptQuestionView[];
};

export const drawInputSchema = z.object({
  rules: z.array(z.object({ subjectId: id, count: z.number().int().min(1).max(200) })).min(1).max(30),
  /// Questões já presentes no questionário: não são sorteadas de novo.
  excludeIds: z.array(id).max(500).default([]),
});

export const importDraftSchema = z.object({
  type: z.enum(QUESTION_TYPES).nullable(),
  statement: z.string().max(20000),
  items: z.array(z.object({ text: z.string().max(2000), isTrue: z.boolean() })).max(LIMITS.itemsMax),
  alternatives: z.array(z.object({ text: z.string().max(2000), isCorrect: z.boolean() })).max(LIMITS.alternativesMax),
  expectedAnswer: z.string().max(10000).default(""),
  explanation: z.string().max(10000).default(""),
  key: z.string().max(40),
});
export const importCommitSchema = z.object({
  subjectId: id,
  status: z.enum(QUESTION_STATUSES).default("DRAFT"),
  questions: z.array(importDraftSchema).min(1).max(500),
});
export const importCheckSchema = z.object({ subjectId: id, statements: z.array(z.string().max(20000)).max(500) });
