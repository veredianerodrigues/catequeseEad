# Saber Catequese

Material de apoio para catequese — Paróquia Perpétuo Socorro, Cascavel – PR.

Aplicativo web para criar e responder questionários de catequese. Quem coordena cadastra assuntos e questões (ou importa de um arquivo), monta questionários, compartilha um link e avalia as respostas. Quem responde entra com a conta Google (ou com e-mail e senha), responde pelo celular ou computador e pode continuar de onde parou.

Endereços de produção: site `https://sabercatequese.online` · API `https://api.sabercatequese.online`.

## O que o sistema faz

**Para quem responde**
- Login com Google ou com **e-mail e senha** (para quem tem dificuldade com o Google).
- Abre um questionário pela página inicial ou pelo **link de compartilhamento** (`/q/<código>`).
- Ordem das questões sorteada e guardada; respostas **salvas automaticamente**; pode fechar e continuar depois.
- Cinco tipos de questão: múltipla escolha, múltipla seleção, análise de assertivas, verdadeiro/falso e aberta.
- Na **resposta aberta** pode escrever, enviar **uma foto** (JPG/PNG/WebP, até 5 MB) ou os dois.
- Tema claro (padrão) ou escuro; funciona em celular, com menu recolhível.

**Para a coordenação (administradores)**
- Cadastro de **assuntos** e de **questões** com editor de texto rico (negrito, listas, imagens, PDF, vídeo do YouTube).
- **Importação** de questões por arquivo `.md`, `.txt`, `.docx` ou `.doc`, com pré-visualização editável.
- **Montagem de questionários**, inclusive **sorteio de questões por assunto**, e opção de listar ou não na página inicial.
- **Link de compartilhamento** por questionário, com opção de gerar outro (o antigo deixa de valer).
- **Avaliação das respostas**: questionário → pessoas que responderam → respostas (ou por questão), marcando *Correta* ou *Errada*; a nota é a soma. Só quem criou o questionário avalia.
- **Usuários**: promover/remover administradores e gerar **senha temporária** para quem esqueceu a senha.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Site | Next.js 16, React 19, TypeScript, TipTap 3 (editor), CSS próprio |
| API | Node.js 22, Express 5, TypeScript, Prisma 6, Zod 4, multer, mammoth / word-extractor (importação) |
| Banco | MySQL 8.4 |
| Compartilhado | `packages/shared`: esquemas Zod, tipos, leitor do arquivo de importação, limpeza do texto rico, embaralhamento |
| Testes | Vitest + Supertest (API, contra um MySQL real) |
| Ferramentas | pnpm (workspaces), tsup (build da API), Docker (MySQL local), GitHub Actions (CI) |

## Estrutura

```
apps/
  web/        Next.js (páginas, componentes, proxy /api → API)
  api/        Express + Prisma (rotas, regras, migrações, testes)
packages/
  shared/     código usado pelos dois (validações, tipos, parser de importação)
docker-compose.yml   MySQL 8.4 para desenvolvimento (porta 3307)
.env.example         modelo das variáveis (desenvolvimento)
.env.production.example   modelo das variáveis (produção)
```

## Rodando no seu computador

Requisitos: Node.js 20 ou superior (a produção usa 22), pnpm 10 e Docker Desktop.

```bash
pnpm install
cp .env.example .env     # ajuste ADMIN_EMAILS e, se for usar o Google real, os IDs
pnpm db:up               # MySQL em Docker (porta 3307)
pnpm db:migrate          # cria/atualiza as tabelas
pnpm dev                 # site em http://localhost:3000 e API em http://localhost:4000
```

Sem credenciais do Google, deixe `DEV_AUTH_BYPASS=true` e `NEXT_PUBLIC_DEV_AUTH=true` no `.env`: a tela de login passa a ter um campo de e-mail (**só para desenvolvimento**; é ignorado em produção). Para testar o login real, crie um *OAuth Client ID* do tipo Web com origem `http://localhost:3000`.

Comandos da raiz: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (a API usa o banco `quiz_test` no mesmo MySQL) e `pnpm db:deploy` (aplica as migrações sem gerar novas).

> No Windows, `pnpm dev` mantém o motor do Prisma aberto. Pare a API antes de rodar `prisma generate`.

## Variáveis de ambiente

