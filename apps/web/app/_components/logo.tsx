// Inline SVG so the mark scales crisply at every header size and we don't pay
// a network round-trip. The favicon at app/icon.svg is the same mark on a navy
// tile — keep the two in sync if you change one. Source assets + variants live
// in public/brand/.
//
// Mark: a GTA-pickup-style 3D dollar — money-green face, dark extruded depth,
// tipped 8°. "Granted" = funded; the $ is where the money is.

const S_PATH =
  "M 30.6 13.6 C 28.6 10.4, 19.0 9.8, 17.2 14.6 C 15.5 19.2, 21.0 20.8, 24 21.8 C 27.0 22.8, 32.4 24.6, 30.7 29.3 C 28.9 34.2, 19.0 33.8, 16.9 30.2";
const BAR_PATH = "M 24 6.8 L 24 37.2";
const DEPTH = "#166534";

// Extrusion: stacked copies stepping toward the lower right, deepest first.
const EXTRUDE_STEPS = Array.from({ length: 7 }, (_, i) => {
  const k = 7 - i;
  return [k * 0.42, k * 0.5] as const;
});

function Glyph({ stroke }: { stroke: string }) {
  return (
    <>
      <path d={BAR_PATH} fill="none" stroke={stroke} strokeWidth={3.5} strokeLinecap="round" />
      <path d={S_PATH} fill="none" stroke={stroke} strokeWidth={5.2} strokeLinecap="round" />
    </>
  );
}

type Props = {
  /** Pixel size for both width and height. Defaults to 28. */
  size?: number;
  className?: string;
};

export function Logo({ size = 28, className }: Props) {
  // Unique gradient id so multiple Logo instances don't collide (id clashes
  // silently break the gradient fill).
  const gradId = `granted-face-${size}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="45%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      <g transform="rotate(-8 24 22)">
        {EXTRUDE_STEPS.map(([dx, dy]) => (
          <g key={dx} transform={`translate(${dx.toFixed(2)},${dy.toFixed(2)})`}>
            <Glyph stroke={DEPTH} />
          </g>
        ))}
        {/* Front face */}
        <path
          d={S_PATH}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={5.2}
          strokeLinecap="round"
        />
        {/* Rim light for the game-pickup shine */}
        <g transform="translate(-0.35,-0.55)" opacity={0.32}>
          <path d={S_PATH} fill="none" stroke="white" strokeWidth={1.4} strokeLinecap="round" />
        </g>
        {/* Crossbar last, with a dark edge — the edge is what keeps the "$"
            reading as a dollar (not an S) once the extrusion blurs at 16px. */}
        <path d={BAR_PATH} fill="none" stroke={DEPTH} strokeWidth={4.7} strokeLinecap="round" />
        <path
          d={BAR_PATH}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
