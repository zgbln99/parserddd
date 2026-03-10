import { useMemo, useState } from 'react';

export interface BarChartBar {
  label: string;
  segments: { value: number; color: string; name: string }[];
}

interface BarChartProps {
  bars: BarChartBar[];
  height?: number;
  /** Format value for tooltip / axis */
  formatValue?: (v: number) => string;
}

export function BarChart({ bars, height = 200, formatValue = (v) => v.toFixed(1) }: BarChartProps) {
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const maxVal = useMemo(() => {
    let m = 0;
    for (const b of bars) {
      const total = b.segments.reduce((s, seg) => s + seg.value, 0);
      if (total > m) m = total;
    }
    return m || 1;
  }, [bars]);

  // Grid lines (4 steps)
  const gridLines = useMemo(() => {
    const step = Math.ceil(maxVal / 4);
    const lines: number[] = [];
    for (let v = step; v <= maxVal + step * 0.1; v += step) lines.push(v);
    return lines;
  }, [maxVal]);

  const padding = { top: 10, right: 10, bottom: 40, left: 45 };
  const chartW = Math.max(bars.length * 36, 300);
  const chartH = height;
  const innerW = chartW - padding.left - padding.right;
  const innerH = chartH - padding.top - padding.bottom;
  const barW = Math.min(24, (innerW / bars.length) * 0.7);
  const gap = innerW / bars.length;

  return (
    <div className="overflow-x-auto">
      <svg
        width={chartW}
        height={chartH}
        className="select-none text-xs"
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid lines + Y axis labels */}
        {gridLines.map((v) => {
          const y = padding.top + innerH - (v / maxVal) * innerH;
          return (
            <g key={v}>
              <line
                x1={padding.left}
                x2={chartW - padding.right}
                y1={y}
                y2={y}
                className="stroke-gray-200 dark:stroke-gray-700"
                strokeDasharray="4 3"
              />
              <text
                x={padding.left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-gray-400 text-[10px] dark:fill-gray-500"
              >
                {formatValue(v)}
              </text>
            </g>
          );
        })}

        {/* Baseline */}
        <line
          x1={padding.left}
          x2={chartW - padding.right}
          y1={padding.top + innerH}
          y2={padding.top + innerH}
          className="stroke-gray-300 dark:stroke-gray-600"
        />

        {/* Bars */}
        {bars.map((bar, i) => {
          const cx = padding.left + gap * i + gap / 2;
          let yAcc = 0;
          const rects = bar.segments.map((seg, si) => {
            const h = (seg.value / maxVal) * innerH;
            const y = padding.top + innerH - yAcc - h;
            yAcc += h;
            return (
              <rect
                key={si}
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={Math.max(h, 0)}
                rx={si === bar.segments.length - 1 ? 3 : 0}
                fill={seg.color}
                className="transition-opacity"
                opacity={hover && hover.idx !== i ? 0.4 : 1}
              />
            );
          });

          return (
            <g
              key={i}
              onMouseEnter={(e) => setHover({ idx: i, x: cx, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer"
            >
              {/* Hit area */}
              <rect
                x={cx - gap / 2}
                y={padding.top}
                width={gap}
                height={innerH}
                fill="transparent"
              />
              {rects}
              {/* X label */}
              <text
                x={cx}
                y={padding.top + innerH + 16}
                textAnchor="middle"
                className="fill-gray-500 text-[10px] dark:fill-gray-400"
              >
                {bar.label}
              </text>
            </g>
          );
        })}

        {/* Tooltip */}
        {hover && (() => {
          const bar = bars[hover.idx];
          const total = bar.segments.reduce((s, seg) => s + seg.value, 0);
          const tooltipW = 120;
          const tooltipH = 18 + bar.segments.length * 16;
          let tx = hover.x - tooltipW / 2;
          if (tx < 0) tx = 4;
          if (tx + tooltipW > chartW) tx = chartW - tooltipW - 4;
          const ty = padding.top - 4;

          return (
            <g>
              <rect
                x={tx}
                y={ty - tooltipH}
                width={tooltipW}
                height={tooltipH}
                rx={6}
                className="fill-gray-900 dark:fill-gray-100"
                opacity={0.92}
              />
              <text
                x={tx + 8}
                y={ty - tooltipH + 14}
                className="fill-white text-[10px] font-bold dark:fill-gray-900"
              >
                {bar.label} — {formatValue(total)}h
              </text>
              {bar.segments.map((seg, si) => (
                <g key={si}>
                  <rect
                    x={tx + 8}
                    y={ty - tooltipH + 22 + si * 16}
                    width={8}
                    height={8}
                    rx={2}
                    fill={seg.color}
                  />
                  <text
                    x={tx + 20}
                    y={ty - tooltipH + 30 + si * 16}
                    className="fill-white text-[10px] dark:fill-gray-900"
                  >
                    {seg.name}: {formatValue(seg.value)}h
                  </text>
                </g>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