| Variável | Onde | Para quê |
|---|---|---|
| `DATABASE_URL` | API | conexão MySQL |
| `API_PORT` / `PORT` | API | porta (a hospedagem pode informar `PORT`) |
| `APP_ORIGIN` | API | endereço exato do site; usado na checagem de origem (CSRF) |
| `GOOGLE_CLIENT_ID` | API | valida o token do Google (obrigatório em produção) |
| `ADMIN_EMAILS` | API | e-mails que viram administradores **no login com Google** |
| `UPLOAD_DIR` | API | pasta dos arquivos enviados (fora do repositório e do deploy) |
| `SESSION_TTL_DAYS` | API | validade da sessão (padrão 14) |
| `TRUST_PROXY` | API | `true` atrás de proxy/HTTPS |
| `API_ORIGIN` | site (build) | endereço da API para onde o site repassa `/api/*` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | site (build) | mesmo Client ID do Google |
| `DEV_AUTH_BYPASS`, `NEXT_PUBLIC_DEV_AUTH` | só desenvolvimento | login por e-mail sem Google. **Nunca em produção.** |

As variáveis `NEXT_PUBLIC_*` e `API_ORIGIN` são lidas no **build** do site: ao mudá-las, é preciso um novo deploy.

## Assuntos, questões e importação

Toda questão pertence a um **assunto**. Em *Importar*, envie um arquivo no modelo de `apps/web/public/modelo-importacao.md` (há também o modelo `.docx` para baixar na própria tela). O sistema mostra uma pré-visualização com as questões válidas, as com erro e as repetidas; você edita o que precisar e confirma. Um arquivo traz **um assunto**. Questões repetidas (mesmo enunciado no mesmo assunto) são ignoradas.

## Decisões de projeto

- **Sessão**: cookie `sid` (httpOnly, SameSite=Lax, Secure em produção); só o hash SHA-256 do token fica no banco. CSRF: cabeçalho `x-csrf-token` (vem de `/auth/me`) + conferência de `Origin`. O navegador só fala com o site; o site repassa `/api/*` para a API, então não há CORS.
- **Login**: Google (o token é validado no servidor) ou e-mail e senha (hash *scrypt*, trava após 5 erros em 15 min). Contas por senha **não têm o e-mail confirmado**; por isso nunca viram administradoras por `ADMIN_EMAILS`, e se a pessoa depois entrar com o Google no mesmo e-mail, a conta é ligada e a senha é apagada.
- **Texto rico**: o enunciado é o JSON do TipTap, limpo por uma lista de permissões no servidor (`packages/shared/src/richtext.ts`). Imagens e PDF entram por `mediaId` (tipo conferido pelo conteúdo do arquivo, não pelo nome); YouTube só pelo ID, incorporado via `youtube-nocookie.com`.
- **Tentativas**: a ordem das questões (e das alternativas, se o questionário embaralhar) é sorteada uma vez e gravada. Cada gravação trava a linha da tentativa (`FOR UPDATE`), então salvamentos simultâneos e a conclusão são seguros. A tela só mostra "salvo" depois da confirmação da API.
- **Fotos de respostas**: ficam em `UPLOAD_DIR/answers`, com nome aleatório, e **não** são servidas pela rota pública de mídia: só quem respondeu e quem avalia o questionário consegue ver.
- **Sem cache** de dados dinâmicos: `Cache-Control: no-store` na API e nas páginas.
- **Gabarito nunca vai ao participante.** A correção é manual (o criador marca Correta/Errada); a tela só indica se a resposta "confere" ou "diverge" do gabarito.

## Publicação (Hostinger — Hospedagem Node.js)

Dois sites Node na mesma conta, publicados direto do GitHub (a cada `push` na `main` há novo deploy):

| | API (`api.sabercatequese.online`) | Site (`sabercatequese.online`) |
|---|---|---|
| Tipo | Express | Express (app Node comum, **não** "Next.js") |
| Raiz / build | `.` / `build:api` | `.` / `build:web` |
| Arquivo de entrada | `apps/api/dist/server.js` | `apps/web/server.cjs` |

- O script `build:api` gera o código e aplica as migrações (`prisma migrate deploy`) a cada deploy. Elas só alteram a estrutura do banco.
- O site precisa ser publicado como app Node comum: publicado como "Next.js", a hospedagem gera um servidor próprio que não encontra o pacote `next` em monorepo pnpm.
- O banco é o MySQL da própria hospedagem (`127.0.0.1:3306`); as variáveis ficam cadastradas no painel, nunca no repositório.
- O arquivo `.env.production.example` mostra todas as variáveis de produção.
