import { QUESTION_TYPES, structureIssues, type QuestionType } from "./schemas";
import type { RichNode } from "./richtext";

/** Rascunho de questão lido de um arquivo; é o mesmo formato editado na pré-visualização. */
export type ImportDraft = {
  key: string;
  ref: number | null;
  type: QuestionType | null;
  rawType: string;
  statement: string;
  items: { text: string; isTrue: boolean }[];
  alternatives: { text: string; isCorrect: boolean }[];
  expectedAnswer: string;
  explanation: string;
  /** Problemas detectados na leitura (ex.: resposta incompatível). Limpe ao corrigir a resposta. */
  parseErrors: string[];
};

export type ParsedFile = { subjectName: string | null; drafts: ImportDraft[] };

const TYPE_ALIASES: Record<string, QuestionType> = {
  assertivas: "ASSERTIONS",
  analise_de_assertivas: "ASSERTIONS",
  multipla_selecao: "MULTIPLE",
  verdadeiro_falso: "TRUE_FALSE",
  verdadeiro_ou_falso: "TRUE_FALSE",
  aberta: "OPEN",
  multipla_escolha: "SINGLE",
};

export const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Forma canônica do enunciado para detectar repetidas: sem acentos, caixa, pontuação e espaços extras. */
export function normalizeStatement(s: string): string {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseType(raw: string): QuestionType | null {
  const key = stripAccents(raw).toLowerCase().trim().replace(/[\s-]+/g, "_");
  return TYPE_ALIASES[key] ?? null;
}

const LABEL = /^\s*(?:[-*•]\s+)?(assunto|tipo|enunciado|itens|alternativas|resposta|explica[cç][aã]o)\s*:\s*(.*)$/i;
const QUESTION = /^\s*(?:#+\s*)?quest[aã]o\s+(\d+)\s*[:.\-)]?\s*$/i;
const ITEM_PREFIX = /^\s*(?:[-*•]\s+)?\(?(?:[IVXivx]{1,5}|\d{1,2}|[A-Za-z])[).:]\s+/;
const ALT_PREFIX = /^\s*(?:[-*•]\s+)?\(?[A-Ja-j][).]\s+/;

type Field = "assunto" | "tipo" | "enunciado" | "itens" | "alternativas" | "resposta" | "explicacao";
type Raw = { ref: number | null; tipo: string; enunciado: string[]; itens: string[]; alternativas: string[]; resposta: string[]; explicacao: string[] };

const newRaw = (ref: number | null): Raw => ({ ref, tipo: "", enunciado: [], itens: [], alternativas: [], resposta: [], explicacao: [] });
const joinText = (lines: string[]) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

function answerLetters(text: string): string[] {
  const cleaned = text.replace(/\bletras?\b/gi, " ");
  const tokens = cleaned
    .split(/[\s,;.\-/&+()]+/)
    .filter(Boolean)
    .filter((t) => t !== "e"); // conjunção "A e C"; o "E" maiúsculo continua sendo a letra E
  return tokens.flatMap((t) => (/^[A-Ja-j]{2,}$/.test(t) ? t.toUpperCase().split("") : [t.toUpperCase()]));
}

function buildDraft(raw: Raw, index: number): ImportDraft {
  const type = parseType(raw.tipo);
  const parseErrors: string[] = [];
  const draft: ImportDraft = {
    key: `q${index + 1}`,
    ref: raw.ref,
    type,
    rawType: raw.tipo,
    statement: joinText(raw.enunciado),
    items: [],
    alternatives: [],
    expectedAnswer: "",
    explanation: joinText(raw.explicacao),
    parseErrors,
  };
  const answerText = joinText(raw.resposta);

  if (type === "ASSERTIONS" || type === "TRUE_FALSE") {
    draft.items = raw.itens.map((l) => ({ text: l.replace(ITEM_PREFIX, "").trim(), isTrue: false }));
  }
  if (type === "SINGLE" || type === "MULTIPLE" || type === "ASSERTIONS") {
    draft.alternatives = raw.alternativas.map((l) => ({ text: l.replace(ALT_PREFIX, "").trim(), isCorrect: false }));
    if (!answerText) parseErrors.push("Resposta ausente.");
    else {
      const letters = answerLetters(answerText);
      const bad = letters.filter((l) => !/^[A-J]$/.test(l) || l.charCodeAt(0) - 65 >= draft.alternatives.length);
      if (bad.length || !letters.length) parseErrors.push(`Resposta incompatível com as alternativas: "${answerText}".`);
      else if (type !== "MULTIPLE" && new Set(letters).size > 1) parseErrors.push("Este tipo aceita apenas uma letra como resposta.");
      else for (const l of letters) draft.alternatives[l.charCodeAt(0) - 65]!.isCorrect = true;
    }
  } else if (type === "TRUE_FALSE") {
    const seq = answerText.replace(/verdadeiro/gi, "V").replace(/falso/gi, "F").toUpperCase().replace(/[^VF]/g, "");
    if (!seq) parseErrors.push("Resposta ausente.");
    else if (seq.length !== draft.items.length) parseErrors.push(`Resposta incompatível: ${seq.length} valores V/F para ${draft.items.length} itens.`);
    draft.items.forEach((it, i) => (it.isTrue = seq[i] === "V"));
  } else if (type === "OPEN") {
    draft.expectedAnswer = answerText;
  }
  return draft;
}

/** Lê o texto (de .md ou extraído de .docx/.doc) no modelo "Questão n / Tipo / Enunciado / ...". */
export function parseQuestionsText(text: string): ParsedFile {
  let subjectName: string | null = null;
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  let field: Field | null = null;

  const ensure = () => (cur ??= (raws.push(newRaw(null)), raws[raws.length - 1]!));
  const push = (f: Field, value: string) => {
    const q = ensure();
    if (f === "tipo") q.tipo = value.trim();
    else if (f === "assunto") return;
    else if (value.trim() || f === "enunciado" || f === "explicacao" || f === "resposta") q[f].push(value);
  };

  for (const original of text.replace(/\r/g, "").split("\n")) {
    const line = original.replace(/(\*\*|__)/g, "").replace(/^\s*>\s?/, "").trimEnd();
    const q = QUESTION.exec(line);
    if (q) {
      cur = newRaw(Number(q[1]));
      raws.push(cur);
      field = null;
      continue;
    }
    const m = LABEL.exec(line);
    if (m) {
      const name = stripAccents(m[1]!).toLowerCase() as Field;
      const value = m[2]!.trim();
      if (name === "assunto") {
        if (!subjectName && value) subjectName = value;
        field = "assunto";
        continue;
      }
      field = name;
      if (name === "tipo") push(name, value);
      else if (value) push(name, value);
      else ensure();
      continue;
    }
    if (!field || field === "assunto" || !cur) continue;
    if (field === "tipo") continue;
    push(field, line.trim() ? line : "");
  }

  return { subjectName, drafts: raws.map(buildDraft) };
}

/** Motivos pelos quais o rascunho não pode ser gravado (lista vazia = válido). */
export function validateDraft(d: Pick<ImportDraft, "type" | "statement" | "items" | "alternatives" | "parseErrors">): string[] {
  const issues: string[] = [];
  if (!d.type || !QUESTION_TYPES.includes(d.type)) issues.push("Tipo não reconhecido.");
  if (!d.statement.trim()) issues.push("Enunciado vazio.");
  issues.push(...d.parseErrors);
  if (d.type) {
    const hasAnswerProblem = d.parseErrors.length > 0;
    // Evita repetir "falta alternativa correta" quando já existe um erro de resposta mais específico.
    issues.push(...structureIssues({ type: d.type, alternatives: d.alternatives, items: d.items }).filter((i) => !(hasAnswerProblem && /correta|V ou F/.test(i))));
    if (d.alternatives.some((a) => !a.text.trim())) issues.push("Há alternativa vazia.");
    if (d.items.some((i) => !i.text.trim())) issues.push("Há item vazio.");
  }
  return issues;
}

/** Texto simples (linhas) → documento TipTap: linha em branco separa parágrafos, quebra simples vira hardBreak. */
export function textToDoc(text: string): RichNode {
  const paragraphs = text.trim().split(/\n{2,}/).filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i): RichNode[] => [...(i ? [{ type: "hardBreak" }] : []), ...(line.trim() ? [{ type: "text", text: line.trim() }] : [])]),
    })),
  };
}
