import clsx from 'clsx';

/**
 * Ustozly mark: an open notebook whose pages form a "U". Drawn as inline SVG so
 * it stays crisp at any size and needs no network request. Original artwork.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="var(--color-brand-500)" />
      <path
        d="M9 8v11a7 7 0 0 0 14 0V8"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path d="M16 8v13" stroke="#fff" strokeOpacity=".45" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16" cy="24.5" r="1.6" fill="#fff" />
    </svg>
  );
}

export function Logo({
  size = 28,
  className,
  showText = true,
}: {
  size?: number;
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      {showText && (
        <span
          className="font-semibold tracking-tight text-ink"
          style={{ fontSize: Math.round(size * 0.62) }}
        >
          Ustozly
        </span>
      )}
    </span>
  );
}
