import path from "node:path";

const bool = (v: string | undefined, d = false) => (v === undefined ? d : v === "true" || v === "1");

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const isProd = env.NODE_ENV === "production";
  const isTest = env.NODE_ENV === "test";
  if (isProd && !env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID é obrigatório em produção");
  return {
    isProd,
    isTest,
    port: Number(env.API_PORT ?? 4000),
    appOrigin: env.APP_ORIGIN ?? "http://localhost:3000",
    googleClientId: env.GOOGLE_CLIENT_ID ?? "",
    adminEmails: (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    uploadDir: path.resolve(env.UPLOAD_DIR ?? "./uploads"),
    sessionTtlMs: Number(env.SESSION_TTL_DAYS ?? 14) * 24 * 60 * 60 * 1000,
    trustProxy: bool(env.TRUST_PROXY, isProd),
    rateLimit: !isTest && bool(env.RATE_LIMIT, true),
  };
}

export type Config = ReturnType<typeof loadConfig>;
