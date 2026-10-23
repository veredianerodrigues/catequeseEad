import { OAuth2Client } from "google-auth-library";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { backfillContentHashes } from "./lib/questions";
import type { GoogleVerifier } from "./routes/auth";

const config = loadConfig();
const prisma = new PrismaClient();
const google = new OAuth2Client(config.googleClientId);

// Somente desenvolvimento local, sem credenciais do Google: token "dev:email:nome". Nunca em produção.
const devAuth = process.env.DEV_AUTH_BYPASS === "true" && !config.isProd;
if (devAuth) console.warn("DEV_AUTH_BYPASS ativo: login sem verificação do Google (apenas desenvolvimento).");

const verifyGoogle: GoogleVerifier = async (idToken) => {
  if (devAuth && idToken.startsWith("dev:")) {
    const [, email = "", name = email] = idToken.split(":");
    return { sub: `dev-${email}`, email, name };
  }
  const ticket = await google.verifyIdToken({ idToken, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email || !p.email_verified) throw new Error("Perfil Google incompleto ou e-mail não verificado");
  // LGPD: guardamos apenas identificador, nome e e-mail.
  return { sub: p.sub, email: p.email, name: p.name ?? p.email };
};

const app = createApp({ prisma, config, verifyGoogle });
void backfillContentHashes(prisma).catch((e) => console.error("backfill de hashes falhou", e));
const server = app.listen(config.port, () => console.log(`API em http://localhost:${config.port}`));

const shutdown = () => server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
