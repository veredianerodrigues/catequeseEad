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

export type ParsedFile = { subjectName: string | null; subjectNames: string[]; drafts: ImportDraft[] };

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

/** Tipo escrito em texto livre no cabeçalho ("Análise de assertivas (Magnificat)", "Múltipla seleção"…). */
export function parseTypeLoose(raw: string): QuestionType | null {
  const exact = parseType(raw);
  if (exact) return exact;
  const t = stripAccents(raw).toLowerCase().replace(/\(.*?\)/g, " ");
  if (t.includes("assertiva")) return "ASSERTIONS";
  if (t.includes("verdadeiro") || /\bv\s*\/\s*f\b/.test(t)) return "TRUE_FALSE";
  if (t.includes("selecao")) return "MULTIPLE";
  if (t.includes("multipla escolha") || t.includes("escolha unica")) return "SINGLE";
  if (t.includes("aberta") || t.includes("discursiva")) return "OPEN";
  return null;
}

const LABEL = /^\s*(?:[-*•]\s+)?(assunto|tipo|enunciado|itens|alternativas|resposta(?:\s+esperada)?|explica[cç][aã]o)\s*:\s*(.*)$/i;
// "Questão 3" ou "QUESTÃO 3 – Análise de assertivas" (o texto após o separador é o tipo).
const QUESTION = /^\s*(?:#+\s*)?quest[aã]o\s+(\d+)\s*(?:[:.\-–—)]\s*(.*))?$/i;
// Itens/alternativas escritos soltos no enunciado: "I. texto", "( ) texto", "A) texto".
const ITEM_INLINE = /^\s*(?:[-*•]\s+)?(?:\(\s*\)|[IVX]{1,5}[.)])\s+\S/;
const ALT_INLINE = /^\s*(?:[-*•]\s+)?\(?[A-Ja-j]\)\s+\S/;
const BOX_PREFIX = /^\s*(?:[-*•]\s+)?\(\s*\)\s*/;
const ITEM_PREFIX = /^\s*(?:[-*•]\s+)?\(?(?:[IVXivx]{1,5}|\d{1,2}|[A-Za-z])[).:]\s+/;
const ALT_PREFIX = /^\s*(?:[-*•]\s+)?\(?[A-Ja-j][).]\s+/;

type Field = "assunto" | "tipo" | "enunciado" | "itens" | "alternativas" | "resposta" | "explicacao";
type Raw = { ref: number | null; tipo: string; headerType: string; enunciado: string[]; itens: string[]; alternativas: string[]; resposta: string[]; explicacao: string[] };

const newRaw = (ref: number | null, headerType = ""): Raw => ({ ref, tipo: "", headerType, enunciado: [], itens: [], alternativas: [], resposta: [], explicacao: [] });
const joinText = (lines: string[]) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** Letras da resposta ("B", "A, C", "A e C", "AC"); null se a resposta não for escrita em letras. */
function answerLetters(text: string): string[] | null {
  const tokens = text
    .replace(/\bletras?\b/gi, " ")
    .split(/[\s,;.\-/&+()]+/)
    .filter(Boolean)
    .filter((t) => t !== "e"); // conjunção "A e C"; o "E" maiúsculo continua sendo a letra E
  if (!tokens.length || !tokens.every((t) => /^[A-Ja-j]$/.test(t) || /^[A-J]{2,}$/.test(t))) return null;
  return tokens.flatMap((t) => (t.length > 1 ? t.split("") : [t.toUpperCase()]));
}

/** Resposta escrita com o texto das alternativas ("Batismo, Eucaristia e Crisma"); devolve os índices ou null. */
function matchAlternativesByText(answer: string, alts: { text: string }[]): number[] | null {
  let rest = ` ${normalizeStatement(answer)} `;
  const order = alts.map((a, i) => ({ i, n: normalizeStatement(a.text) })).filter((x) => x.n).sort((x, y) => y.n.length - x.n.length);
  const hit: number[] = [];
  for (const { i, n } of order) {
    const needle = ` ${n} `;
    if (rest.includes(needle)) {
      hit.push(i);
      rest = rest.replace(needle, " ");
    }
  }
  const leftover = rest.split(" ").filter((t) => t && t !== "e" && t !== "ou");
  return hit.length && !leftover.length ? hit.sort((x, y) => x - y) : null;
}

