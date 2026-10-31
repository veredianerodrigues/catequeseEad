"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "theme";

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

const Sun = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4.2" fill="currentColor" />
    {Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return <line key={i} x1={12 + Math.cos(a) * 7.2} y1={12 + Math.sin(a) * 7.2} x2={12 + Math.cos(a) * 9.6} y2={12 + Math.sin(a) * 9.6} />;
    })}
  </svg>
);
const Moon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
    <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a.6.6 0 0 0-.8-.7A9.5 9.5 0 1 0 21.2 15.4a.6.6 0 0 0-.7-.8Z" />
  </svg>
);

/** Interruptor Claro / Escuro (claro é o padrão). A escolha fica salva neste navegador. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => setTheme(read()), []);

  const choose = (t: Theme) => {
    setTheme(t);
    apply(t);
  };
  return (
    <div className="theme-switch" role="group" aria-label="Tema da tela">
      <button type="button" className={theme === "light" ? "on sun" : "sun"} aria-pressed={theme === "light"} aria-label="Tema claro" title="Tema claro" onClick={() => choose("light")}>
        <Sun />
      </button>
      <button type="button" className={theme === "dark" ? "on moon" : "moon"} aria-pressed={theme === "dark"} aria-label="Tema escuro" title="Tema escuro" onClick={() => choose("dark")}>
        <Moon />
      </button>
    </div>
  );
}
