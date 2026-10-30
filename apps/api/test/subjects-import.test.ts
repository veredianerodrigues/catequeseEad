import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doc, login, makeSubject, prisma, resetDb, seedQuestionnaire, type Client } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

const MODEL = `Assunto: Sacramentos

Questão 1
Tipo: multipla_escolha
Enunciado: Quantos são os sacramentos?
Alternativas:
a) Cinco
b) Sete
Resposta: B
Explicação: Sete.

Questão 2
Tipo: assertivas
Enunciado: Sobre o Batismo:
Itens:
I. Perdoa o pecado original.
II. Pode ser repetido.
Alternativas:
a) Apenas I
b) Apenas II
Resposta: a

Questão 3
Tipo: verdadeiro_falso
Enunciado: Julgue:
Itens:
1. A Eucaristia é fonte da vida cristã.
2. A Crisma cura.
Resposta: V, F

Questão 4
Tipo: multipla_selecao
Enunciado: Iniciação:
Alternativas:
a) Batismo
b) Crisma
c) Unção
Resposta: A e B

Questão 5
Tipo: aberta
Enunciado: O que é a graça?
Resposta: Dom de Deus.

Questão 6
Tipo: charada
Enunciado: Tipo inválido

Questão 7
Tipo: multipla_escolha
Enunciado: Resposta fora das alternativas
Alternativas:
a) x
b) y
Resposta: D

Questão 8
Tipo: aberta
Enunciado:
`;

const send = (admin: Client, content: string, name = "modelo.md", url = "/admin/import/preview") =>
  admin.upload(url, Buffer.from(content, "utf8"), name);

describe("assuntos", () => {
  it("impede nomes repetidos (sem diferenciar maiúsculas/acentos) e valida campos", async () => {
    const admin = await login("g-admin", "admin@test.com");
    await makeSubject(admin, "Sacramentos");
    expect((await admin.post("/admin/subjects", { name: "sacramentos" })).status).toBe(409);
    expect((await admin.post("/admin/subjects", { name: "  " })).status).toBe(400);
  });

  it("lista com contagem de questões, busca e filtro por status", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const { subjectId } = await seedQuestionnaire(admin, { open: 1, multiple: 1 });
    await makeSubject(admin, "Liturgia", "INACTIVE");
    const all = await admin.get("/admin/subjects");
    expect(all.body.find((s: { id: string }) => s.id === subjectId).questionCount).toBe(2);
    expect((await admin.get("/admin/subjects?status=INACTIVE")).body.map((s: { name: string }) => s.name)).toEqual(["Liturgia"]);
    expect((await admin.get("/admin/subjects?q=gera")).body).toHaveLength(1);
  });

  it("assunto com questões só pode ser inativado; sem questões pode ser excluído", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const { subjectId } = await seedQuestionnaire(admin, { open: 1, multiple: 0 });
    expect((await admin.del(`/admin/subjects/${subjectId}`)).status).toBe(409);
    const upd = await admin.put(`/admin/subjects/${subjectId}`, { name: "Geral", description: "x", status: "INACTIVE" });
    expect(upd.body.status).toBe("INACTIVE");
    const empty = await makeSubject(admin, "Vazio");
    expect((await admin.del(`/admin/subjects/${empty}`)).status).toBe(204);
  });

  it("assunto inativo não aceita novas questões, mas as existentes continuam editáveis", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const { subjectId, questionIds } = await seedQuestionnaire(admin, { open: 1, multiple: 0 });
    await admin.put(`/admin/subjects/${subjectId}`, { name: "Geral", status: "INACTIVE" });
    const body = { type: "OPEN", status: "PUBLISHED", title: "n", content: doc("nova"), subjectId };
    expect((await admin.post("/admin/questions", body)).status).toBe(422);
    expect((await admin.put(`/admin/questions/${questionIds[0]}`, { ...body, content: doc("editada") })).status).toBe(200);
  });

  it("usuários comuns não acessam o módulo", async () => {
    const user = await login("g-user", "user@test.com");
    expect((await user.get("/admin/subjects")).status).toBe(403);
    expect((await user.post("/admin/subjects", { name: "X" })).status).toBe(403);
    expect((await send(user, MODEL)).status).toBe(403);
    expect((await user.post("/admin/import/commit", {})).status).toBe(403);
    expect((await user.post("/admin/questionnaires/draw", {})).status).toBe(403);
  });
});

