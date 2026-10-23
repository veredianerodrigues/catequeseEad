import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, doc, login, ORIGIN, prisma, resetDb, seedQuestionnaire, type Client } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

async function setup(opts?: Parameters<typeof seedQuestionnaire>[1]) {
  const admin = await login("g-admin", "admin@test.com");
  const user = await login("g-user", "user@test.com");
  const seeded = await seedQuestionnaire(admin, opts);
  return { admin, user, ...seeded };
}

const startAttempt = async (user: Client, questionnaireId: string) => {
  const r = await user.post(`/questionnaires/${questionnaireId}/attempts`);
  expect(r.status).toBe(201);
  return r.body;
};

describe("autenticação e autorização", () => {
  it("bloqueia anônimos, usuários comuns nas rotas admin e promove e-mails da lista", async () => {
    const anon = await request(app).get("/attempts");
    expect(anon.status).toBe(401);

    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    expect((await admin.get("/auth/me")).body.role).toBe("ADMIN");
    expect((await user.get("/auth/me")).body.role).toBe("USER");

    expect((await user.get("/admin/questions")).status).toBe(403);
    expect((await user.post("/admin/questions", {})).status).toBe(403);
    expect((await admin.get("/admin/questions")).status).toBe(200);
  });

  it("exige token CSRF e Origin corretos em requisições que alteram estado", async () => {
    const user = await login("g-user", "user@test.com");
    const noCsrf = await user.agent.post("/auth/logout").set("Origin", ORIGIN);
    expect(noCsrf.status).toBe(403);
    const badOrigin = await user.agent.post("/auth/logout").set("Origin", "https://evil.example").set("x-csrf-token", user.csrf);
    expect(badOrigin.status).toBe(403);
    expect((await user.post("/auth/logout")).status).toBe(204);
    expect((await user.get("/auth/me")).status).toBe(401);
  });

  it("admin promove usuário, mas não pode rebaixar a si mesmo", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    expect((await admin.patch(`/admin/users/${user.userId}/role`, { role: "ADMIN" })).status).toBe(200);
    expect((await user.get("/admin/questions")).status).toBe(200);
    expect((await admin.patch(`/admin/users/${admin.userId}/role`, { role: "USER" })).status).toBe(409);
  });

  it("não aceita idToken inválido", async () => {
    const r = await request(app).post("/auth/google").set("Origin", ORIGIN).send({ idToken: "sem-formato-valido-aaaaaaaaaaaaa" });
    expect(r.status).toBe(401);
  });
});

