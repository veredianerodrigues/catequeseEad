"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export function Shell({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { me, loading, signOut } = useAuth();
  const pathname = usePathname();

  if (loading || !me) return <main className="center"><p className="hint" role="status">Carregando…</p></main>;
  if (adminOnly && me.role !== "ADMIN") {
    return (
      <main className="center">
        <h1>Acesso restrito</h1>
        <p>Esta área é exclusiva para administradores.</p>
        <Link className="btn" href="/">Voltar ao início</Link>
      </main>
    );
  }

  const nav = [
    { href: "/", label: "Questionários", show: true },
    { href: "/admin", label: "Questões", show: me.role === "ADMIN" },
    { href: "/admin/subjects", label: "Assuntos", show: me.role === "ADMIN" },
    { href: "/admin/import", label: "Importar", show: me.role === "ADMIN" },
    { href: "/admin/questionnaires", label: "Montar questionários", show: me.role === "ADMIN" },
    { href: "/admin/users", label: "Usuários", show: me.role === "ADMIN" },
  ].filter((n) => n.show);

  const isActive = (href: string) => (href === "/" || href === "/admin" ? pathname === href || (href === "/admin" && pathname.startsWith("/admin/questions")) : pathname.startsWith(href));

  return (
    <>
      <a href="#conteudo" className="skip">Ir para o conteúdo</a>
      <header className="topbar">
        <nav aria-label="Principal">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}>{n.label}</Link>
          ))}
        </nav>
        <div className="who">
          <span title={me.email}>{me.name}</span>
          <button className="btn small ghost" onClick={() => void signOut()}>Sair</button>
        </div>
      </header>
      <main id="conteudo" className="container">{children}</main>
    </>
  );
}
