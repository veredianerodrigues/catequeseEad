import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { googleLoginSchema, type Me } from "@quiz/shared";
import type { Config } from "../config";
import { cookieOptions, randomToken, requireAuth, sha256, SESSION_COOKIE } from "../lib/auth";
import { HttpError } from "../lib/errors";

export type GoogleProfile = { sub: string; email: string; name: string };
export type GoogleVerifier = (idToken: string) => Promise<GoogleProfile>;

export function authRouter(prisma: PrismaClient, config: Config, verifyGoogle: GoogleVerifier, loginLimiter: import("express").RequestHandler) {
  const r = Router();

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

    const user = await prisma.user.upsert({
      where: { googleSub: profile.sub },
      create: { googleSub: profile.sub, email, name: profile.name, role: isBootstrapAdmin ? "ADMIN" : "USER" },
      update: { email, name: profile.name, ...(isBootstrapAdmin ? { role: "ADMIN" as const } : {}) },
    });

    const token = randomToken();
    const csrfToken = randomToken(24);
    await prisma.session.create({
      data: { id: sha256(token), userId: user.id, csrfToken, expiresAt: new Date(Date.now() + config.sessionTtlMs) },
    });
    // Limpeza oportunista de sessões vencidas.
    void prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);

    res.cookie(SESSION_COOKIE, token, cookieOptions(config));
    const me: Me = { id: user.id, name: user.name, email: user.email, role: user.role, csrfToken };
    res.json(me);
  });

  r.get("/me", requireAuth, (req, res) => {
    const me: Me = { ...req.user!, csrfToken: req.csrfToken! };
    res.json(me);
  });

  r.post("/logout", async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(config), maxAge: undefined });
    res.status(204).end();
  });

  return r;
}
