import { z } from "zod";

export const QUESTION_TYPES = ["OPEN", "MULTIPLE"] as const;
export const QUESTION_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export const ATTEMPT_STATUSES = ["IN_PROGRESS", "COMPLETED", "ABANDONED"] as const;
export const ROLES = ["USER", "ADMIN"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type Role = (typeof ROLES)[number];

export const LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  pdfBytes: 20 * 1024 * 1024,
  imageMimes: ["image/jpeg", "image/png", "image/webp"],
  pdfMimes: ["application/pdf"],
  openAnswerChars: 10000,
  alternativesMax: 10,
} as const;

const id = z.string().min(1).max(40);
const richDoc = z.object({ type: z.literal("doc") }).passthrough();

export const googleLoginSchema = z.object({ idToken: z.string().min(8).max(4096) });

export const alternativeInputSchema = z.object({
  id: id.optional(),
  text: z.string().trim().min(1, "Alternativa vazia").max(2000),
  isCorrect: z.boolean(),
});

export const questionInputSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  status: z.enum(QUESTION_STATUSES),
  title: z.string().trim().min(1, "Informe um título").max(200),
  content: richDoc,
  categoryId: id.nullable().optional(),
  alternatives: z.array(alternativeInputSchema).max(LIMITS.alternativesMax).default([]),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const questionnaireInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(QUESTION_STATUSES),
  shuffleAlternatives: z.boolean().default(false),
  questionIds: z.array(id).max(500).default([]),
});
export type QuestionnaireInput = z.infer<typeof questionnaireInputSchema>;

export const categoryInputSchema = z.object({ name: z.string().trim().min(1).max(100) });

export const answerInputSchema = z.object({
  text: z.string().max(LIMITS.openAnswerChars).optional(),
  alternativeIds: z.array(id).max(LIMITS.alternativesMax).optional(),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const progressInputSchema = z.object({ currentIndex: z.number().int().min(0).max(1000) });
export const roleInputSchema = z.object({ role: z.enum(ROLES) });
export const youtubeInputSchema = z.object({ url: z.string().min(1).max(500) });

/** Validação de publicação: regras que um rascunho ainda pode violar. */
export function publishIssues(q: Pick<QuestionInput, "type" | "alternatives">): string[] {
  const issues: string[] = [];
  if (q.type === "MULTIPLE") {
    if (q.alternatives.length < 2) issues.push("Questões de múltipla resposta precisam de ao menos 2 alternativas.");
    if (!q.alternatives.some((a) => a.isCorrect)) issues.push("Marque ao menos uma alternativa correta.");
  }
  return issues;
}

// Tipos de resposta da API
export type Me = { id: string; name: string; email: string; role: Role; csrfToken: string };

export type AttemptQuestionView = {
  questionId: string;
  position: number;
  type: QuestionType;
  content: unknown;
  alternatives: { id: string; label: string; text: string }[];
  answer: { text: string | null; alternativeIds: string[] } | null;
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
