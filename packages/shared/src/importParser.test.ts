import { describe, expect, it } from "vitest";
import { normalizeStatement, parseQuestionsText, textToDoc, validateDraft } from "./index";

const MODEL = `
Assunto: Sacramentos

Questão 1
Tipo: multipla_escolha
Enunciado: Quantos são os sacramentos?
Alternativas:
a) Cinco
b) Sete
c) Nove
Resposta: B
Explicação: A Igreja reconhece sete.

Questão 2
Tipo: assertivas
Enunciado: Sobre o Batismo:
Itens:
I. Perdoa o pecado original.
II. Pode ser repetido.
III. Imprime caráter.
Alternativas:
a) Apenas I
b) I e III
c) II e III
Resposta: b

Questão 3
Tipo: verdadeiro_falso
Enunciado: Julgue:
Itens:
1. A Eucaristia é fonte da vida cristã.
2. A Crisma é sacramento de cura.
3. O matrimônio é sacramento.
Resposta: V, F, V

Questão 4
Tipo: multipla_selecao
Enunciado: Sacramentos de iniciação:
Alternativas:
a) Batismo
b) Crisma
c) Unção
Resposta: A e B

Questão 5
Tipo: aberta
Enunciado: Explique o que é a graça.

Segundo parágrafo.
Resposta: Dom gratuito de Deus.
Explicação: Ver CIC 1996.
`;

describe("parseQuestionsText", () => {
  const { subjectName, drafts } = parseQuestionsText(MODEL);

  it("lê assunto e todas as questões do modelo", () => {
    expect(subjectName).toBe("Sacramentos");
    expect(drafts.map((d) => d.type)).toEqual(["SINGLE", "ASSERTIONS", "TRUE_FALSE", "MULTIPLE", "OPEN"]);
    expect(drafts.every((d) => validateDraft(d).length === 0)).toBe(true);
  });
  it("interpreta respostas por tipo", () => {
    expect(drafts[0]!.alternatives.map((a) => a.isCorrect)).toEqual([false, true, false]);
    expect(drafts[0]!.alternatives[0]!.text).toBe("Cinco");
    expect(drafts[1]!.items.map((i) => i.text)[0]).toBe("Perdoa o pecado original.");
    expect(drafts[1]!.alternatives.map((a) => a.isCorrect)).toEqual([false, true, false]);
    expect(drafts[2]!.items.map((i) => i.isTrue)).toEqual([true, false, true]);
    expect(drafts[3]!.alternatives.map((a) => a.isCorrect)).toEqual([true, true, false]);
    expect(drafts[4]!.expectedAnswer).toBe("Dom gratuito de Deus.");
    expect(drafts[4]!.statement).toContain("Segundo parágrafo.");
    expect(drafts[0]!.explanation).toBe("A Igreja reconhece sete.");
  });
  it("aceita markdown com negrito e listas", () => {
    const md = `**Assunto:** Fé\n\n## Questão 1\n- **Tipo:** Múltipla Escolha\n**Enunciado:** Texto?\n**Alternativas:**\n- a) Sim\n- b) Não\n**Resposta:** a`;
    const r = parseQuestionsText(md);
    expect(r.subjectName).toBe("Fé");
    expect(r.drafts[0]!.type).toBe("SINGLE");
    expect(validateDraft(r.drafts[0]!)).toEqual([]);
  });
  it("marca problemas com o motivo", () => {
    const bad = parseQuestionsText(`Questão 1\nTipo: charada\nEnunciado: x\n\nQuestão 2\nTipo: aberta\nEnunciado:\n\nQuestão 3\nTipo: multipla_escolha\nEnunciado: y\nAlternativas:\na) 1\nb) 2\nResposta: D\n\nQuestão 4\nTipo: verdadeiro_falso\nEnunciado: z\nItens:\n1. a\n2. b\nResposta: V`);
    expect(validateDraft(bad.drafts[0]!)).toContain("Tipo não reconhecido.");
    expect(validateDraft(bad.drafts[1]!)).toContain("Enunciado vazio.");
    expect(validateDraft(bad.drafts[2]!).join()).toMatch(/incompatível com as alternativas/);
    expect(validateDraft(bad.drafts[3]!).join()).toMatch(/1 valores V\/F para 2 itens/);
  });
});

