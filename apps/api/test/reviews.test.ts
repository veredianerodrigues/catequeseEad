import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doc, login, makeSubject, prisma, resetDb, seedQuestionnaire, type Client } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

type Row = { answerId: string | null; question: { id: string; type: string }; given: any; key: any; matchesKey: boolean | null; isCorrect: boolean | null };

async function scenario() {
  const admin = await login("g-admin", "admin@test.com");
  const user = await login("g-user", "user@test.com");
  const subjectId = await makeSubject(admin);
  const open = await admin.post("/admin/questions", { type: "OPEN", status: "PUBLISHED", subjectId, content: doc("Explique a graça"), expectedAnswer: "Dom de Deus" });
  const multi = await admin.post("/admin/questions", {
    type: "MULTIPLE", status: "PUBLISHED", subjectId, content: doc("Dons?"),
    alternatives: [{ text: "Sabedoria", isCorrect: true }, { text: "Riqueza", isCorrect: false }, { text: "Fortaleza", isCorrect: true }],
  });
  const tf = await admin.post("/admin/questions", {
    type: "TRUE_FALSE", status: "PUBLISHED", subjectId, content: doc("Julgue"),
    items: [{ text: "a", isTrue: true }, { text: "b", isTrue: false }],
  });
  const qn = await admin.post("/admin/questionnaires", { title: "Avaliável", status: "PUBLISHED", questionIds: [open.body.id, multi.body.id, tf.body.id] });
  const attempt = (await user.post(`/questionnaires/${qn.body.id}/attempts`)).body;
  const view = (type: string) => attempt.questions.find((q: { type: string }) => q.type === type);
  const put = (qid: string, body: object) => user.put(`/attempts/${attempt.id}/answers/${qid}`, body);

  await put(view("OPEN").questionId, { text: "É um presente de Deus" });
  const m = view("MULTIPLE");
  const byText = (t: string) => m.alternatives.find((a: { text: string }) => a.text === t).id;
  await put(m.questionId, { alternativeIds: [byText("Sabedoria"), byText("Fortaleza")] }); // confere com o gabarito
  const t = view("TRUE_FALSE");
  await put(t.questionId, { items: [{ itemId: t.items[0].id, value: false }] }); // diverge e está incompleta
  return { admin, user, qn: qn.body.id as string, attemptId: attempt.id as string, complete: () => user.post(`/attempts/${attempt.id}/complete`) };
}

const detail = async (admin: Client, attemptId: string) => (await admin.get(`/admin/reviews/attempts/${attemptId}`)).body;

describe("vínculo do questionário ao criador", () => {
  it("grava quem criou e mostra na listagem", async () => {
    const { admin, qn } = await scenario();
    const row = await prisma.questionnaire.findUnique({ where: { id: qn }, select: { createdById: true } });
    expect(row?.createdById).toBeTruthy();
    const list = await admin.get("/admin/questionnaires");
    expect(list.body[0].createdBy.name).toMatch(/g-admin/);
  });

  it("só o criador avalia; outro administrador é barrado; legado sem criador é aberto a administradores", async () => {
    const { admin, qn, attemptId, complete } = await scenario();
    await complete();
    const other = await login("g-admin2", "admin2@test.com");
    await admin.patch(`/admin/users/${other.userId}/role`, { role: "ADMIN" });

    expect((await other.get("/admin/reviews")).body).toEqual([]);
    expect((await other.get(`/admin/reviews/questionnaires/${qn}`)).status).toBe(403);
    expect((await other.get(`/admin/reviews/attempts/${attemptId}`)).status).toBe(403);
    const d = await detail(admin, attemptId);
    expect((await other.put(`/admin/reviews/answers/${d.rows[0].answerId}/grade`, { isCorrect: true })).status).toBe(403);

    await prisma.questionnaire.update({ where: { id: qn }, data: { createdById: null } });
    expect((await other.get(`/admin/reviews/questionnaires/${qn}`)).status).toBe(200);
  });

  it("participantes comuns não acessam o módulo", async () => {
    const { user, qn, attemptId } = await scenario();
    for (const url of ["/admin/reviews", `/admin/reviews/questionnaires/${qn}`, `/admin/reviews/attempts/${attemptId}`]) {
      expect((await user.get(url)).status).toBe(403);
    }
  });
});

