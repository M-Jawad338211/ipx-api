/** Daily lookups as an SVG bar chart (no chart library). */
export function UsageChart({ days }: { days: { date: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const width = 600;
  const height = 160;
  const gap = 3;
  const barWidth = (width - gap * (days.length - 1)) / days.length;
  const label = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height + 20}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Lookups per day over the last ${days.length} days: ${total.toLocaleString('en-US')} in total`}
      >
        <line x1={0} x2={width} y1={height} y2={height} className="stroke-fd-border" />
        {days.map((day, i) => {
          const h = day.count === 0 ? 0 : Math.max(2, (day.count / max) * (height - 10));
          const x = i * (barWidth + gap);
          return (
            <g key={day.date}>
              <title>{`${label(day.date)}: ${day.count.toLocaleString('en-US')} lookups`}</title>
              <rect x={x} y={0} width={barWidth} height={height} className="fill-transparent" />
              <rect
                x={x}
                y={height - h}
                width={barWidth}
                height={h}
                rx={2}
                className="fill-fd-primary"
              />
            </g>
          );
        })}
        <text x={0} y={height + 15} className="fill-fd-muted-foreground text-[11px]">
          {label(days[0]!.date)}
        </text>
        <text
          x={width}
          y={height + 15}
          textAnchor="end"
          className="fill-fd-muted-foreground text-[11px]"
        >
          {label(days[days.length - 1]!.date)}
        </text>
        <text x={width} y={10} textAnchor="end" className="fill-fd-muted-foreground text-[11px]">
          {`max ${max.toLocaleString('en-US')}/day`}
        </text>
      </svg>
      <figcaption className="mt-2 text-sm text-fd-muted-foreground">
        {total.toLocaleString('en-US')} lookups in the last {days.length} days (UTC). Updated every
        minute.
      </figcaption>
    </figure>
  );
}
