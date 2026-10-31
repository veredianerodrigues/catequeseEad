"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "theme";
const LABEL: Record<Theme, string> = { light: "Claro", dark: "Escuro" };
const ICON: Record<Theme, string> = { light: "☀", dark: "☾" };

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(t: Theme) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try {
    if (t === "dark") localStorage.setItem(KEY, "dark");
    else localStorage.removeItem(KEY);
  } catch {
    /* navegador sem armazenamento: o tema vale só nesta visita */
  }
}

/** Alterna Claro (padrão) ↔ Escuro. A escolha fica salva neste navegador. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => setTheme(read()), []);

  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="btn small ghost theme-toggle"
      title={`Tema ${LABEL[theme]}. Mudar para ${LABEL[next].toLowerCase()}.`}
      aria-label={`Tema ${LABEL[theme]}. Mudar para ${LABEL[next].toLowerCase()}.`}
      onClick={() => {
        setTheme(next);
        apply(next);
      }}
    >
      <span aria-hidden="true">{ICON[theme]}</span> {LABEL[theme]}
    </button>
  );
}
