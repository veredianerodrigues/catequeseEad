import { Router, type Response } from "express";
import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { changePasswordSchema, googleLoginSchema, passwordLoginSchema, registerSchema, type Me } from "@quiz/shared";
import type { Config } from "../config";
import { cookieOptions, randomToken, requireAuth, sha256, SESSION_COOKIE } from "../lib/auth";
import { conflict, HttpError } from "../lib/errors";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../lib/password";

export type GoogleProfile = { sub: string; email: string; name: string };
export type GoogleVerifier = (idToken: string) => Promise<GoogleProfile>;

// Trava por e-mail: depois de 5 erros de senha em 15 minutos, a conta espera 15 minutos (vale também contra vários IPs).
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
type Fails = { count: number; since: number };

export function authRouter(prisma: PrismaClient, config: Config, verifyGoogle: GoogleVerifier, loginLimiter: import("express").RequestHandler) {
  const r = Router();
  const fails = new Map<string, Fails>();

  const lockedFor = (email: string) => {
    const f = fails.get(email);
    if (!f) return 0;
    if (Date.now() - f.since > LOCK_MS) {
      fails.delete(email);
      return 0;
    }
    return f.count >= MAX_FAILS ? f.since + LOCK_MS - Date.now() : 0;
  };
  const registerFail = (email: string) => {
    const f = fails.get(email);
    if (!f || Date.now() - f.since > LOCK_MS) fails.set(email, { count: 1, since: Date.now() });
    else f.count += 1;
    if (fails.size > 5000) for (const [k, v] of fails) if (Date.now() - v.since > LOCK_MS) fails.delete(k);
  };

  const meOf = (u: Pick<User, "id" | "name" | "email" | "role" | "mustChangePassword"> & { passwordHash?: string | null; hasPassword?: boolean }, csrfToken: string): Me => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    hasPassword: u.hasPassword ?? (u.passwordHash ?? null) !== null,
    csrfToken,
  });

  /** Cria a sessão, grava o cookie e devolve os dados do usuário. */
  async function startSession(res: Response, user: User): Promise<Me> {
    const token = randomToken();
    const csrfToken = randomToken(24);
    await prisma.session.create({
      data: { id: sha256(token), userId: user.id, csrfToken, expiresAt: new Date(Date.now() + config.sessionTtlMs) },
    });
    // Limpeza oportunista de sessões vencidas.
    void prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
    res.cookie(SESSION_COOKIE, token, cookieOptions(config));
    return meOf(user, csrfToken);
  }

  r.post("/google", loginLimiter, async (req, res) => {
    const { idToken } = googleLoginSchema.parse(req.body);
    let profile: GoogleProfile;
    try {
      profile = await verifyGoogle(idToken);
    } catch {
      throw new HttpError(401, "Não foi possível validar o login do Google");
    }
    const email = profile.email.toLowerCase();
    const isBootstrapAdmin = config.adminEmails.includes(email);
    const roleUpdate = isBootstrapAdmin ? { role: "ADMIN" as const } : {};

    let user = await prisma.user.findUnique({ where: { googleSub: profile.sub } });
    if (user) {
      user = await prisma.user.update({ where: { id: user.id }, data: { email, name: profile.name, emailVerified: true, ...roleUpdate } });
    } else {
      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail?.googleSub) throw conflict("Este e-mail já está ligado a outra conta Google.");
      if (byEmail) {
        // O Google prova que a pessoa é dona do e-mail. Se ele já tinha sido cadastrado por senha (sem confirmação),
        // a senha é apagada e as sessões abertas são encerradas: assim ninguém assume a conta de outra pessoa.
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { googleSub: profile.sub, name: profile.name, emailVerified: true, passwordHash: null, mustChangePassword: false, ...roleUpdate },
        });
        await prisma.session.deleteMany({ where: { userId: user.id } });
      } else {
        user = await prisma.user.create({
          data: { googleSub: profile.sub, email, name: profile.name, emailVerified: true, role: isBootstrapAdmin ? "ADMIN" : "USER" },
        });
      }
    }
    res.json(await startSession(res, user));
  });

  // Acesso por e-mail e senha (para quem tem dificuldade com o Google). O e-mail não é confirmado:
  // por isso estas contas nunca viram administradoras por ADMIN_EMAILS (isso só vale no login com Google).
  r.post("/register", loginLimiter, async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);
    const taken = () =>
      conflict("Este e-mail já tem cadastro. Se você já entrou antes com o Google, use o botão do Google; se criou uma senha, use a aba Entrar.");
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw taken();
    let user: User;
    try {
      user = await prisma.user.create({
        data: { email, name: name.replace(/\s+/g, " "), passwordHash: await hashPassword(password), role: "USER", emailVerified: false },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw taken();
      throw e;
    }
    res.status(201).json(await startSession(res, user));
  });

  r.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = passwordLoginSchema.parse(req.body);
    const wait = lockedFor(email);
    if (wait > 0) {
      throw new HttpError(429, `Muitas tentativas com senha errada. Tente de novo em ${Math.ceil(wait / 60_000)} minuto(s).`);
    }
    const user = await prisma.user.findUnique({ where: { email } });
    let ok = false;
    if (user?.passwordHash) ok = await verifyPassword(password, user.passwordHash);
    else await burnPasswordCheck(password);
    if (!user || !ok) {
      registerFail(email);
      throw new HttpError(401, "E-mail ou senha incorretos. Se você já entrou antes com o Google, use o botão do Google.");
    }
    fails.delete(email);
    res.json(await startSession(res, user));
  });

  // Troca de senha da própria pessoa (obrigatória após uma senha temporária). Encerra as outras sessões.
  r.post("/password", requireAuth, loginLimiter, async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.passwordHash) throw new HttpError(400, "Esta conta entra com o Google e não tem senha.");
    // 400 (e não 401): o 401 faria o site achar que a sessão expirou.
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(400, "A senha atual está incorreta.");
    const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
    const current = req.cookies?.[SESSION_COOKIE];
    await prisma.session.deleteMany({ where: { userId: user.id, ...(typeof current === "string" ? { id: { not: sha256(current) } } : {}) } });
    res.json(meOf(updated, req.csrfToken!));
  });

  r.get("/me", requireAuth, (req, res) => {
    res.json(meOf(req.user!, req.csrfToken!));
  });

  r.post("/logout", async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(config), maxAge: undefined });
    res.status(204).end();
  });

  return r;
}
