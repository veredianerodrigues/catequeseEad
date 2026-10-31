import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, login, ORIGIN, prisma, resetDb } from "./helpers";
import { hashPassword, verifyPassword } from "../src/lib/password";

beforeEach(resetDb);

const SENHA = "senha-segura-123";
const post = (agent: ReturnType<typeof request.agent>, url: string, body: object, csrf?: string) => {
  const t = agent.post(url).set("Origin", ORIGIN);
  return (csrf ? t.set("x-csrf-token", csrf) : t).send(body);
};

async function cadastrar(email: string, name = "Maria da Silva", password = SENHA) {
  const agent = request.agent(app);
  const res = await post(agent, "/auth/register", { name, email, password });
  return { agent, res };
}

describe("hash de senha", () => {
  it("verifica a senha certa e recusa a errada; o hash é salgado", async () => {
    const h1 = await hashPassword("abc12345");
    const h2 = await hashPassword("abc12345");
    expect(h1).not.toBe(h2);
    expect(await verifyPassword("abc12345", h1)).toBe(true);
    expect(await verifyPassword("abc12346", h1)).toBe(false);
    expect(await verifyPassword("abc12345", "lixo")).toBe(false);
  });
});

describe("cadastro por e-mail e senha", () => {
  it("cria a conta, entra logada, como usuário comum e sem e-mail confirmado", async () => {
    const { agent, res } = await cadastrar("Maria@Teste.com");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Maria da Silva", email: "maria@teste.com", role: "USER", mustChangePassword: false });
    expect(res.body.csrfToken).toBeTruthy();
    expect((await agent.get("/auth/me")).status).toBe(200);

    const u = await prisma.user.findUniqueOrThrow({ where: { email: "maria@teste.com" } });
    expect(u.googleSub).toBeNull();
    expect(u.emailVerified).toBe(false);
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    expect(u.passwordHash).not.toContain(SENHA);
  });

  it("exige nome completo, e-mail válido e senha de 8+ caracteres", async () => {
    const agent = request.agent(app);
    expect((await post(agent, "/auth/register", { name: "Maria", email: "a@b.com", password: SENHA })).status).toBe(400);
    expect((await post(agent, "/auth/register", { name: "Maria Silva", email: "nao-e-email", password: SENHA })).status).toBe(400);
    expect((await post(agent, "/auth/register", { name: "Maria Silva", email: "a@b.com", password: "curta" })).status).toBe(400);
    expect((await post(agent, "/auth/register", { name: "Maria Silva", email: "a@b.com", password: "a@b.com" })).status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("não permite o mesmo e-mail duas vezes (nem o de uma conta Google)", async () => {
    expect((await cadastrar("dup@teste.com")).res.status).toBe(201);
    expect((await cadastrar("dup@teste.com")).res.status).toBe(409);
    await login("g1", "google@teste.com");
    expect((await cadastrar("google@teste.com")).res.status).toBe(409);
  });

  it("e-mail de administrador (ADMIN_EMAILS) cadastrado por senha NÃO vira administrador", async () => {
    const { res } = await cadastrar("admin@test.com");
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("USER");
  });

  it("respeita a checagem de origem (CSRF de login)", async () => {
    const r = await request(app).post("/auth/register").set("Origin", "https://outro-site.com").send({ name: "Maria Silva", email: "x@y.com", password: SENHA });
    expect(r.status).toBe(403);
  });
});

describe("entrar com e-mail e senha", () => {
  it("entra com a senha certa (e-mail sem diferenciar maiúsculas)", async () => {
    await cadastrar("ana@teste.com");
    const agent = request.agent(app);
    const res = await post(agent, "/auth/login", { email: "ANA@teste.com", password: SENHA });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("ana@teste.com");
    expect((await agent.get("/auth/me")).status).toBe(200);
  });

  it("recusa senha errada e e-mail inexistente com a mesma mensagem", async () => {
    await cadastrar("bia@teste.com");
    const a = await post(request.agent(app), "/auth/login", { email: "bia@teste.com", password: "errada-errada" });
    const b = await post(request.agent(app), "/auth/login", { email: "ninguem@teste.com", password: "errada-errada" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it("conta Google não entra por senha", async () => {
    await login("g2", "soogle@teste.com");
    const r = await post(request.agent(app), "/auth/login", { email: "soogle@teste.com", password: SENHA });
    expect(r.status).toBe(401);
  });

  it("trava o e-mail depois de 5 senhas erradas, mesmo com a senha certa", async () => {
    await cadastrar("cris@teste.com");
    for (let i = 0; i < 5; i++) {
      expect((await post(request.agent(app), "/auth/login", { email: "cris@teste.com", password: `errada-${i}-xxxx` })).status).toBe(401);
    }
    const bloqueado = await post(request.agent(app), "/auth/login", { email: "cris@teste.com", password: SENHA });
    expect(bloqueado.status).toBe(429);
  });
});

describe("conta por senha x Google", () => {
  it("entrar com o Google no mesmo e-mail liga as contas, apaga a senha e derruba as sessões abertas", async () => {
    const { agent: invasor } = await cadastrar("vitima@teste.com", "Pessoa Falsa", "senha-do-invasor");
    expect((await invasor.get("/auth/me")).status).toBe(200);

    const g = await login("gsub-vitima", "vitima@teste.com");
    expect(g.userId).toBeTruthy();

    // A sessão aberta com a senha do invasor foi encerrada e a senha não funciona mais.
    expect((await invasor.get("/auth/me")).status).toBe(401);
    const tentativa = await post(request.agent(app), "/auth/login", { email: "vitima@teste.com", password: "senha-do-invasor" });
    expect(tentativa.status).toBe(401);

    const u = await prisma.user.findUniqueOrThrow({ where: { email: "vitima@teste.com" } });
    expect(u.googleSub).toBe("gsub-vitima");
    expect(u.passwordHash).toBeNull();
    expect(u.emailVerified).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it("administrador do ADMIN_EMAILS que se cadastrou por senha vira admin ao entrar pelo Google", async () => {
    await cadastrar("admin@test.com");
    const g = await login("gsub-admin", "admin@test.com");
    expect((await g.get("/admin/users")).status).toBe(200);
  });
});

describe("trocar a senha", () => {
  it("troca com a senha atual, mantém a sessão atual e encerra as outras", async () => {
    const { agent, res } = await cadastrar("duda@teste.com");
    const outra = request.agent(app);
    await post(outra, "/auth/login", { email: "duda@teste.com", password: SENHA });
    expect((await outra.get("/auth/me")).status).toBe(200);

    const nova = "outra-senha-456";
    const errada = await post(agent, "/auth/password", { currentPassword: "nao-e-esta", newPassword: nova }, res.body.csrfToken);
    expect(errada.status).toBe(400);
    const ok = await post(agent, "/auth/password", { currentPassword: SENHA, newPassword: nova }, res.body.csrfToken);
    expect(ok.status).toBe(200);

    expect((await agent.get("/auth/me")).status).toBe(200);
    expect((await outra.get("/auth/me")).status).toBe(401);
    expect((await post(request.agent(app), "/auth/login", { email: "duda@teste.com", password: SENHA })).status).toBe(401);
    expect((await post(request.agent(app), "/auth/login", { email: "duda@teste.com", password: nova })).status).toBe(200);
  });

  it("exige o token CSRF e uma senha nova diferente", async () => {
    const { agent, res } = await cadastrar("edu@teste.com");
    expect((await post(agent, "/auth/password", { currentPassword: SENHA, newPassword: "nova-senha-789" })).status).toBe(403);
    expect((await post(agent, "/auth/password", { currentPassword: SENHA, newPassword: SENHA }, res.body.csrfToken)).status).toBe(400);
  });

  it("conta Google não tem senha para trocar", async () => {
    const g = await login("g3", "g3@teste.com");
    const r = await g.post("/auth/password", { currentPassword: "qualquer-coisa", newPassword: "nova-senha-789" });
    expect(r.status).toBe(400);
  });
});

describe("administrador redefine a senha", () => {
  it("gera senha temporária, obriga a trocar e bloqueia o resto até trocar", async () => {
    const admin = await login("sub-adm", "admin@test.com");
    const { res } = await cadastrar("fabi@teste.com");
    const fabiId = res.body.id as string;

    const lista = await admin.get("/admin/users");
    const fabi = (lista.body as { id: string; authMethod: string; emailVerified: boolean; passwordHash?: unknown }[]).find((u) => u.id === fabiId)!;
    expect(fabi).toMatchObject({ authMethod: "password", emailVerified: false });
    expect(fabi.passwordHash).toBeUndefined();

    const reset = await admin.post(`/admin/users/${fabiId}/reset-password`);
    expect(reset.status).toBe(200);
    const temp = reset.body.temporaryPassword as string;
    expect(temp).toHaveLength(10);

    // A senha antiga parou de valer e as sessões antigas caíram.
    expect((await post(request.agent(app), "/auth/login", { email: "fabi@teste.com", password: SENHA })).status).toBe(401);

    const agent = request.agent(app);
    const entrada = await post(agent, "/auth/login", { email: "fabi@teste.com", password: temp });
    expect(entrada.status).toBe(200);
    expect(entrada.body.mustChangePassword).toBe(true);

    // Com senha temporária só dá para ver quem é, trocar a senha ou sair.
    expect((await agent.get("/questionnaires")).status).toBe(403);
    expect((await agent.get("/auth/me")).status).toBe(200);

    const nova = "senha-definitiva-1";
    const troca = await post(agent, "/auth/password", { currentPassword: temp, newPassword: nova }, entrada.body.csrfToken);
    expect(troca.status).toBe(200);
    expect(troca.body.mustChangePassword).toBe(false);
    expect((await agent.get("/questionnaires")).status).toBe(200);
  });

  it("não redefine conta Google, nem a própria conta, e só administrador pode", async () => {
    const admin = await login("sub-adm2", "admin@test.com");
    const g = await login("sub-g4", "g4@teste.com");
    expect((await admin.post(`/admin/users/${g.userId}/reset-password`)).status).toBe(409);
    expect((await admin.post(`/admin/users/${admin.userId}/reset-password`)).status).toBe(409);
    expect((await g.post(`/admin/users/${admin.userId}/reset-password`)).status).toBe(403);
    expect((await admin.post("/admin/users/inexistente/reset-password")).status).toBe(404);
  });
});
