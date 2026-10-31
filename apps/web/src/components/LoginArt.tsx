"use client";

import { useEffect, useState } from "react";
import { LoginBackground } from "./LoginBackground";

/** Se existir uma pintura em public/login-art.(jpg|png|webp) ela é usada; senão, a cena de reserva. */
const CANDIDATES = ["/login-art.jpg", "/login-art.png", "/login-art.webp"];

// Posições em relação à pintura (caixa de 890 x 941): auréola, estrelinhas, corações e partículas.
const HALO = { x: 470, y: 255 };
const SPARKLES = [[360, 150, 0], [590, 170, 0.9], [430, 95, 1.7], [575, 305, 0.4], [250, 430, 2.2], [705, 440, 1.3], [120, 250, 2.6], [800, 180, 0.7]];
const HEARTS = [[150, 720, 0], [260, 760, 2.1], [440, 790, 4.2], [600, 760, 1.2], [740, 720, 3.3], [350, 700, 5.1]];
const MOTES = [[90, 330, 0, 16], [210, 120, 3, 21], [330, 380, 6, 18], [520, 60, 2, 24], [690, 330, 8, 19], [790, 110, 5, 22], [610, 220, 11, 20], [150, 470, 9, 17]];

function Fx() {
  return (
    <svg className="login-fx" viewBox="0 0 890 941" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <radialGradient id="fx-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff3b0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff3b0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="fx-rays" style={{ transformOrigin: `${HALO.x}px ${HALO.y}px` }} opacity="0.13" fill="#fff6c4">
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d="M0 0 L-14 -700 L14 -700 Z" transform={`translate(${HALO.x} ${HALO.y}) rotate(${i * (360 / 14)})`} />
        ))}
      </g>
      <circle className="fx-glow" cx={HALO.x} cy={HALO.y} r="190" fill="url(#fx-glow)" />
      {MOTES.map(([x, y, d, t], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <circle className="fx-mote" r="3" fill="#fffbe0" style={{ animationDelay: `${d}s`, animationDuration: `${t}s` }} />
        </g>
      ))}
      {SPARKLES.map(([x, y, d], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path className="art-twinkle" d="M0 -11 L2.8 -2.8 L11 0 L2.8 2.8 L0 11 L-2.8 2.8 L-11 0 L-2.8 -2.8 Z" fill="#fff4b8" style={{ animationDelay: `${d}s` }} />
        </g>
      ))}
      {HEARTS.map(([x, y, d], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path className="art-heart" d="M0 8 C-14 -3 -11 -14 0 -7 C11 -14 14 -3 0 8 Z" style={{ animationDelay: `${d}s` }} />
        </g>
      ))}
    </svg>
  );
}

export function LoginArt() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const url of CANDIDATES) {
        const ok = await new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        if (ok && !cancelled) return setSrc(url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="login-art-pane" aria-hidden="true">
      {src ? (
        <div className="login-photo-wrap">
          <div className="login-photo" style={{ backgroundImage: `url(${src})` }} />
          <Fx />
        </div>
      ) : (
        <LoginBackground />
      )}
    </div>
  );
}