describe("questões e conteúdo rico", () => {
  it("sanitiza o enunciado (sem scripts, links javascript: nem ids de vídeo inválidos)", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const r = await admin.post("/admin/questions", {
      type: "OPEN",
      status: "PUBLISHED",
      title: "XSS",
      content: {
        type: "doc",
        content: [
          { type: "script", content: [{ type: "text", text: "alert(1)" }] },
          { type: "paragraph", content: [{ type: "text", text: "clique", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
          { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
          { type: "youtube", attrs: { videoId: '"><img src=x>' } },
        ],
      },
    });
    expect(r.status).toBe(201);
    const types = r.body.content.content.map((n: { type: string }) => n.type);
    expect(types).toEqual(["paragraph", "youtube"]);
    expect(JSON.stringify(r.body.content)).not.toContain("javascript:");
    expect(await prisma.media.count({ where: { kind: "YOUTUBE", youtubeId: "dQw4w9WgXcQ" } })).toBe(1);
  });

  it("valida regras de publicação, mas aceita rascunho incompleto", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const base = { type: "MULTIPLE", title: "M", content: doc("x"), alternatives: [{ text: "a", isCorrect: false }, { text: "b", isCorrect: false }] };
    const published = await admin.post("/admin/questions", { ...base, status: "PUBLISHED" });
    expect(published.status).toBe(422);
    expect((await admin.post("/admin/questions", { ...base, status: "DRAFT" })).status).toBe(201);
    expect((await admin.post("/admin/questions", { ...base, status: "PUBLISHED", content: { type: "doc", content: [] }, alternatives: [] })).status).toBe(422);
  });

  it("atualiza alternativas preservando ids e filtra por texto", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const created = await admin.post("/admin/questions", {
      type: "MULTIPLE", status: "PUBLISHED", title: "Sacramentos", content: doc("Quantos são os sacramentos?"),
      alternatives: [{ text: "Sete", isCorrect: true }, { text: "Cinco", isCorrect: false }],
    });
    const [a, b] = created.body.alternatives;
    const upd = await admin.put(`/admin/questions/${created.body.id}`, {
      type: "MULTIPLE", status: "PUBLISHED", title: "Sacramentos", content: doc("Quantos são os sacramentos?"),
      alternatives: [{ id: b.id, text: "Cinco!", isCorrect: false }, { id: a.id, text: "Sete", isCorrect: true }],
    });
    expect(upd.body.alternatives.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
    const list = await admin.get("/admin/questions?q=sacramentos&status=PUBLISHED");
    expect(list.body.total).toBe(1);
  });

  it("valida upload pelo conteúdo real do arquivo e limita o tamanho", async () => {
    const admin = await login("g-admin", "admin@test.com");
    const user = await login("g-user", "user@test.com");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const ok = await admin.upload("/admin/media", png, "foto.png");
    expect(ok.status).toBe(201);
    expect((await user.upload("/admin/media", png, "foto.png")).status).toBe(403);

    const fake = await admin.upload("/admin/media", Buffer.from("<html><script>alert(1)</script></html>"), "foto.png");
    expect(fake.status).toBe(422);
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    expect((await admin.upload("/admin/media", huge, "grande.jpg")).status).toBe(413);

    const served = await user.get(`/media/${ok.body.id}`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");

    const withImage = await admin.post("/admin/questions", {
      type: "OPEN", status: "PUBLISHED", title: "Img",
      content: { type: "doc", content: [{ type: "image", attrs: { mediaId: ok.body.id } }] },
    });
    expect(withImage.status).toBe(201);
    expect((await prisma.media.findUnique({ where: { id: ok.body.id } }))?.questionId).toBe(withImage.body.id);
  });
});

describe("tentativas", () => {
  it("sorteia a ordem uma vez e a mantém ao recarregar, retomar e entre sessões", async () => {
    const { user, questionnaireId, questionIds } = await setup({ open: 3, multiple: 7 });
    const attempt = await startAttempt(user, questionnaireId);
    const order = attempt.questions.map((q: { questionId: string }) => q.questionId);
    expect([...order].sort()).toEqual([...questionIds].sort());

    for (let i = 0; i < 3; i++) {
      const again = await user.get(`/attempts/${attempt.id}`);
      expect(again.body.questions.map((q: { questionId: string }) => q.questionId)).toEqual(order);
    }
    // Nova sessão (novo login) do mesmo usuário: mesma ordem.
    const relogged = await login("g-user", "user@test.com");
    const resumed = await relogged.get(`/attempts/${attempt.id}`);
    expect(resumed.body.questions.map((q: { questionId: string }) => q.questionId)).toEqual(order);

    // Uma nova tentativa gera nova ordem (com 10 questões, igualdade é ~1 em 3,6 milhões).
    const second = await startAttempt(user, questionnaireId);
    expect(second.id).not.toBe(attempt.id);
    expect(second.questions.map((q: { questionId: string }) => q.questionId)).not.toEqual(order);
  });

  it("nunca expõe quais alternativas são corretas", async () => {
    const { user, questionnaireId } = await setup();
    const attempt = await startAttempt(user, questionnaireId);
    expect(JSON.stringify(attempt)).not.toMatch(/isCorrect/);
    expect((await user.get("/questionnaires")).body[0].questionCount).toBe(6);
  });

  it("embaralha alternativas de forma persistente quando configurado", async () => {
    const { user, questionnaireId } = await setup({ open: 0, multiple: 6, shuffleAlternatives: true });
    const attempt = await startAttempt(user, questionnaireId);
    const orders = attempt.questions.map((q: { alternatives: { id: string }[] }) => q.alternatives.map((a) => a.id).join());
    const again = await user.get(`/attempts/${attempt.id}`);
    expect(again.body.questions.map((q: { alternatives: { id: string }[] }) => q.alternatives.map((a) => a.id).join())).toEqual(orders);
    expect(attempt.questions[0].alternatives.map((a: { label: string }) => a.label)).toEqual(["A", "B", "C", "D"]);
  });

  it("grava uma resposta por questão, atualiza em vez de duplicar e restaura o progresso", async () => {
    const { user, questionnaireId } = await setup();
    const attempt = await startAttempt(user, questionnaireId);
    const open = attempt.questions.find((q: { type: string }) => q.type === "OPEN");
    const multi = attempt.questions.find((q: { type: string }) => q.type === "MULTIPLE");

    expect((await user.put(`/attempts/${attempt.id}/answers/${open.questionId}`, { text: "primeira" })).status).toBe(200);
    expect((await user.put(`/attempts/${attempt.id}/answers/${open.questionId}`, { text: "segunda" })).status).toBe(200);
    const ids = multi.alternatives.map((a: { id: string }) => a.id);
    await user.put(`/attempts/${attempt.id}/answers/${multi.questionId}`, { alternativeIds: [ids[0], ids[1]] });
    const saved = await user.put(`/attempts/${attempt.id}/answers/${multi.questionId}`, { alternativeIds: [ids[2]] });
    expect(saved.body.answered).toBe(2);
    expect(await prisma.answer.count({ where: { attemptId: attempt.id } })).toBe(2);
    expect(await prisma.answerAlternative.count()).toBe(1);

    expect((await user.patch(`/attempts/${attempt.id}/progress`, { currentIndex: 3 })).status).toBe(200);
    expect((await user.patch(`/attempts/${attempt.id}/progress`, { currentIndex: 99 })).status).toBe(422);

    const resumed = await (await login("g-user", "user@test.com")).get(`/attempts/${attempt.id}`);
    expect(resumed.body.currentIndex).toBe(3);
    expect(resumed.body.answered).toBe(2);
    const o = resumed.body.questions.find((q: { questionId: string }) => q.questionId === open.questionId);
    expect(o.answer.text).toBe("segunda");
    const m = resumed.body.questions.find((q: { questionId: string }) => q.questionId === multi.questionId);
    expect(m.answer.alternativeIds).toEqual([ids[2]]);

    // Limpar a resposta remove o registro.
    await user.put(`/attempts/${attempt.id}/answers/${open.questionId}`, { text: "   " });
    expect(await prisma.answer.count({ where: { attemptId: attempt.id } })).toBe(1);
  });

  it("rejeita alternativas de outra questão e texto em questão de múltipla resposta", async () => {
    const { user, questionnaireId } = await setup();
    const attempt = await startAttempt(user, questionnaireId);
    const [m1, m2] = attempt.questions.filter((q: { type: string }) => q.type === "MULTIPLE");
    const foreign = await user.put(`/attempts/${attempt.id}/answers/${m1.questionId}`, { alternativeIds: [m2.alternatives[0].id] });
    expect(foreign.status).toBe(422);
    expect((await user.put(`/attempts/${attempt.id}/answers/${m1.questionId}`, { text: "oi" })).status).toBe(422);
    expect((await user.put(`/attempts/${attempt.id}/answers/nao-existe`, { text: "oi" })).status).toBe(404);
  });

  it("salvamentos concorrentes da mesma questão não duplicam nem falham", async () => {
    const { user, questionnaireId } = await setup();
    const attempt = await startAttempt(user, questionnaireId);
    const open = attempt.questions.find((q: { type: string }) => q.type === "OPEN");
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => user.put(`/attempts/${attempt.id}/answers/${open.questionId}`, { text: `v${i}` })));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(await prisma.answer.count({ where: { attemptId: attempt.id, questionId: open.questionId } })).toBe(1);
  });

  it("isola tentativas entre usuários", async () => {
    const { user, admin, questionnaireId } = await setup();
    const attempt = await startAttempt(user, questionnaireId);
    const q = attempt.questions[0].questionId;
    for (const other of [admin, await login("g-other", "other@test.com")]) {
      expect((await other.get(`/attempts/${attempt.id}`)).status).toBe(404);
      expect((await other.put(`/attempts/${attempt.id}/answers/${q}`, { text: "x" })).status).toBe(404);
      expect((await other.post(`/attempts/${attempt.id}/complete`)).status).toBe(404);
    }
    expect((await admin.get("/attempts")).body).toEqual([]);
  });

  it("conclusão é idempotente e deixa a tentativa somente leitura", async () => {
    const { user, questionnaireId } = await setup();
    const attempt = await startAttempt(user, questionnaireId);
    const open = attempt.questions.find((q: { type: string }) => q.type === "OPEN");
    await user.put(`/attempts/${attempt.id}/answers/${open.questionId}`, { text: "final" });
    const done = await user.post(`/attempts/${attempt.id}/complete`);
    expect(done.body.status).toBe("COMPLETED");
    expect((await user.post(`/attempts/${attempt.id}/complete`)).status).toBe(200);
    expect((await user.put(`/attempts/${attempt.id}/answers/${open.questionId}`, { text: "tarde" })).status).toBe(409);
    expect((await user.patch(`/attempts/${attempt.id}/progress`, { currentIndex: 1 })).status).toBe(409);
    expect((await user.post(`/attempts/${attempt.id}/abandon`)).status).toBe(409);
    expect((await user.get(`/attempts/${attempt.id}`)).body.questions.find((q: { questionId: string }) => q.questionId === open.questionId).answer.text).toBe("final");
    // Histórico preservado e nova tentativa permitida.
    const fresh = await startAttempt(user, questionnaireId);
    const list = await user.get("/attempts");
    expect(list.body.map((a: { status: string }) => a.status).sort()).toEqual(["COMPLETED", "IN_PROGRESS"]);
    expect(fresh.status).toBe("IN_PROGRESS");
  });

  it("rascunhos não aparecem para participantes e questões despublicadas não entram em novas tentativas", async () => {
    const { admin, user, questionnaireId, questionIds } = await setup({ open: 2, multiple: 0 });
    const q = await admin.get(`/admin/questions/${questionIds[0]}`);
    await admin.put(`/admin/questions/${questionIds[0]}`, { type: q.body.type, status: "DRAFT", title: q.body.title, content: q.body.content });
    const attempt = await startAttempt(user, questionnaireId);
    expect(attempt.total).toBe(1);

    await admin.put(`/admin/questionnaires/${questionnaireId}`, { title: "x", description: "", status: "DRAFT", questionIds });
    expect((await user.get("/questionnaires")).body).toEqual([]);
    expect((await user.post(`/questionnaires/${questionnaireId}/attempts`)).status).toBe(404);
  });

  it("não permite excluir questão já usada em tentativas", async () => {
    const { admin, user, questionnaireId, questionIds } = await setup();
    await startAttempt(user, questionnaireId);
    expect((await admin.del(`/admin/questions/${questionIds[0]}`)).status).toBe(409);
  });
});

describe("cache", () => {
  it("rotas dinâmicas e autenticadas enviam Cache-Control: no-store", async () => {
    const { admin, user, questionnaireId } = await setup();
    const attempt = await startAttempt(user, questionnaireId);
    for (const [client, url] of [
      [user, "/questionnaires"],
      [user, "/attempts"],
      [user, `/attempts/${attempt.id}`],
      [user, "/auth/me"],
      [admin, "/admin/questions"],
    ] as const) {
      const r = await client.get(url);
      expect(r.headers["cache-control"], url).toBe("no-store");
    }
    const answer = await user.put(`/attempts/${attempt.id}/answers/${attempt.questions[0].questionId}`, { text: "x", alternativeIds: undefined });
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get("/attempts")).headers["cache-control"]).toBe("no-store");
  });
});
