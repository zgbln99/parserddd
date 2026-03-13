import { useMemo, useState, useRef } from 'react';

export interface BarChartBar {
  label: string;
  sublabel?: string;
  segments: { value: number; color: string; name: string }[];
}

interface BarChartProps {
  bars: BarChartBar[];
  height?: number;
  /** Format value for tooltip / axis */
  formatValue?: (v: number) => string;
}

export function BarChart({ bars, height = 280, formatValue = (v) => v.toFixed(1) }: BarChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const maxVal = useMemo(() => {
    let m = 0;
    for (const b of bars) {
      const total = b.segments.reduce((s, seg) => s + seg.value, 0);
      if (total > m) m = total;
    }
    return m || 1;
  }, [bars]);

  // Nice grid lines (round numbers)
  const gridLines = useMemo(() => {
    const nice = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24];
    let step = 2;
    for (const n of nice) {
      if (maxVal / n <= 5) { step = n / Math.ceil(maxVal / n); break; }
    }
    step = Math.max(1, Math.ceil(maxVal / 5));
    const lines: number[] = [];
    for (let v = step; v <= maxVal + step * 0.1; v += step) lines.push(v);
    return lines;
  }, [maxVal]);

  const padding = { top: 28, right: 16, bottom: 52, left: 42 };
  const barSlotW = Math.max(44, Math.min(60, 800 / bars.length));
  const chartW = Math.max(padding.left + padding.right + bars.length * barSlotW, 400);
  const chartH = height;
  const innerW = chartW - padding.left - padding.right;
  const innerH = chartH - padding.top - padding.bottom;
  const barW = Math.min(barSlotW * 0.65, 36);
  const gap = innerW / bars.length;

  return (
    <div ref={containerRef} className="overflow-x-auto">
      <svg
        width={chartW}
        height={chartH}
        className="select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y-axis unit */}
        <text
          x={padding.left - 6}
          y={padding.top - 10}
          textAnchor="end"
          className="fill-gray-400 text-[10px] dark:fill-gray-500"
        >
          h
        </text>

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
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-gray-400 text-[11px] dark:fill-gray-500"
              >
                {v}
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

        {/* Zero label */}
        <text
          x={padding.left - 8}
          y={padding.top + innerH + 4}
          textAnchor="end"
          className="fill-gray-400 text-[11px] dark:fill-gray-500"
        >
          0
        </text>

        {/* Bars */}
        {bars.map((bar, i) => {
          const cx = padding.left + gap * i + gap / 2;
          const total = bar.segments.reduce((s, seg) => s + seg.value, 0);
          const isHovered = hoverIdx === i;
          let yAcc = 0;

          const rects = bar.segments.map((seg, si) => {
            const h = (seg.value / maxVal) * innerH;
            const y = padding.top + innerH - yAcc - h;
            yAcc += h;
            if (seg.value === 0) return null;
            const isTop = si === bar.segments.length - 1 ||
              bar.segments.slice(si + 1).every(s => s.value === 0);
            return (
              <rect
                key={si}
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={Math.max(h, 0.5)}
                rx={isTop ? 4 : 0}
                ry={isTop ? 4 : 0}
                fill={seg.color}
                className="transition-all duration-150"
                opacity={hoverIdx !== null && !isHovered ? 0.35 : 1}
                style={isHovered ? { filter: 'brightness(1.1)' } : undefined}
              />
            );
          });

          // Total value label on top
          const totalBarH = (total / maxVal) * innerH;
          const topY = padding.top + innerH - totalBarH;

          return (
            <g
              key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            >
              {/* Hit area */}
              <rect
                x={cx - gap / 2}
                y={padding.top}
                width={gap}
                height={innerH + padding.bottom}
                fill="transparent"
              />

              {/* Hover background highlight */}
              {isHovered && (
                <rect
                  x={cx - gap / 2 + 2}
                  y={padding.top}
                  width={gap - 4}
                  height={innerH}
                  rx={4}
                  className="fill-gray-100 dark:fill-gray-800"
                  opacity={0.5}
                />
              )}

              {rects}

              {/* Total value on top of bar */}
              {total > 0 && (
                <text
                  x={cx}
                  y={topY - 6}
                  textAnchor="middle"
                  className={`text-[10px] font-semibold transition-opacity duration-150 ${
                    isHovered
                      ? 'fill-gray-800 dark:fill-gray-200'
                      : 'fill-gray-400 dark:fill-gray-500'
                  }`}
                >
                  {formatValue(total)}
                </text>
              )}

              {/* X label: date */}
              <text
                x={cx}
                y={padding.top + innerH + 16}
                textAnchor="middle"
                className={`text-[11px] ${
                  isHovered
                    ? 'fill-gray-800 font-bold dark:fill-gray-200'
                    : 'fill-gray-500 dark:fill-gray-400'
                }`}
              >
                {bar.label}
              </text>
              {/* X sublabel: weekday */}
              {bar.sublabel && (
                <text
                  x={cx}
                  y={padding.top + innerH + 30}
                  textAnchor="middle"
                  className={`text-[10px] ${
                    bar.sublabel === 'So' || bar.sublabel === 'Nd' || bar.sublabel === 'Sa'
                      ? 'fill-red-400 font-bold dark:fill-red-500'
                      : 'fill-gray-400 dark:fill-gray-500'
                  }`}
                >
                  {bar.sublabel}
                </text>
              )}
            </g>
          );
        })}

        {/* Tooltip */}
        {hoverIdx !== null && (() => {
          const bar = bars[hoverIdx];
          const total = bar.segments.reduce((s, seg) => s + seg.value, 0);
          const activeSegs = bar.segments.filter(seg => seg.value > 0);
          const tooltipW = 150;
          const tooltipH = 24 + activeSegs.length * 18 + 4;
          const cx = padding.left + gap * hoverIdx + gap / 2;

          // Position tooltip - try right side of bar, fallback to left
          let tx = cx + barW / 2 + 12;
          if (tx + tooltipW > chartW - 4) tx = cx - barW / 2 - tooltipW - 12;
          if (tx < 4) tx = 4;
          const ty = padding.top + 8;

          return (
            <g className="pointer-events-none">
              {/* Shadow */}
              <rect
                x={tx + 2}
                y={ty + 2}
                width={tooltipW}
                height={tooltipH}
                rx={8}
                fill="black"
                opacity={0.1}
              />
              {/* Background */}
              <rect
                x={tx}
                y={ty}
                width={tooltipW}
                height={tooltipH}
                rx={8}
                className="fill-gray-900 dark:fill-gray-100"
                opacity={0.95}
              />
              {/* Header */}
              <text
                x={tx + 10}
                y={ty + 17}
                className="fill-white text-[11px] font-bold dark:fill-gray-900"
              >
                {bar.label}{bar.sublabel ? ` (${bar.sublabel})` : ''} — {formatValue(total)}h
              </text>
              {/* Segments */}
              {activeSegs.map((seg, si) => (
                <g key={si}>
                  <rect
                    x={tx + 10}
                    y={ty + 26 + si * 18}
                    width={10}
                    height={10}
                    rx={3}
                    fill={seg.color}
                  />
                  <text
                    x={tx + 24}
                    y={ty + 35 + si * 18}
                    className="fill-gray-300 text-[11px] dark:fill-gray-600"
                  >
                    {seg.name}
                  </text>
                  <text
                    x={tx + tooltipW - 10}
                    y={ty + 35 + si * 18}
                    textAnchor="end"
                    className="fill-white text-[11px] font-semibold dark:fill-gray-900"
                  >
                    {formatValue(seg.value)}h
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
