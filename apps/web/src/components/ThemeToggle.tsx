"use client";

import { useEffect, useState } from "react";

type Theme = "auto" | "light" | "dark";
const KEY = "theme";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<Theme, string> = { auto: "Automático", light: "Claro", dark: "Escuro" };
const ICON: Record<Theme, string> = { auto: "◐", light: "☀", dark: "☾" };

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function apply(t: Theme) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* navegador sem armazenamento: o tema vale só nesta visita */
  }
}

/** Alterna Automático (segue o aparelho) → Claro → Escuro. A escolha fica salva neste navegador. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => setTheme(read()), []);

  return (
    <button
      type="button"
      className="btn small ghost theme-toggle"
      title={`Tema: ${LABEL[theme]}. Clique para trocar.`}
      aria-label={`Tema: ${LABEL[theme]}. Clique para trocar.`}
      onClick={() => {
        const next = NEXT[theme];
        setTheme(next);
        apply(next);
      }}
    >
      <span aria-hidden="true">{ICON[theme]}</span> {LABEL[theme]}
    </button>
  );
}
