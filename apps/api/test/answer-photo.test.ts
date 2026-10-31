import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, doc, login, makeSubject, prisma, resetDb, uploadDir } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

// PNG de 1x1 pixel (assinatura e estrutura válidas).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

async function setup() {
  const admin = await login("pa", "admin@test.com");
  const user = await login("pu", "user@test.com");
  const subjectId = await makeSubject(admin);
  const open = await admin.post("/admin/questions", { type: "OPEN", status: "PUBLISHED", subjectId, content: doc("Descreva"), expectedAnswer: "x" });
  const multi = await admin.post("/admin/questions", {
    type: "MULTIPLE", status: "PUBLISHED", subjectId, content: doc("Dons?"),
    alternatives: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }],
  });
  const qn = await admin.post("/admin/questionnaires", { title: "Com foto", status: "PUBLISHED", questionIds: [open.body.id, multi.body.id] });
  const attempt = (await user.post(`/questionnaires/${qn.body.id}/attempts`)).body;
  const openQ = attempt.questions.find((q: { type: string }) => q.type === "OPEN").questionId as string;
  const multiQ = attempt.questions.find((q: { type: string }) => q.type === "MULTIPLE").questionId as string;
  const base = `/attempts/${attempt.id}/answers`;
  return { admin, user, attemptId: attempt.id as string, openQ, multiQ, base, qn: qn.body.id as string };
}

const stored = async (attemptId: string, questionId: string) => prisma.answer.findUnique({ where: { attemptId_questionId: { attemptId, questionId } } });

