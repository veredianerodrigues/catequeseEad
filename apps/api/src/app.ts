import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import multer from "multer";
import type { Config } from "./config";
import { csrfProtection, loadSession, requireAdmin, requireAuth } from "./lib/auth";
import { HttpError } from "./lib/errors";
import { adminRouter } from "./routes/admin";
import { attemptsRouter } from "./routes/attempts";
import { authRouter, type GoogleVerifier } from "./routes/auth";

export type AppDeps = { prisma: PrismaClient; config: Config; verifyGoogle: GoogleVerifier };

export function createApp({ prisma, config, verifyGoogle }: AppDeps) {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  if (!config.isTest) {
    app.use(pinoHttp({ redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"], autoLogging: { ignore: (r) => r.url === "/health" } }));
  }
  app.use(helmet());
  // Dados dinâmicos e autenticados nunca são cacheados; a rota de mídia redefine o cabeçalho.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const limiter = (windowMs: number, limit: number) =>
    config.rateLimit ? rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Muitas requisições. Tente novamente em instantes." } }) : ((_q, _s, n) => n()) as express.RequestHandler;

  app.get("/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  app.use(loadSession(prisma));
  app.use(csrfProtection(config));

  app.use("/auth", authRouter(prisma, config, verifyGoogle, limiter(15 * 60_000, 30)));
  app.use("/admin", requireAdmin, adminRouter(prisma, config, limiter(60_000, 30)));
  app.use("/", requireAuth, attemptsRouter(prisma, config, limiter(60_000, 240)));

  app.use((_req, _res, next) => next(new HttpError(404, "Rota não encontrada")));

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof ZodError) {
      return void res.status(400).json({ error: "Dados inválidos", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof multer.MulterError) return void res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "Arquivo inválido ou grande demais." });
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "JSON inválido" });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return void res.status(409).json({ error: "Registro duplicado" });
    (req as unknown as { log?: { error: (e: unknown) => void } }).log?.error(err);
    if (config.isTest) console.error(err);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  };
  app.use(onError);
  return app;
}
