"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "./ThemeToggle";

export function Shell({ children, adminOnly = false, wide = false }: { children: ReactNode; adminOnly?: boolean; wide?: boolean }) {
  const { me, loading, signOut } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

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
    { href: "/admin/reviews", label: "Respostas", show: me.role === "ADMIN" },
    { href: "/admin/users", label: "Usuários", show: me.role === "ADMIN" },
  ].filter((n) => n.show);

  const isActive = (href: string) => (href === "/" || href === "/admin" ? pathname === href || (href === "/admin" && pathname.startsWith("/admin/questions")) : pathname.startsWith(href));

  return (
    <>
      <a href="#conteudo" className="skip">Ir para o conteúdo</a>
      <header className={`topbar${menuOpen ? " menu-open" : ""}`}>
        <button type="button" className="btn small ghost menu-btn" aria-expanded={menuOpen} aria-controls="menu-principal" onClick={() => setMenuOpen((o) => !o)}>
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span> Menu
        </button>
        <nav id="menu-principal" aria-label="Principal">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined} onClick={() => setMenuOpen(false)}>{n.label}</Link>
          ))}
        </nav>
        <div className="who">
          <span title={me.email}>{me.name}</span>
          <ThemeToggle />
          {me.hasPassword && <Link href="/senha">Trocar senha</Link>}
          <button className="btn small ghost" onClick={() => void signOut()}>Sair</button>
        </div>
      </header>
      <main id="conteudo" className={`container${wide ? " wide" : ""}`}>{children}</main>
    </>
  );
}
