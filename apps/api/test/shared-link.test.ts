import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, doc, login, makeSubject, prisma, resetDb, type Client } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

async function make(admin: Client, opts: { status?: "DRAFT" | "PUBLISHED"; listed?: boolean } = {}) {
  const subjectId = await makeSubject(admin, `Assunto ${Math.random().toString(36).slice(2)}`);
  const q = await admin.post("/admin/questions", { type: "OPEN", status: "PUBLISHED", subjectId, content: doc("Pergunta?") });
  const qn = await admin.post("/admin/questionnaires", {
    title: "Por link",
    description: "Descrição",
    status: opts.status ?? "PUBLISHED",
    listed: opts.listed ?? false,
    questionIds: [q.body.id],
  });
  expect(qn.status).toBe(201);
  return qn.body as { id: string; shareCode: string };
}

describe("link de compartilhamento", () => {
  it("cada questionário nasce com um código único e imprevisível", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const a = await make(admin);
    const b = await make(admin);
    expect(a.shareCode).toMatch(/^[a-z2-9]{10}$/);
    expect(a.shareCode).not.toBe(b.shareCode);
    const got = await admin.get(`/admin/questionnaires/${a.id}`);
    expect(got.body.shareCode).toBe(a.shareCode);
  });

  it("abre o questionário pelo código, exige login e não vaza dados internos", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    const { shareCode } = await make(admin);

    expect((await request(app).get(`/shared/${shareCode}`)).status).toBe(401);
    const r = await user.get(`/shared/${shareCode}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: "Por link", description: "Descrição", questionCount: 1, inProgressAttemptId: null, completedCount: 0 });
    expect(JSON.stringify(r.body)).not.toMatch(/shareCode|createdBy|isCorrect/);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("código inválido, inexistente ou de rascunho responde 404 com a mesma mensagem", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    const draft = await make(admin, { status: "DRAFT" });
    for (const code of ["naoexiste1", "x", "../etc/passwd", draft.shareCode]) {
      const r = await user.get(`/shared/${encodeURIComponent(code)}`);
      expect(r.status, code).toBe(404);
      expect(r.body.error).toBe("Link inválido ou questionário indisponível.");
    }
    expect((await user.post(`/shared/${draft.shareCode}/attempts`)).status).toBe(404);
    await admin.put(`/admin/questionnaires/${draft.id}`, { title: "Por link", status: "PUBLISHED", questionIds: (await admin.get(`/admin/questionnaires/${draft.id}`)).body.questions.map((x: { questionId: string }) => x.questionId) });
    expect((await user.get(`/shared/${draft.shareCode}`)).status).toBe(200);
  });

  it("inicia a tentativa pelo link e mostra a em andamento na próxima visita", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    const { shareCode, id } = await make(admin);

    const start = await user.post(`/shared/${shareCode}/attempts`);
    expect(start.status).toBe(201);
    const attempt = await user.get(`/attempts/${start.body.id}`);
    expect(attempt.body.questionnaire.id).toBe(id);
    expect(attempt.body.status).toBe("IN_PROGRESS");

    const info = await user.get(`/shared/${shareCode}`);
    expect(info.body.inProgressAttemptId).toBe(start.body.id);

    await user.post(`/attempts/${start.body.id}/complete`);
    const again = (await user.get(`/shared/${shareCode}`)).body;
    expect(again).toMatchObject({ inProgressAttemptId: null, completedCount: 1 });
  });

  it("a tentativa iniciada pelo link aparece para quem criou o questionário avaliar", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    const { shareCode, id } = await make(admin);
    const { body } = await user.post(`/shared/${shareCode}/attempts`);
    await user.post(`/attempts/${body.id}/complete`);
    const list = await admin.get(`/admin/reviews/questionnaires/${id}`);
    expect(list.body.attempts[0].user.email).toBe("user@test.com");
  });

  it("gerar novo código invalida o link anterior; só administradores podem", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    const { shareCode, id } = await make(admin);

    expect((await user.post(`/admin/questionnaires/${id}/share-code`)).status).toBe(403);
    const r = await admin.post(`/admin/questionnaires/${id}/share-code`);
    expect(r.status).toBe(200);
    expect(r.body.shareCode).not.toBe(shareCode);
    expect((await user.get(`/shared/${shareCode}`)).status).toBe(404);
    expect((await user.get(`/shared/${r.body.shareCode}`)).status).toBe(200);
    expect((await admin.post("/admin/questionnaires/naoexiste/share-code")).status).toBe(404);
  });

  it("editar o questionário mantém o código", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const { shareCode, id } = await make(admin);
    const cur = (await admin.get(`/admin/questionnaires/${id}`)).body;
    const upd = await admin.put(`/admin/questionnaires/${id}`, {
      title: "Novo título", status: "PUBLISHED", listed: false, questionIds: cur.questions.map((x: { questionId: string }) => x.questionId),
    });
    expect(upd.body.shareCode).toBe(shareCode);
  });

  it("questionários só por link não aparecem na página inicial; os listados aparecem", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    const priv = await make(admin, { listed: false });
    expect((await user.get("/questionnaires")).body).toEqual([]);

    const cur = (await admin.get(`/admin/questionnaires/${priv.id}`)).body;
    await admin.put(`/admin/questionnaires/${priv.id}`, { title: "Por link", status: "PUBLISHED", listed: true, questionIds: cur.questions.map((x: { questionId: string }) => x.questionId) });
    expect((await user.get("/questionnaires")).body.map((q: { id: string }) => q.id)).toEqual([priv.id]);
  });
});
