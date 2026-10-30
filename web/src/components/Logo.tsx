/**
 * The mark: a ring holding a sprout over a field, with the sun coming up behind
 * it. Drawn as inline SVG so it stays sharp at any size, costs no extra request
 * and cannot fail to load on stage. The wordmark next to it stays real text, so
 * it keeps the page's own font and stays selectable and readable to a screen
 * reader.
 */
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="SokoRyari?"
    >
      <circle cx="16" cy="16" r="15" fill="#f1f7f0" />
      <circle cx="16" cy="16" r="14.1" fill="none" stroke="#0f5c3a" strokeWidth="1.8" />

      {/* sun, low behind the leaves */}
      <path d="M11.4 11.6a4.6 4.6 0 0 1 9.2 0Z" fill="#e8942a" />
      <path d="M16 3.2v1.6M7.2 6.6l1.1 1.1M24.8 6.6l-1.1 1.1" stroke="#e8942a" strokeWidth="1.1" strokeLinecap="round" />

      {/* the field the sprout is standing in */}
      <path
        d="M8.6 24.9c3.2-2.1 11.6-2.1 14.8 0M7 22.2c3.6-2.3 14.4-2.3 18 0"
        stroke="#5b8f3a"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.8"
      />

      {/* stem, then the two leaves */}
      <path d="M16 26.4c0-5 .1-8.6.1-12.4" stroke="#1c7a4f" strokeWidth="2" strokeLinecap="round" />
      <path d="M16.1 18.6c-4.4.3-7-2.2-7.5-5.9 3.9-.4 7 1.9 7.5 5.9Z" fill="#4aa15e" />
      <path d="M16.1 15.4c.5-4.3 3.6-6.7 7.4-6.5-.4 3.8-3.2 6.5-7.4 6.5Z" fill="#2e8b4f" />
      <path d="M16.1 17.2c-2.5-1.4-4.6-1.6-6.6-1.1M16.1 14.6c1.2-1.9 2.8-3.1 5-3.7" stroke="#f1f7f0" strokeWidth="0.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}