describe("tipos de questão", () => {
  async function base() {
    const admin = await login("g-admin", "admin@test.com");
    return { admin, subjectId: await makeSubject(admin) };
  }
  const alts = (correct: boolean[]) => correct.map((isCorrect, i) => ({ text: `Alt ${i}`, isCorrect }));

  it("aplica as regras de publicação de cada tipo", async () => {
    const { admin, subjectId } = await base();
    const mk = (extra: object) => admin.post("/admin/questions", { status: "PUBLISHED", subjectId, title: "t", content: doc("x"), ...extra });
    expect((await mk({ type: "SINGLE", alternatives: alts([true, true]) })).status).toBe(422);
    expect((await mk({ type: "SINGLE", alternatives: alts([false, true]) })).status).toBe(201);
    expect((await mk({ type: "ASSERTIONS", items: [{ text: "a" }], alternatives: alts([true, false]) })).status).toBe(422);
    expect((await mk({ type: "ASSERTIONS", items: [{ text: "a" }, { text: "b" }], alternatives: alts([true, false]) })).status).toBe(201);
    expect((await mk({ type: "TRUE_FALSE", items: [{ text: "a" }, { text: "b", isTrue: true }] })).status).toBe(422);
    const tf = await mk({ type: "TRUE_FALSE", items: [{ text: "a", isTrue: false }, { text: "b", isTrue: true }], explanation: "porque sim" });
    expect(tf.status).toBe(201);
    expect(tf.body.items.map((i: { isTrue: boolean }) => i.isTrue)).toEqual([false, true]);
    expect(tf.body.explanation).toBe("porque sim");
    const open = await mk({ type: "OPEN", expectedAnswer: "Dom de Deus" });
    expect(open.body.expectedAnswer).toBe("Dom de Deus");
    expect(open.body.title).toBe("t");
  });

  it("gera o título a partir do enunciado quando não informado", async () => {
    const { admin, subjectId } = await base();
    const r = await admin.post("/admin/questions", { status: "DRAFT", type: "OPEN", subjectId, content: doc("Explique a graça") });
    expect(r.body.title).toBe("Explique a graça");
  });

  it("participante responde V/F por item e assertivas por alternativa, sem ver gabarito nem explicação", async () => {
    const { admin, subjectId } = await base();
    const user = await login("g-user", "user@test.com");
    const common = { status: "PUBLISHED", subjectId, title: "t", explanation: "SEGREDO", content: doc("x") };
    const tf = await admin.post("/admin/questions", { ...common, type: "TRUE_FALSE", items: [{ text: "a", isTrue: true }, { text: "b", isTrue: false }] });
    const as = await admin.post("/admin/questions", { ...common, type: "ASSERTIONS", items: [{ text: "i" }, { text: "ii" }], alternatives: alts([false, true]) });
    const op = await admin.post("/admin/questions", { ...common, type: "OPEN", expectedAnswer: "SEGREDO" });
    const qn = await admin.post("/admin/questionnaires", { title: "Q", status: "PUBLISHED", questionIds: [tf.body.id, as.body.id, op.body.id] });

    const attempt = (await user.post(`/questionnaires/${qn.body.id}/attempts`)).body;
    expect(JSON.stringify(attempt)).not.toMatch(/SEGREDO|isTrue|isCorrect|expectedAnswer|explanation/);
    const view = (type: string) => attempt.questions.find((q: { type: string }) => q.type === type);

    const tfq = view("TRUE_FALSE");
    expect(tfq.items.map((i: { label: string }) => i.label)).toEqual(["1", "2"]);
    const put = (qid: string, body: object) => user.put(`/attempts/${attempt.id}/answers/${qid}`, body);
    expect((await put(tfq.questionId, { items: [{ itemId: tfq.items[0].id, value: true }, { itemId: tfq.items[1].id, value: false }] })).status).toBe(200);
    expect((await put(tfq.questionId, { items: [{ itemId: "inexistente", value: true }] })).status).toBe(422);
    expect((await put(tfq.questionId, { alternativeIds: ["x"] })).status).toBe(422);

    const asq = view("ASSERTIONS");
    expect(asq.items.map((i: { label: string }) => i.label)).toEqual(["I", "II"]);
    expect((await put(asq.questionId, { alternativeIds: asq.alternatives.map((a: { id: string }) => a.id) })).status).toBe(422);
    expect((await put(asq.questionId, { alternativeIds: [asq.alternatives[1].id] })).status).toBe(200);
    expect((await put(view("OPEN").questionId, { items: [{ itemId: tfq.items[0].id, value: true }] })).status).toBe(422);

    const resumed = (await (await login("g-user", "user@test.com")).get(`/attempts/${attempt.id}`)).body;
    expect(resumed.answered).toBe(2);
    expect(resumed.questions.find((q: { type: string }) => q.type === "TRUE_FALSE").answer.items).toHaveLength(2);
    // limpar remove o registro
    await put(tfq.questionId, { items: [] });
    expect(await prisma.answerItem.count()).toBe(0);
  });
});

