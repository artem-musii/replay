interface BrandMarkProps {
  compact?: boolean;
  inverse?: boolean;
}

export function BrandMark({ compact = false, inverse = false }: BrandMarkProps) {
  return (
    <span className={`brand-mark${compact ? " brand-mark--compact" : ""}`} aria-label="REPLAY">
      <svg aria-hidden="true" viewBox="0 0 28 28" className="brand-mark__symbol">
        <path
          d="M6.3 6.4h10.2a5.25 5.25 0 0 1 0 10.5H10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="m12.6 12.7-3.9 4.2 3.9 4.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16.5" cy="11.65" r="1.35" fill={inverse ? "currentColor" : "currentColor"} />
      </svg>
      {!compact && <span className="brand-mark__word">REPLAY</span>}
    </span>
  );
}
