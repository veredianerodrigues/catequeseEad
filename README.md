# Questionários

Monorepo (pnpm workspaces): app web de questionários com login Google, painel administrativo, conteúdo rico (TipTap), ordem aleatória persistida e retomada de tentativas.

- `apps/web` — Next.js 16 + React (TypeScript)
- `apps/api` — Node.js + Express 5 + Prisma + MySQL
- `packages/shared` — schemas Zod, tipos, sanitizador do conteúdo rico, Fisher-Yates

## Rodando localmente

```bash
pnpm install
cp .env.example .env          # ajuste GOOGLE_CLIENT_ID / ADMIN_EMAILS
pnpm db:up                    # MySQL 8.4 em Docker (porta 3307)
pnpm db:migrate               # aplica as migrations
pnpm dev                      # web em :3000, API em :4000 (o web faz proxy de /api)
```

Sem credenciais do Google, `DEV_AUTH_BYPASS=true` + `NEXT_PUBLIC_DEV_AUTH=true` (apenas dev; ignorado em produção) habilita login por e-mail.
Para o login real, crie um OAuth Client ID (Web) com origem `http://localhost:3000` e preencha `GOOGLE_CLIENT_ID` e `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

Da raiz: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (os testes da API usam o banco `quiz_test` no mesmo MySQL).

## Decisões

- **Sessão**: cookie `sid` httpOnly/SameSite=Lax (Secure em produção); só o hash SHA-256 fica no banco. CSRF: header `x-csrf-token` (obtido em `/auth/me`) + checagem de `Origin`. Web e API no mesmo domínio via proxy `/api`.
- **Admin**: e-mails em `ADMIN_EMAILS` viram administradores no login; os demais são promovidos em *Usuários*.
- **Enunciado**: JSON do TipTap sanitizado por allowlist no backend (`packages/shared/src/richtext.ts`). Imagens/PDF por `mediaId` (upload validado por *magic bytes* e tamanho; JPEG/PNG/WebP ≤ 5 MB, PDF ≤ 20 MB); YouTube só pelo ID de 11 caracteres, incorporado via `youtube-nocookie.com`.
- **Tentativas**: a ordem (e, opcionalmente, a das alternativas) é sorteada uma vez e gravada em `AttemptQuestion`. `Answer` tem unique `(attemptId, questionId)`; cada gravação trava a linha da tentativa (`FOR UPDATE`), então salvamentos concorrentes e conclusão simultânea são seguros. A UI só mostra "salvo" após a resposta da API, reenvia ao voltar a conexão e avisa antes de fechar com pendências.
- **Sem cache**: `Cache-Control: no-store` na API e nas páginas; `fetch` com `cache: "no-store"`. Só `/_next/static` e os arquivos de mídia (imutáveis, `private`) são cacheáveis.
- **Gabarito nunca vai ao participante**; a v1 não calcula nota (`Question.gradingConfig` reservado para a v2).
- **Produção**: sirva web e API sob o mesmo domínio (proxy reverso), defina `NODE_ENV=production`, HTTPS, `APP_ORIGIN`, `UPLOAD_DIR` persistente e `pnpm db:deploy`.