describe("importação de questões", () => {
  it("gera pré-visualização com válidas, erros com motivo e sugestão de assunto, sem gravar", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const subjectId = await makeSubject(admin, "Sacramentos");
    const r = await send(admin, MODEL);
    expect(r.status).toBe(200);
    expect(r.body.subjectName).toBe("Sacramentos");
    expect(r.body.suggestedSubjectId).toBe(subjectId);
    const drafts = r.body.drafts as { type: string | null; errors: string[] }[];
    expect(drafts).toHaveLength(8);
    expect(drafts.filter((d) => d.errors.length === 0)).toHaveLength(5);
    expect(drafts[5]!.errors).toContain("Tipo não reconhecido.");
    expect(drafts[6]!.errors.join()).toMatch(/incompatível com as alternativas/);
    expect(drafts[7]!.errors).toContain("Enunciado vazio.");
    expect(await prisma.question.count()).toBe(0);
  });

  it("lê arquivos .docx", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const buf = fs.readFileSync(path.join(__dirname, "fixtures", "modelo.docx"));
    const r = await admin.upload("/admin/import/preview", buf, "modelo.docx");
    expect(r.status).toBe(200);
    expect(r.body.subjectName).toBe("Liturgia");
    expect(r.body.drafts.map((d: { type: string; errors: string[] }) => [d.type, d.errors.length])).toEqual([["SINGLE", 0], ["TRUE_FALSE", 0]]);
    expect(r.body.drafts[0].explanation).toBe("Tempo de preparação.");
  });

  it("os modelos distribuídos para download (.docx e .md) são lidos sem erro", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const pub = path.join(__dirname, "..", "..", "web", "public");
    for (const file of ["modelo-importacao.docx", "modelo-importacao.md"]) {
      const r = await admin.upload("/admin/import/preview", fs.readFileSync(path.join(pub, file)), file);
      expect(r.status, file).toBe(200);
      expect(r.body.drafts.map((d: { type: string; errors: string[] }) => [d.type, d.errors.length]), file).toEqual([
        ["SINGLE", 0], ["MULTIPLE", 0], ["ASSERTIONS", 0], ["TRUE_FALSE", 0], ["OPEN", 0],
      ]);
    }
  });

  it("importa o arquivo .txt do autor (tipo no cabeçalho) com as 6 questões válidas", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const buf = fs.readFileSync(path.join(__dirname, "fixtures", "sacramentos-autor.txt"));
    const r = await admin.upload("/admin/import/preview", buf, "Assunto Sacramentos.txt");
    expect(r.status).toBe(200);
    expect(r.body.subjectName).toBe("Sacramentos");
    expect(r.body.drafts.map((d: { type: string; errors: string[] }) => [d.type, d.errors.length])).toEqual([
      ["OPEN", 0], ["MULTIPLE", 0], ["ASSERTIONS", 0], ["TRUE_FALSE", 0], ["MULTIPLE", 0], ["OPEN", 0],
    ]);
  });

  it("recusa arquivo com mais de um assunto", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const r = await send(admin, "Assunto: A\nQuestão 1\nTipo: aberta\nEnunciado: x\n\nAssunto: B\nQuestão 2\nTipo: aberta\nEnunciado: y\n");
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/2 assuntos.*um arquivo por assunto/);
  });

  it("rejeita formatos e conteúdo inválidos", async () => {
    const admin = await login("g-admin", "admin@test.com");
    expect((await send(admin, MODEL, "modelo.pdf")).status).toBe(422);
    expect((await admin.upload("/admin/import/preview", Buffer.from("não é zip"), "x.docx")).status).toBe(422);
    expect((await admin.upload("/admin/import/preview", Buffer.from("não é ole"), "x.doc")).status).toBe(422);
    expect((await send(admin, "texto sem questões")).status).toBe(422);
  });

  it("grava só as válidas, editadas na pré-visualização, e sinaliza repetidas", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const subjectId = await makeSubject(admin, "Sacramentos");
    const preview = (await send(admin, MODEL)).body;
    const drafts = preview.drafts as Record<string, unknown>[] & { key: string; statement: string; errors: string[] }[];

    // corrige a questão 7 (resposta fora das alternativas) e edita o enunciado da 1
    const fixed = drafts.map((d) => ({ ...d }));
    fixed[6] = { ...fixed[6], alternatives: [{ text: "x", isCorrect: false }, { text: "y", isCorrect: true }], parseErrors: [] };
    fixed[0] = { ...fixed[0], statement: "Quantos sacramentos existem?" };
    const toSend = [0, 1, 2, 3, 4, 5, 6].map((i) => fixed[i]);

    const res = await admin.post("/admin/import/commit", { subjectId, status: "DRAFT", questions: toSend });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(6);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reasons).toContain("Tipo não reconhecido.");

    const saved = await prisma.question.findMany({ where: { subjectId }, include: { alternatives: true, items: true } });
    expect(saved).toHaveLength(6);
    expect(saved.every((q) => q.status === "DRAFT")).toBe(true);
    const sing = saved.find((q) => q.title.startsWith("Quantos sacramentos existem"))!;
    expect(sing.type).toBe("SINGLE");
    expect(sing.alternatives.filter((a) => a.isCorrect).map((a) => a.text)).toEqual(["Sete"]);
    expect(sing.explanation).toBe("Sete.");
    const tf = saved.find((q) => q.type === "TRUE_FALSE")!;
    expect(tf.items.sort((a, b) => a.position - b.position).map((i) => i.isTrue)).toEqual([true, false]);
    expect(saved.find((q) => q.type === "OPEN")!.expectedAnswer).toBe("Dom de Deus.");

    // reenviar as mesmas: todas repetidas
    const again = await admin.post("/admin/import/commit", { subjectId, status: "DRAFT", questions: toSend.slice(0, 5) });
    expect(again.body.created).toBe(0);
    expect(again.body.skipped.every((s: { reasons: string[] }) => s.reasons.includes("Questão repetida neste assunto."))).toBe(true);
    const check = await admin.post("/admin/import/check", { subjectId, statements: ["QUANTOS sacramentos existem", "outra coisa"] });
    expect(check.body.existing).toEqual([true, false]);
    expect(await prisma.question.count()).toBe(6);
  });

  it("detecta repetidas dentro do próprio arquivo e publica quando solicitado", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const subjectId = await makeSubject(admin);
    const q = { key: "a", type: "OPEN", statement: "Mesma pergunta?", items: [], alternatives: [], expectedAnswer: "", explanation: "" };
    const res = await admin.post("/admin/import/commit", { subjectId, status: "PUBLISHED", questions: [q, { ...q, key: "b", statement: "mesma  pergunta" }] });
    expect(res.body.created).toBe(1);
    expect(res.body.skipped[0]).toMatchObject({ key: "b", reasons: ["Questão repetida no próprio arquivo."] });
    expect((await prisma.question.findFirst())!.status).toBe("PUBLISHED");
  });

  it("não importa para assunto inativo", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const subjectId = await makeSubject(admin, "Velho", "INACTIVE");
    const q = { key: "a", type: "OPEN", statement: "x?", items: [], alternatives: [], expectedAnswer: "", explanation: "" };
    expect((await admin.post("/admin/import/commit", { subjectId, questions: [q] })).status).toBe(422);
  });
});