function buildDraft(raw: Raw, index: number): ImportDraft {
  const type = raw.tipo ? parseType(raw.tipo) : parseTypeLoose(raw.headerType);
  const parseErrors: string[] = [];
  const wantsItems = type === "ASSERTIONS" || type === "TRUE_FALSE";
  const wantsAlts = type === "SINGLE" || type === "MULTIPLE" || type === "ASSERTIONS";

  // Itens e alternativas escritos soltos dentro do enunciado são separados dele.
  const statement: string[] = [];
  const inlineItems: string[] = [];
  const inlineAlts: string[] = [];
  for (const l of raw.enunciado) {
    if (wantsItems && ITEM_INLINE.test(l)) inlineItems.push(l);
    else if (wantsAlts && ALT_INLINE.test(l)) inlineAlts.push(l);
    else statement.push(l);
  }
  // Alternativas numa linha só, separadas por " / " (múltipla escolha/seleção).
  let slashAlts: string[] = [];
  if ((type === "SINGLE" || type === "MULTIPLE") && !raw.alternativas.length && !inlineAlts.length) {
    const k = statement.findIndex((l) => (l.match(/ \/ /g)?.length ?? 0) >= 2);
    if (k >= 0) {
      slashAlts = statement[k]!.split(" / ").map((x) => x.trim()).filter(Boolean);
      statement.splice(k, 1);
    }
  }

  const draft: ImportDraft = {
    key: `q${index + 1}`,
    ref: raw.ref,
    type,
    rawType: raw.tipo || raw.headerType,
    statement: joinText(statement),
    items: [],
    alternatives: [],
    expectedAnswer: "",
    explanation: joinText(raw.explicacao),
    parseErrors,
  };
  const answerText = joinText(raw.resposta);

  if (wantsItems) {
    draft.items = [...raw.itens, ...inlineItems].map((l) => ({
      text: (BOX_PREFIX.test(l) ? l.replace(BOX_PREFIX, "") : l.replace(ITEM_PREFIX, "")).trim(),
      isTrue: false,
    }));
  }
  if (wantsAlts) {
    draft.alternatives = [...raw.alternativas, ...inlineAlts, ...slashAlts].map((l) => ({ text: l.replace(ALT_PREFIX, "").trim(), isCorrect: false }));
    if (!answerText) parseErrors.push("Resposta ausente.");
    else {
      const letters = answerLetters(answerText);
      const idx = letters ? letters.map((l) => l.charCodeAt(0) - 65) : matchAlternativesByText(answerText, draft.alternatives);
      if (!idx || idx.some((i) => i < 0 || i >= draft.alternatives.length)) parseErrors.push(`Resposta incompatível com as alternativas: "${answerText}".`);
      else if (type !== "MULTIPLE" && new Set(idx).size > 1) parseErrors.push("Este tipo aceita apenas uma letra como resposta.");
      else for (const i of idx) draft.alternatives[i]!.isCorrect = true;
    }
  } else if (type === "TRUE_FALSE") {
    const seq = answerText.replace(/verdadeiro/gi, "V").replace(/falso/gi, "F").toUpperCase().replace(/[^VF]/g, "");
    if (!seq) parseErrors.push("Resposta ausente.");
    else if (seq.length !== draft.items.length) parseErrors.push(`Resposta incompatível: ${seq.length} valores V/F para ${draft.items.length} itens.`);
  } else if (type === "OPEN") {
    draft.expectedAnswer = answerText;
  }
  if (type === "TRUE_FALSE") {
    const seq = answerText.replace(/verdadeiro/gi, "V").replace(/falso/gi, "F").toUpperCase().replace(/[^VF]/g, "");
    draft.items.forEach((it, i) => (it.isTrue = seq[i] === "V"));
  }
  return draft;
}

/** Lê o texto (de .md ou extraído de .docx/.doc) no modelo "Questão n / Tipo / Enunciado / ...". */
export function parseQuestionsText(text: string): ParsedFile {
  let subjectName: string | null = null;
  const subjectNames: string[] = [];
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
    if (/^\s*```/.test(original)) continue; // cercas de bloco de código do Markdown
    const line = original.replace(/(\*\*|__)/g, "").replace(/^\s*>\s?/, "").trimEnd();
    const q = QUESTION.exec(line);
    if (q) {
      cur = newRaw(Number(q[1]), (q[2] ?? "").trim());
      raws.push(cur);
      field = null;
      continue;
    }
    const m = LABEL.exec(line);
    if (m) {
      const name = stripAccents(m[1]!).toLowerCase().replace(/\s+esperada$/, "") as Field;
      const value = m[2]!.trim();
      if (name === "assunto") {
        if (!subjectName && value) subjectName = value;
        if (value && !subjectNames.some((n) => normalizeStatement(n) === normalizeStatement(value))) subjectNames.push(value);
        field = "assunto";
        continue;
      }
      field = name;
      if (name === "tipo") push(name, value);
      else if (value) push(name, value);
      else ensure();
      continue;
    }
    if (!cur) continue;
    if (!field && line.trim()) field = "enunciado"; // texto logo após o cabeçalho = enunciado
    if (!field || field === "assunto" || field === "tipo") continue;
    push(field, line.trim() ? line : "");
  }

  return { subjectName, subjectNames, drafts: raws.map(buildDraft) };
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
