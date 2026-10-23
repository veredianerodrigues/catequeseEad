import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PrismaClient, Role } from "@prisma/client";
import type { Config } from "../config";
import { forbidden, HttpError, unauthorized } from "./errors";

export const SESSION_COOKIE = "sid";

export type AuthUser = { id: string; name: string; email: string; role: Role };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      csrfToken?: string;
    }
  }
}

export const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function cookieOptions(config: Config) {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: config.sessionTtlMs,
  };
}

/** Carrega a sessão do cookie (se houver). Não bloqueia: use requireAuth/requireAdmin nas rotas. */
export function loadSession(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token) {
      const session = await prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
      if (session && session.expiresAt > new Date()) {
        const { id, name, email, role } = session.user;
        req.user = { id, name, email, role };
        req.csrfToken = session.csrfToken;
      }
    }
    next();
  };
}

/** Origin check + token CSRF em requisições que alteram estado. */
export function csrfProtection(config: Config): RequestHandler {
  return (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (origin && origin !== config.appOrigin) return next(new HttpError(403, "Origem não permitida"));
    // Login ainda não tem sessão; depende de Origin + SameSite.
    if (!req.user) return next();
    const header = req.get("x-csrf-token");
    if (!header || !req.csrfToken || !safeEqual(header, req.csrfToken)) {
      return next(new HttpError(403, "Token CSRF inválido"));
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => (req.user ? next() : next(unauthorized()));

export const requireAdmin: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "ADMIN") return next(forbidden());
  next();
};