describe("vários assuntos no mesmo arquivo", () => {
  it("lista os assuntos distintos", () => {
    const r = parseQuestionsText("Assunto: Credo\nQuestão 1\nTipo: aberta\nEnunciado: a\n\nAssunto: Maria\nQuestão 2\nTipo: aberta\nEnunciado: b\n\nAssunto: credo\n");
    expect(r.subjectNames).toEqual(["Credo", "Maria"]);
  });
});

describe("utilitários", () => {
  it("normaliza enunciados para comparar repetidas", () => {
    expect(normalizeStatement("Quantos são os SACRAMENTOS?")).toBe(normalizeStatement("quantos  sao os sacramentos"));
  });
  it("converte texto em documento", () => {
    const d = textToDoc("a\nb\n\nc");
    expect(d.content).toHaveLength(2);
    expect(d.content![0]!.content!.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
  });
});

describe("arquivo de exemplo distribuído", () => {
  it("é lido sem nenhum erro", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const file = fileURLToPath(new URL("../../../apps/web/public/modelo-importacao.md", import.meta.url));
    const r = parseQuestionsText(readFileSync(file, "utf8"));
    expect(r.drafts).toHaveLength(5);
    expect(r.drafts.flatMap(validateDraft)).toEqual([]);
  });
});

describe("formato do autor (tipo no cabeçalho, itens e alternativas soltos)", () => {
  it("lê o arquivo de Sacramentos: 6 questões, todas válidas", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const file = fileURLToPath(new URL("../../../apps/api/test/fixtures/sacramentos-autor.txt", import.meta.url));
    const r = parseQuestionsText(readFileSync(file, "utf8"));
    expect(r.subjectNames).toEqual(["Sacramentos"]);
    expect(r.drafts.map((d) => d.type)).toEqual(["OPEN", "MULTIPLE", "ASSERTIONS", "TRUE_FALSE", "MULTIPLE", "OPEN"]);
    expect(r.drafts.flatMap(validateDraft)).toEqual([]);

    const [open, multi, assert, tf, multi2, open2] = r.drafts;
    expect(open!.expectedAnswer).toContain("Iniciação cristã: Batismo");
    expect(open!.expectedAnswer).toContain("Ordem e Matrimônio.");
    expect(multi!.alternatives.map((a) => a.text)).toEqual(["Batismo", "Matrimônio", "Eucaristia", "Unção dos Enfermos", "Confirmação (Crisma)", "Ordem"]);
    expect(multi!.alternatives.map((a) => a.isCorrect)).toEqual([true, false, true, false, true, false]);
    expect(multi!.statement).not.toContain(" / ");
    expect(assert!.items).toHaveLength(4);
    expect(assert!.items[0]!.text).toBe("A Igreja Católica reconhece sete sacramentos.");
    expect(assert!.alternatives.map((a) => a.isCorrect)).toEqual([false, true, false, false]);
    expect(assert!.statement).toBe("Sobre os sacramentos da Igreja, analise as afirmações:");
    expect(tf!.items.map((i) => i.isTrue)).toEqual([true, false, true, false, true]);
    expect(tf!.items[0]!.text).toBe("A Penitência (Reconciliação) é um sacramento de cura.");
    expect(multi2!.alternatives.map((a) => a.isCorrect)).toEqual([true, false, true, false, true, false]);
    expect(open2!.expectedAnswer).toContain("Observação: aceitar respostas");
  });

  it("aceita cabeçalho com separadores diferentes, enunciado logo após o cabeçalho e cercas de código", () => {
    const r = parseQuestionsText("```\nAssunto: Credo\n\nQUESTÃO 1 - Análise de assertivas (Credo)\nSobre o Credo:\nI. Um.\nII. Dois.\nA) Apenas I\nB) Apenas II\nResposta: A\n```");
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]!.type).toBe("ASSERTIONS");
    expect(r.drafts[0]!.statement).toBe("Sobre o Credo:");
    expect(validateDraft(r.drafts[0]!)).toEqual([]);
  });

  it("responde pelo texto da alternativa e acusa texto que não confere", () => {
    const base = "Questão 1\nTipo: multipla_selecao\nEnunciado: x\nAlternativas:\na) Fé\nb) Esperança\nc) Caridade\n";
    const ok = parseQuestionsText(base + "Resposta: Fé e Caridade.");
    expect(ok.drafts[0]!.alternatives.map((a) => a.isCorrect)).toEqual([true, false, true]);
    const bad = parseQuestionsText(base + "Resposta: Fé e Ira.");
    expect(validateDraft(bad.drafts[0]!).join()).toMatch(/incompatível com as alternativas/);
  });
});
