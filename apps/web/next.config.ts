import path from "node:path";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// O .env fica na raiz do monorepo (compartilhado com a API); o Next só leria o de apps/web.
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const isDev = process.env.NODE_ENV !== "production";
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";

// YouTube só via youtube-nocookie; arquivos e API são do próprio domínio.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "frame-src 'self' https://www.youtube-nocookie.com https://accounts.google.com/gsi/",
  `connect-src 'self' https://accounts.google.com/gsi/${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const config: NextConfig = {
  transpilePackages: ["@quiz/shared"],
  poweredByHeader: false,
  devIndicators: false,
  // Hospedagem (pnpm em monorepo): saída autossuficiente, com os pacotes copiados de verdade. Só liga com NEXT_STANDALONE=1.
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  experimental: { proxyClientMaxBodySize: "25mb" },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // Páginas dinâmicas e autenticadas: nunca em cache (assets versionados em /_next/static ficam de fora).
      { source: "/((?!api/|_next/static|_next/image|favicon.ico).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default config;
