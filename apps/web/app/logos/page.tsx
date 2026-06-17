// TEMP logo gallery — candidate marks rendered at real sizes so we can pick one.
// Delete this route once a logo is chosen.

type GlyphProps = { id: string };

function Tile({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden
      style={{ filter: "drop-shadow(0 1px 2px rgba(79,70,229,0.30))" }}>
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill={`url(#g-${id})`} />
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.6" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
      {children}
    </svg>
  );
}

const W = "white";

// A — Locator: an aperture ring with a bright off-center node + crosshair ticks.
// "We pinpoint the funded match hiding in the field."
function Locator({ id }: GlyphProps) {
  return (
    <Tile id={id}>
      <circle cx="11" cy="11" r="5.2" fill="none" stroke={W} strokeWidth="1.7" opacity="0.85" />
      <line x1="11" y1="3.4" x2="11" y2="5.4" stroke={W} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <line x1="11" y1="16.6" x2="11" y2="18.6" stroke={W} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <line x1="3.4" y1="11" x2="5.4" y2="11" stroke={W} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <line x1="16.6" y1="11" x2="18.6" y2="11" stroke={W} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <circle cx="13.1" cy="9" r="1.9" fill={W} />
    </Tile>
  );
}

// B — Signal / radar: concentric arcs opening from a node. "Hidden demand,
// picked up like a signal."
function Signal({ id }: GlyphProps) {
  return (
    <Tile id={id}>
      <circle cx="8.5" cy="15.5" r="1.9" fill={W} />
      <path d="M8.5 11.2a4.3 4.3 0 0 1 4.3 4.3" fill="none" stroke={W} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.5 7.4a8.1 8.1 0 0 1 8.1 8.1" fill="none" stroke={W} strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
    </Tile>
  );
}

// C — Spark / discovery: a 4-point star. "You found the one that fits."
function Spark({ id }: GlyphProps) {
  return (
    <Tile id={id}>
      <path d="M12 4.5c.7 4 2.5 5.8 6.5 6.5-4 .7-5.8 2.5-6.5 6.5-.7-4-2.5-5.8-6.5-6.5 4-.7 5.8-2.5 6.5-6.5Z" fill={W} />
    </Tile>
  );
}

// D — Monogram: a custom lowercase "g". Ownable, no metaphor baggage.
function Monogram({ id }: GlyphProps) {
  return (
    <Tile id={id}>
      <text x="12" y="12" textAnchor="middle" dominantBaseline="central"
        fontFamily="var(--font-inter), system-ui, sans-serif" fontSize="15" fontWeight={700} fill={W}>
        g
      </text>
    </Tile>
  );
}

// E — Pin + spark: a location pin whose center is a spark. "Find the funded
// place doing your work."
function PinSpark({ id }: GlyphProps) {
  return (
    <Tile id={id}>
      <path d="M12 5.2c-2.9 0-5.2 2.3-5.2 5.2 0 3.6 5.2 8.4 5.2 8.4s5.2-4.8 5.2-8.4c0-2.9-2.3-5.2-5.2-5.2Z"
        fill="none" stroke={W} strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="10.3" r="2" fill={W} />
    </Tile>
  );
}

// F — Aperture/funnel: lines converging to a node. "Narrow a whole field down
// to the matches."
function Funnel({ id }: GlyphProps) {
  return (
    <Tile id={id}>
      <path d="M5.5 7h13l-4.6 5.2v4.4l-3.8 1.8v-6.2L5.5 7Z" fill="none" stroke={W} strokeWidth="1.6" strokeLinejoin="round" />
    </Tile>
  );
}

const CANDIDATES = [
  { key: "A", name: "Locator", concept: "Aperture + node — pinpoints the funded match in the field.", Glyph: Locator },
  { key: "B", name: "Signal", concept: "Radar arcs from a node — hidden demand picked up like a signal.", Glyph: Signal },
  { key: "C", name: "Spark", concept: "Four-point star — discovery, the one that fits.", Glyph: Spark },
  { key: "D", name: "Monogram g", concept: "Custom letterform — ownable, no metaphor.", Glyph: Monogram },
  { key: "E", name: "Pin + spark", concept: "A place on the map doing your work.", Glyph: PinSpark },
  { key: "F", name: "Funnel", concept: "Narrow a whole field down to the matches.", Glyph: Funnel },
];

export default function LogosPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Logo candidates</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Each shown at large, header (24px), and favicon (16px) sizes, plus next to the wordmark.
        Tell me a letter (A–F) and I&rsquo;ll ship it and delete this page.
      </p>

      <div className="mt-8 grid gap-4">
        {CANDIDATES.map(({ key, name, concept, Glyph }) => (
          <div key={key} className="paper flex items-center gap-5 p-5">
            <div className="h-14 w-14 shrink-0"><Glyph id={`lg-${key}`} /></div>
            <div className="h-6 w-6 shrink-0"><Glyph id={`md-${key}`} /></div>
            <div className="h-4 w-4 shrink-0"><Glyph id={`sm-${key}`} /></div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="h-6 w-6"><Glyph id={`wm-${key}`} /></div>
              <span className="text-[17px] font-semibold tracking-tight">granted</span>
            </div>
            <div className="ml-auto text-right">
              <p className="font-semibold">{key} · {name}</p>
              <p className="text-xs text-[var(--color-muted)]">{concept}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
