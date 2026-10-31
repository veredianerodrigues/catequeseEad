/** Marca do Saber Catequese: igrejinha com raios de sol sobre as colinas. Decorativa. */
export function ChurchLogo() {
  const rays = Array.from({ length: 9 }, (_, i) => {
    const a = ((-160 + i * 17.5) * Math.PI) / 180;
    return { x1: 110 + Math.cos(a) * 34, y1: 40 + Math.sin(a) * 34, x2: 110 + Math.cos(a) * 46, y2: 40 + Math.sin(a) * 46 };
  });
  return (
    <svg className="church-logo" viewBox="0 0 220 150" aria-hidden="true" focusable="false">
      <g stroke="#e3a21a" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {rays.map((r, i) => (
          <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
        ))}
        <path d="M110 18 V42 M100 27 H120" />
        <path d="M80 118 V72 L110 48 L140 72 V118" />
        <path d="M99 118 V96 a11 11 0 0 1 22 0 V118" />
      </g>
      <g stroke="#7ea45a" strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M12 128 Q60 100 104 120" />
        <path d="M116 120 Q160 100 208 128" />
      </g>
    </svg>
  );
}
