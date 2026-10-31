/** Fundo animado da tela de login: Jesus com as crianças. Ilustração em SVG, decorativa (sem texto). */

type Kid = { x: number; y: number; s: number; skin: string; hair: string; cloth: string; delay: number };

const KIDS: Kid[] = [
  { x: 215, y: 612, s: 0.85, skin: "#e8b88a", hair: "#3a2a1f", cloth: "#4a90e2", delay: 0 },
  { x: 330, y: 602, s: 1, skin: "#8d5a3b", hair: "#1f1a17", cloth: "#f7c948", delay: 0.6 },
  { x: 435, y: 614, s: 1.1, skin: "#f1c9a5", hair: "#c99a45", cloth: "#ef6f6c", delay: 1.2 },
  { x: 770, y: 614, s: 1.1, skin: "#d9a066", hair: "#6b4423", cloth: "#5cb85c", delay: 0.3 },
  { x: 872, y: 602, s: 1, skin: "#f1c9a5", hair: "#3a2a1f", cloth: "#9b6bd6", delay: 0.9 },
  { x: 985, y: 612, s: 0.85, skin: "#8d5a3b", hair: "#1f1a17", cloth: "#f58fb5", delay: 1.5 },
  { x: 540, y: 648, s: 0.7, skin: "#e8b88a", hair: "#6b4423", cloth: "#3aafa9", delay: 0.4 },
  { x: 662, y: 648, s: 0.7, skin: "#d9a066", hair: "#1f1a17", cloth: "#ff8a1f", delay: 1.1 },
];

const SPARKLES = [
  [150, 170, 0], [310, 90, 0.8], [470, 200, 1.6], [740, 160, 0.4], [900, 90, 1.2], [1060, 190, 2], [600, 70, 0.6], [1120, 330, 1.4],
];

const HEARTS = [
  [330, 478, 0], [440, 466, 2.2], [775, 466, 1.1], [875, 478, 3.1], [1000, 490, 4],
];

function Kid({ x, y, s, skin, hair, cloth, delay }: Kid) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className="art-bob" style={{ animationDelay: `${delay}s` }}>
        <path d="M-20 -70 Q-22 -20 -26 0 L26 0 Q22 -20 20 -70 Z" fill={cloth} />
        <path d="M-20 -62 Q-38 -66 -40 -88" stroke={skin} strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M20 -62 Q38 -58 42 -78" stroke={skin} strokeWidth="9" strokeLinecap="round" fill="none" />
        <circle cx="0" cy="-92" r="22" fill={skin} />
        <path d="M-23 -96 Q-23 -120 0 -119 Q23 -120 23 -96 Q8 -108 -23 -96 Z" fill={hair} />
        <circle cx="-8" cy="-91" r="2.4" fill="#3a2a1f" />
        <circle cx="8" cy="-91" r="2.4" fill="#3a2a1f" />
        <path d="M-7 -82 Q0 -75 7 -82" stroke="#3a2a1f" strokeWidth="2" strokeLinecap="round" fill="none" />
        <rect x="-18" y="-4" width="14" height="6" rx="3" fill="#5a4636" />
        <rect x="4" y="-4" width="14" height="6" rx="3" fill="#5a4636" />
      </g>
    </g>
  );
}

function Cloud({ x, y, s, cls }: { x: number; y: number; s: number; cls: string }) {
  return (
    <g className={cls}>
      <g transform={`translate(${x} ${y}) scale(${s})`} style={{ fill: "var(--art-cloud)" }} opacity="0.92">
        <ellipse cx="0" cy="0" rx="62" ry="22" />
        <ellipse cx="-36" cy="6" rx="40" ry="16" />
        <ellipse cx="40" cy="6" rx="46" ry="17" />
        <ellipse cx="8" cy="-12" rx="38" ry="19" />
      </g>
    </g>
  );
}

