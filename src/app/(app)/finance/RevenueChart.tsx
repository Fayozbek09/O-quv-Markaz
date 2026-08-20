type Month = { month: number; label: string; revenue: number; cost: number; net: number };

/**
 * Twelve months of revenue against cost, drawn as inline SVG.
 *
 * No charting library: the shape is simple, and shipping one would add a
 * third-party script to a page that already renders on the server. Bars are
 * scaled to the largest single value so the axis is honest.
 */
export function RevenueChart({
  months,
  labels,
}: {
  months: Month[];
  labels: { revenue: string; cost: string };
}) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.cost)));
  const width = 720;
  const height = 200;
  const padding = { top: 8, bottom: 22 };
  const usable = height - padding.top - padding.bottom;
  const slot = width / months.length;
  const barWidth = Math.min(14, slot / 3);

  return (
    <div className="w-full overflow-x-auto">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-ok-600" aria-hidden="true" />
          {labels.revenue}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-warn-600" aria-hidden="true" />
          {labels.cost}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[200px] w-full min-w-[600px]"
        role="img"
        aria-label={`${labels.revenue} / ${labels.cost}`}
      >
        {months.map((m, index) => {
          const x = index * slot + slot / 2;
          const revenueHeight = (m.revenue / max) * usable;
          const costHeight = (m.cost / max) * usable;
          const baseline = height - padding.bottom;
          return (
            <g key={m.month}>
              <rect
                x={x - barWidth - 1}
                y={baseline - revenueHeight}
                width={barWidth}
                height={Math.max(0, revenueHeight)}
                rx="2"
                className="fill-ok-600"
              />
              <rect
                x={x + 1}
                y={baseline - costHeight}
                width={barWidth}
                height={Math.max(0, costHeight)}
                rx="2"
                className="fill-warn-600"
              />
              <text
                x={x}
                y={height - 6}
                textAnchor="middle"
                className="fill-current text-[10px] text-ink-faint"
              >
                {m.label}
              </text>
            </g>
          );
        })}
        <line
          x1="0"
          y1={height - padding.bottom}
          x2={width}
          y2={height - padding.bottom}
          className="stroke-line"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
