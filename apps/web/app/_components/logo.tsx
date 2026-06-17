// Inline SVG so the gradient scales crisply at every header size and we don't
// pay a network round-trip. Mirrors the favicon at app/icon.svg — keep the two
// in sync if you change one.
//
// Mark: a rounded indigo tile with a clean checkmark — "granted" = approved /
// funded. Reads as a modern app icon and matches --color-accent.

type Props = {
  /** Pixel size for both width and height. Defaults to 28. */
  size?: number;
  className?: string;
};

export function Logo({ size = 28, className }: Props) {
  // Unique gradient id so multiple Logo instances don't collide (id clashes
  // silently break the gradient fill).
  const gradId = `granted-tile-${size}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
      style={{ filter: "drop-shadow(0 1px 2px rgba(79,70,229,0.30))" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      {/* Rounded tile */}
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill={`url(#${gradId})`} />
      {/* Top highlight for a lit-from-above feel */}
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5.6"
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
      />
      {/* Checkmark — "granted" */}
      <path
        d="M7 12.4l3.2 3.2L17.2 8.4"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
