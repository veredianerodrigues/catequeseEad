// Entrada para hospedagem Node (publicação como app Node comum, sem o server.js gerado pela plataforma).
// Sobe o Next já compilado (`next build`) a partir desta pasta. Localmente continue usando `pnpm dev`.
const http = require("node:http");
const next = require("next");

const port = Number(process.env.PORT || 3000);
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    http
      .createServer((req, res) => {
        handle(req, res).catch((err) => {
          console.error(err);
          res.statusCode = 500;
          res.end("Erro interno");
        });
      })
      .listen(port, () => console.log(`Site em http://localhost:${port}`));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
