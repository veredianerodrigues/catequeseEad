import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Termos de Serviço" };

const CONTATO = "verediane.designer@gmail.com";

export default function TermosPage() {
  return (
    <main className="container">
      <h1>Termos de Serviço</h1>
      <p className="hint">Saber Catequese · sabercatequese.online · Atualizados em 30/10/2026</p>

      <h2>O serviço</h2>
      <p>O Saber Catequese permite responder questionários de formação catequética. Para responder, você entra com sua conta Google. O uso é gratuito.</p>

      <h2>Uso adequado</h2>
      <ul>
        <li>Responda por conta própria e não compartilhe seu acesso.</li>
        <li>Não tente acessar dados de outras pessoas nem prejudicar o funcionamento do site.</li>
      </ul>

      <h2>Respostas e avaliação</h2>
      <p>Suas respostas são salvas automaticamente. Quem criou o questionário pode ver seu nome e e-mail junto das respostas e avaliá-las. O resultado depende dessa avaliação.</p>

      <h2>Conteúdo</h2>
      <p>Os textos, imagens e vídeos dos questionários pertencem aos seus autores e são usados apenas para fins de formação.</p>

      <h2>Disponibilidade</h2>
      <p>Fazemos o possível para manter o site no ar, mas ele é oferecido como está e pode ficar indisponível ou ser alterado. Podemos encerrar o acesso de quem descumprir estes termos.</p>

      <h2>Dados pessoais</h2>
      <p>O tratamento dos seus dados está descrito na <Link href="/privacidade">Política de Privacidade</Link>.</p>

      <h2>Contato</h2>
      <p>Dúvidas: <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.</p>

      <p><Link href="/login">Voltar ao início</Link></p>
    </main>
  );
}