export function LoginBackground() {
  return (
    <div className="login-art" aria-hidden="true">
      <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMax slice" focusable="false">
        <defs>
          <linearGradient id="art-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--art-sky-top)" }} />
            <stop offset="1" style={{ stopColor: "var(--art-sky-bottom)" }} />
          </linearGradient>
          <radialGradient id="art-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: "var(--art-ray)", stopOpacity: 0.85 }} />
            <stop offset="1" style={{ stopColor: "var(--art-ray)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        <rect width="1200" height="700" fill="url(#art-sky)" />
        <circle cx="600" cy="330" r="300" fill="url(#art-glow)" />

        <g className="art-rays" style={{ fill: "var(--art-ray)" }} opacity="0.2">
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d="M0 0 L-16 -560 L16 -560 Z" transform={`translate(600 330) rotate(${i * 22.5})`} />
          ))}
        </g>

        <Cloud x={190} y={150} s={1.1} cls="art-drift art-drift-a" />
        <Cloud x={880} y={110} s={0.9} cls="art-drift art-drift-b" />
        <Cloud x={1040} y={260} s={0.7} cls="art-drift art-drift-c" />
        <Cloud x={470} y={310} s={0.6} cls="art-drift art-drift-b" />

        {SPARKLES.map(([x, y, d], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path
              className="art-twinkle"
              d="M0 -10 L2.5 -2.5 L10 0 L2.5 2.5 L0 10 L-2.5 2.5 L-10 0 L-2.5 -2.5 Z"
              style={{ fill: "var(--art-spark)", animationDelay: `${d}s` }}
            />
          </g>
        ))}

        <path d="M0 560 Q200 500 420 545 T820 535 T1200 520 V700 H0 Z" style={{ fill: "var(--art-hill-back)" }} />

        {KIDS.slice(0, 6).map((k, i) => (
          <Kid key={i} {...k} />
        ))}

        {/* Jesus */}
        <g transform="translate(600 610) scale(0.95)">
          <circle cx="0" cy="-222" r="54" fill="none" stroke="#ffcf3f" strokeWidth="7" opacity="0.95" />
          <path d="M-42 -190 L-78 0 L78 0 L42 -190 Z" style={{ fill: "var(--art-robe)" }} />
          <path d="M-42 -190 L-78 0 L-22 0 L12 -150 Z" fill="#4a6fd6" />
          <path d="M-8 -188 L-8 0" stroke="#d9d4ee" strokeWidth="2" opacity="0.7" />
          <rect x="-34" y="-128" width="68" height="9" rx="4" fill="#d9a441" />
          <path d="M-38 -176 Q-86 -164 -116 -126" stroke="#f3eefc" strokeWidth="24" strokeLinecap="round" fill="none" />
          <path d="M38 -176 Q86 -164 116 -126" stroke="#f3eefc" strokeWidth="24" strokeLinecap="round" fill="none" />
          <circle cx="-120" cy="-121" r="11" fill="#ffd6a8" />
          <circle cx="120" cy="-121" r="11" fill="#ffd6a8" />
          <ellipse cx="0" cy="-220" rx="35" ry="42" fill="#7a5a3a" />
          <ellipse cx="0" cy="-214" rx="25" ry="30" fill="#ffd6a8" />
          <path d="M-26 -208 Q0 -148 26 -208 Q23 -186 0 -178 Q-23 -186 -26 -208 Z" fill="#5d4129" />
          <path d="M-25 -228 Q0 -250 25 -228 Q10 -236 -25 -228 Z" fill="#7a5a3a" />
          <circle cx="-9" cy="-218" r="2.6" fill="#3a2a1f" />
          <circle cx="9" cy="-218" r="2.6" fill="#3a2a1f" />
          <path d="M-7 -196 Q0 -190 7 -196" stroke="#f1b6a0" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </g>

        {KIDS.slice(6).map((k, i) => (
          <Kid key={i} {...k} />
        ))}

        {HEARTS.map(([x, y, d], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path className="art-heart" d="M0 7 C-12 -3 -9 -12 0 -6 C9 -12 12 -3 0 7 Z" style={{ animationDelay: `${d}s` }} />
          </g>
        ))}

        <path d="M0 640 Q300 604 600 628 T1200 612 V700 H0 Z" style={{ fill: "var(--art-hill-front)" }} />
      </svg>
    </div>
  );
}
