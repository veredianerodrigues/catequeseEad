import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Baloo_2, Nunito } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const display = Baloo_2({ subsets: ["latin", "latin-ext"], weight: ["500", "700", "800"], variable: "--font-display", display: "swap" });
const sans = Nunito({ subsets: ["latin", "latin-ext"], weight: ["400", "600", "700", "800"], variable: "--font-sans", display: "swap" });

const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export const metadata: Metadata = { title: "Saber Catequese", description: "Material de apoio para catequese — Paróquia Perpétuo Socorro, Cascavel – PR." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
