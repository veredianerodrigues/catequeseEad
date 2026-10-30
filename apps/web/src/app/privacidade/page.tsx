import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Política de Privacidade" };

const CONTATO = "verediane.designer@gmail.com";

export default function PrivacidadePage() {
  return (
    <main className="container">
      <h1>Política de Privacidade</h1>
      <p className="hint">Saber Catequese · sabercatequese.online · Atualizada em 30/10/2026</p>

      <h2>O que coletamos</h2>
      <ul>
        <li><strong>Dados da sua conta Google:</strong> nome e e-mail, informados pelo Google quando você entra. Não recebemos sua senha.</li>
        <li><strong>Suas respostas:</strong> as respostas aos questionários, a data e a hora em que você as iniciou e concluiu e, quando o responsável avalia, se cada resposta foi marcada como correta ou errada.</li>
        <li><strong>Cookie de sessão:</strong> um cookie necessário para manter você conectado. Não usamos cookies de publicidade nem ferramentas de análise de audiência.</li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>Identificar você e permitir que continue um questionário de onde parou.</li>
        <li>Permitir que a pessoa que criou o questionário veja quem o respondeu e avalie as respostas.</li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <p>Seu nome, e-mail e respostas ficam visíveis apenas para a pessoa responsável pelo questionário que você respondeu e para os administradores do sistema. Não vendemos nem cedemos seus dados a terceiros. Alguns questionários podem exibir vídeos do YouTube, carregados em modo de privacidade aprimorada.</p>

      <h2>Por quanto tempo guardamos</h2>
      <p>Mantemos seus dados enquanto o questionário estiver em uso. Você pode pedir a exclusão a qualquer momento.</p>

      <h2>Seus direitos</h2>
      <p>Você pode pedir acesso, correção ou exclusão dos seus dados escrevendo para <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.</p>

      <p><Link href="/termos">Termos de Serviço</Link> · <Link href="/login">Voltar ao início</Link></p>
    </main>
  );
}