describe("fluxo de avaliação", () => {
  it("lista questionários com contagens e participantes com dados de quem respondeu", async () => {
    const { admin, qn, complete } = await scenario();
    const before = (await admin.get("/admin/reviews")).body[0];
    expect(before).toMatchObject({ id: qn, completed: 0, inProgress: 1, pendingAnswers: 0, questionCount: 3 });

    await complete();
    const after = (await admin.get("/admin/reviews")).body[0];
    expect(after).toMatchObject({ completed: 1, inProgress: 0, pendingAnswers: 3 });

    const q = (await admin.get(`/admin/reviews/questionnaires/${qn}`)).body;
    expect(q.attempts).toHaveLength(1);
    expect(q.attempts[0]).toMatchObject({ status: "COMPLETED", attemptNumber: 1, total: 3, answered: 3, graded: 0, pending: 3, correct: 0 });
    expect(q.attempts[0].user).toMatchObject({ name: "Usuário g-user", email: "user@test.com" });
  });

  it("mostra resposta × gabarito por questão, sem avaliar automaticamente", async () => {
    const { admin, attemptId, complete } = await scenario();
    await complete();
    const d = await detail(admin, attemptId);
    expect(d.user.email).toBe("user@test.com");
    const by = (type: string) => d.rows.find((r: Row) => r.question.type === type) as Row;

    expect(by("OPEN").given).toEqual({ kind: "text", text: "É um presente de Deus" });
    expect(by("OPEN").key).toEqual({ kind: "text", text: "Dom de Deus" });
    expect(by("OPEN").matchesKey).toBeNull();

    const multi = by("MULTIPLE");
    expect(multi.given.selected.map((s: { text: string }) => s.text).sort()).toEqual(["Fortaleza", "Sabedoria"]);
    expect(multi.key.selected.map((s: { text: string }) => s.text).sort()).toEqual(["Fortaleza", "Sabedoria"]);
    expect(multi.matchesKey).toBe(true);

    const tf = by("TRUE_FALSE");
    expect(tf.given.items.map((i: { value: boolean | null }) => i.value)).toEqual([false, null]);
    expect(tf.key.items.map((i: { value: boolean }) => i.value)).toEqual([true, false]);
    expect(tf.matchesKey).toBe(false);
    expect(d.rows.every((r: Row) => r.isCorrect === null)).toBe(true);
    expect(d.summary).toMatchObject({ total: 3, answered: 3, graded: 0, pending: 3, correct: 0 });
  });

  it("avalia como correta/errada, soma o resultado e permite limpar", async () => {
    const { admin, attemptId, qn, complete } = await scenario();
    await complete();
    const rows = (await detail(admin, attemptId)).rows as Row[];
    const id = (type: string) => rows.find((r) => r.question.type === type)!.answerId;

    const a = await admin.put(`/admin/reviews/answers/${id("OPEN")}/grade`, { isCorrect: true });
    expect(a.body.summary).toMatchObject({ graded: 1, correct: 1, pending: 2 });
    await admin.put(`/admin/reviews/answers/${id("MULTIPLE")}/grade`, { isCorrect: true });
    const c = await admin.put(`/admin/reviews/answers/${id("TRUE_FALSE")}/grade`, { isCorrect: false });
    expect(c.body.summary).toMatchObject({ total: 3, graded: 3, correct: 2, wrong: 1, pending: 0, percent: 67 });

    const list = (await admin.get(`/admin/reviews/questionnaires/${qn}`)).body.attempts[0];
    expect(list).toMatchObject({ correct: 2, wrong: 1, pending: 0 });
    expect((await admin.get("/admin/reviews")).body[0].pendingAnswers).toBe(0);

    const cleared = await admin.put(`/admin/reviews/answers/${id("TRUE_FALSE")}/grade`, { isCorrect: null });
    expect(cleared.body.summary).toMatchObject({ graded: 2, pending: 1 });
    const row = await prisma.answer.findUnique({ where: { id: id("TRUE_FALSE")! } });
    expect(row).toMatchObject({ isCorrect: null, gradedById: null, gradedAt: null });
    expect((await admin.put(`/admin/reviews/answers/${id("OPEN")}/grade`, { isCorrect: "sim" })).status).toBe(400);
  });

  it("só avalia tentativas concluídas e conta sem resposta como não avaliada", async () => {
    const { admin, attemptId } = await scenario();
    const d = await detail(admin, attemptId);
    expect(d.attempt.canGrade).toBe(false);
    const res = await admin.put(`/admin/reviews/answers/${d.rows[0].answerId}/grade`, { isCorrect: true });
    expect(res.status).toBe(409);
  });

  it("o participante não vê avaliação nem gabarito", async () => {
    const { admin, user, attemptId, complete } = await scenario();
    await complete();
    const d = await detail(admin, attemptId);
    await admin.put(`/admin/reviews/answers/${d.rows[0].answerId}/grade`, { isCorrect: true });
    expect(JSON.stringify((await user.get(`/attempts/${attemptId}`)).body)).not.toMatch(/isCorrect|gradedAt|expectedAnswer/);
  });
});

describe("visão por questão", () => {
  it("lista as questões com contagens e as respostas recebidas de cada uma", async () => {
    const { admin, qn, attemptId, complete } = await scenario();
    await complete();
    // segunda pessoa responde só a questão aberta
    const other = await login("g-other", "other@test.com");
    const att = (await other.post(`/questionnaires/${qn}/attempts`)).body;
    const open = att.questions.find((q: { type: string }) => q.type === "OPEN");
    await other.put(`/attempts/${att.id}/answers/${open.questionId}`, { text: "outra resposta" });
    await other.post(`/attempts/${att.id}/complete`);

    const list = (await admin.get(`/admin/reviews/questionnaires/${qn}/questions`)).body.questions;
    expect(list).toHaveLength(3);
    const openRow = list.find((q: { type: string }) => q.type === "OPEN");
    expect(openRow).toMatchObject({ received: 2, pending: 2, correct: 0 });

    const answers = (await admin.get(`/admin/reviews/questionnaires/${qn}/questions/${open.questionId}/answers`)).body;
    expect(answers.rows.map((r: { user: { email: string } }) => r.user.email).sort()).toEqual(["other@test.com", "user@test.com"]);
    expect(answers.key).toEqual({ kind: "text", text: "Dom de Deus" });
    expect(answers.rows.every((r: { canGrade: boolean }) => r.canGrade)).toBe(true);

    const first = answers.rows[0];
    await admin.put(`/admin/reviews/answers/${first.answerId}/grade`, { isCorrect: false });
    const again = (await admin.get(`/admin/reviews/questionnaires/${qn}/questions/${open.questionId}/answers`)).body;
    expect(again.summary).toEqual({ received: 2, correct: 0, wrong: 1, pending: 1 });
    expect((await detail(admin, attemptId)).rows.length).toBe(3);
  });
});