describe("foto na resposta aberta", () => {
  it("envia a foto, conta como respondida e quem respondeu consegue ver", async () => {
    const { user, base, openQ, attemptId } = await setup();
    const up = await user.upload(`${base}/${openQ}/photo`, PNG, "atividade.png");
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ saved: true, answered: 1 });
    expect(up.body.photoUrl).toContain(`/attempts/${attemptId}/answers/${openQ}/photo`);

    const view = (await user.get(`/attempts/${attemptId}`)).body;
    expect(view.answered).toBe(1);
    expect(view.questions.find((q: { questionId: string }) => q.questionId === openQ).answer).toMatchObject({ text: null, photoUrl: expect.stringContaining("/photo") });

    const img = await user.get(`${base}/${openQ}/photo`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toContain("no-store");
    expect(Buffer.from(img.body).equals(PNG)).toBe(true);
  });

  it("aceita texto e foto juntos; apagar o texto mantém a foto", async () => {
    const { user, base, openQ, attemptId } = await setup();
    await user.put(`${base}/${openQ}`, { text: "minha resposta" });
    await user.upload(`${base}/${openQ}/photo`, JPG, "f.jpg");
    expect((await stored(attemptId, openQ))?.text).toBe("minha resposta");

    const cleared = await user.put(`${base}/${openQ}`, { text: "" });
    expect(cleared.body.cleared).toBe(false);
    const row = await stored(attemptId, openQ);
    expect(row?.text).toBeNull();
    expect(row?.photoKey).toBeTruthy();
  });

  it("remover a foto: sem texto a resposta some; com texto o texto fica; o arquivo é apagado", async () => {
    const { user, base, openQ, attemptId } = await setup();
    await user.upload(`${base}/${openQ}/photo`, PNG, "a.png");
    const key = (await stored(attemptId, openQ))!.photoKey!;
    expect(fs.existsSync(path.join(uploadDir, key))).toBe(true);
    expect((await user.del(`${base}/${openQ}/photo`)).status).toBe(200);
    expect(await stored(attemptId, openQ)).toBeNull();
    expect(fs.existsSync(path.join(uploadDir, key))).toBe(false);

    await user.put(`${base}/${openQ}`, { text: "fica" });
    await user.upload(`${base}/${openQ}/photo`, PNG, "b.png");
    await user.del(`${base}/${openQ}/photo`);
    const row = await stored(attemptId, openQ);
    expect(row?.text).toBe("fica");
    expect(row?.photoKey).toBeNull();
  });

  it("trocar a foto apaga o arquivo antigo", async () => {
    const { user, base, openQ, attemptId } = await setup();
    await user.upload(`${base}/${openQ}/photo`, PNG, "a.png");
    const first = (await stored(attemptId, openQ))!.photoKey!;
    await user.upload(`${base}/${openQ}/photo`, JPG, "b.jpg");
    const second = (await stored(attemptId, openQ))!.photoKey!;
    expect(second).not.toBe(first);
    expect(fs.existsSync(path.join(uploadDir, first))).toBe(false);
    expect(fs.existsSync(path.join(uploadDir, second))).toBe(true);
  });

  it("recusa arquivo que não é imagem (mesmo com nome .jpg), arquivo grande e questão que não é aberta", async () => {
    const { user, base, openQ, multiQ, attemptId } = await setup();
    const filesBefore = () => (fs.existsSync(path.join(uploadDir, "answers")) ? fs.readdirSync(path.join(uploadDir, "answers")).length : 0);
    const before = filesBefore();
    const fake = await user.upload(`${base}/${openQ}/photo`, Buffer.from("%PDF-1.4 não sou foto"), "foto.jpg");
    expect(fake.status).toBe(422);
    const big = await user.upload(`${base}/${openQ}/photo`, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]), "grande.png");
    expect(big.status).toBe(413);
    const wrongType = await user.upload(`${base}/${multiQ}/photo`, PNG, "a.png");
    expect(wrongType.status).toBe(422);
    expect(await stored(attemptId, openQ)).toBeNull();
    expect(filesBefore()).toBe(before); // nenhum arquivo ficou para trás
  });

  it("depois de concluída a tentativa não aceita nem remove foto", async () => {
    const { user, base, openQ, attemptId } = await setup();
    await user.upload(`${base}/${openQ}/photo`, PNG, "a.png");
    await user.post(`/attempts/${attemptId}/complete`);
    expect((await user.upload(`${base}/${openQ}/photo`, JPG, "b.jpg")).status).toBe(409);
    expect((await user.del(`${base}/${openQ}/photo`)).status).toBe(409);
    expect((await user.get(`${base}/${openQ}/photo`)).status).toBe(200); // continua visível para consulta
  });

  it("outra pessoa não envia nem vê a foto; sem login também não", async () => {
    const { user, base, openQ } = await setup();
    await user.upload(`${base}/${openQ}/photo`, PNG, "a.png");
    const intruso = await login("pi", "intruso@test.com");
    expect((await intruso.get(`${base}/${openQ}/photo`)).status).toBe(404);
    expect((await intruso.upload(`${base}/${openQ}/photo`, PNG, "x.png")).status).toBe(404);
    expect((await intruso.del(`${base}/${openQ}/photo`)).status).toBe(404);
    expect((await request(app).get(`${base}/${openQ}/photo`)).status).toBe(401);
  });

  it("só o administrador que avalia o questionário vê a foto, e ela aparece nas telas de avaliação", async () => {
    const { user, admin, base, openQ, attemptId, qn } = await setup();
    await user.upload(`${base}/${openQ}/photo`, PNG, "a.png");
    await user.post(`/attempts/${attemptId}/complete`);

    expect((await admin.get(`${base}/${openQ}/photo`)).status).toBe(200);
    // um segundo administrador (que não criou o questionário) não vê a foto:
    const segundo = await login("pa3", "segundo@test.com");
    await admin.patch(`/admin/users/${segundo.userId}/role`, { role: "ADMIN" });
    expect((await segundo.get(`${base}/${openQ}/photo`)).status).toBe(404);

    const detail = (await admin.get(`/admin/reviews/attempts/${attemptId}`)).body;
    const row = detail.rows.find((r: { question: { id: string } }) => r.question.id === openQ);
    expect(row.given).toMatchObject({ kind: "text", text: null, photoUrl: expect.stringContaining("/photo") });
    expect(row.answered).toBe(true);

    const byQuestion = (await admin.get(`/admin/reviews/questionnaires/${qn}/questions/${openQ}/answers`)).body;
    expect(byQuestion.rows[0].given.photoUrl).toContain("/photo");
  });
});
