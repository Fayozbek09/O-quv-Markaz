import clsx from 'clsx';

/**
 * The O'QUV MARKAZ mark: an open book, drawn as inline SVG so it stays crisp at
 * any size and costs no network request. Original artwork.
 *
 * A book rather than a monogram, because the wordmark is two words long and a
 * letterform would fight it — and because the mark has to survive being 16px
 * wide in a browser tab, where only a silhouette reads.
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
      {/* Two pages meeting at the spine. */}
      <path
        d="M16 11.6c-1.9-1.6-4.3-2.4-7.1-2.4a1 1 0 0 0-1 1v10.6a1 1 0 0 0 1 1c2.8 0 5.2.8 7.1 2.4 1.9-1.6 4.3-2.4 7.1-2.4a1 1 0 0 0 1-1V10.2a1 1 0 0 0-1-1c-2.8 0-5.2.8-7.1 2.4Z"
        fill="#fff"
      />
      <path
        d="M16 11.6v12.6"
        stroke="var(--color-brand-500)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark. The name is set in caps with open tracking: two words at
 * ordinary sentence weight read as a label, the same two words locked up read
 * as a brand.
 */
export function Logo({
  size = 28,
  className,
  showText = true,
  textClassName,
}: {
  size?: number;
  className?: string;
  showText?: boolean;
  /**
   * Lets a cramped header drop the wordmark and keep the mark. "O'quv Markaz"
   * is twice the width of the name it replaced, which is enough to push a
   * header's call to action off a 360px screen.
   */
  textClassName?: string;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      {showText && (
        <span
          className={clsx(
            'whitespace-nowrap font-semibold uppercase tracking-[0.06em] text-ink',
            textClassName,
          )}
          style={{ fontSize: Math.round(size * 0.5) }}
        >
          O&rsquo;quv Markaz
        </span>
      )}
    </span>
  );
}
