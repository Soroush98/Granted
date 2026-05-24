// Inline SVG so the gradient + drop-shadow scale crisply at every header
// size and so we don't pay the network round-trip for an asset. Mirrors the
// favicon at app/icon.svg — keep the two in sync if you change one.

type Props = {
  /** Pixel size for both width and height. Defaults to 28. */
  size?: number;
  className?: string;
};

export function Logo({ size = 28, className }: Props) {
  // Generate a unique gradient ID so multiple Logo instances on the same page
  // don't collide (id collisions silently break the gradient fill).
  const gradId = `granted-coin-${size}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
      style={{ filter: "drop-shadow(0 1px 2px rgba(11,13,16,0.15))" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1d22" />
          <stop offset="100%" stopColor="#c8102e" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill={`url(#${gradId})`} />
      {/* Soft inner ring — gives the coin a bevelled, lit-from-above feel
          without needing a second light source. */}
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="0.5"
      />
      {/* Dollar glyph: vertical bar + S-curve. Adapted from Heroicons
          currency-dollar outline so the proportions are typographically
          correct at small sizes. */}
      <path
        d="M12 6.5v11m-3-2.5.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.5 12.768 12.3 12 12.3c-2.21 0-4-1.6-4-3.5s1.79-3.3 4-3.3 4 1.4 4 3.3"
        fill="none"
        stroke="white"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