describe("sorteio por assunto", () => {
  it("sorteia a quantidade pedida, sem repetir e ignorando rascunhos, excluídas e assuntos inativos", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const a = (await seedQuestionnaire(admin, { open: 5, multiple: 0 })).subjectId;
    const b = await makeSubject(admin, "B");
    for (let i = 0; i < 3; i++) await admin.post("/admin/questions", { type: "OPEN", status: "PUBLISHED", subjectId: b, content: doc(`b${i}`) });
    await admin.post("/admin/questions", { type: "OPEN", status: "DRAFT", subjectId: b, content: doc("rascunho") });
    const off = await makeSubject(admin, "Inativo");
    await admin.post("/admin/questions", { type: "OPEN", status: "PUBLISHED", subjectId: off, content: doc("x") });
    await admin.put(`/admin/subjects/${off}`, { name: "Inativo", status: "INACTIVE" });

    const r = await admin.post("/admin/questionnaires/draw", { rules: [{ subjectId: a, count: 3 }, { subjectId: b, count: 5 }, { subjectId: off, count: 1 }] });
    expect(r.status).toBe(200);
    const ids = r.body.questions.map((q: { id: string }) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6); // 3 de A + 3 de B (só há 3 publicadas)
    expect(r.body.shortages).toEqual([
      { subjectId: b, requested: 5, got: 3 },
      { subjectId: off, requested: 1, got: 0 },
    ]);

    const again = await admin.post("/admin/questionnaires/draw", { rules: [{ subjectId: a, count: 5 }], excludeIds: ids });
    expect(again.body.questions).toHaveLength(2);
    expect(again.body.questions.every((q: { id: string }) => !ids.includes(q.id))).toBe(true);
  });
});
