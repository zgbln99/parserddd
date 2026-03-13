import { useMemo, useState } from 'react';

export interface BarChartBar {
  label: string;
  sublabel?: string;
  segments: { value: number; color: string; name: string }[];
}

interface BarChartProps {
  bars: BarChartBar[];
  height?: number;
  formatValue?: (v: number) => string;
}

export function BarChart({ bars, formatValue = (v) => v.toFixed(1) }: BarChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    let m = 0;
    for (const b of bars) {
      const total = b.segments.reduce((s, seg) => s + seg.value, 0);
      if (total > m) m = total;
    }
    // Round up to nice number
    const raw = m || 1;
    if (raw <= 8) return Math.ceil(raw);
    if (raw <= 16) return Math.ceil(raw / 2) * 2;
    return Math.ceil(raw / 4) * 4;
  }, [bars]);

  const gridLines = useMemo(() => {
    const count = maxVal <= 8 ? maxVal : maxVal <= 16 ? maxVal / 2 : 4;
    const step = maxVal / count;
    const lines: number[] = [];
    for (let v = step; v <= maxVal; v += step) lines.push(Math.round(v * 10) / 10);
    return lines;
  }, [maxVal]);

  const rowH = 32;
  const isWeekend = (sublabel?: string) =>
    sublabel === 'So' || sublabel === 'Sa' || sublabel === 'Nd';

  return (
    <div className="space-y-0">
      {/* Grid header with hour markers */}
      <div className="flex items-end pb-1 pl-[88px]">
        <div className="relative h-4 flex-1">
          {gridLines.map((v) => (
            <span
              key={v}
              className="absolute -translate-x-1/2 text-[10px] text-gray-400 dark:text-gray-500"
              style={{ left: `${(v / maxVal) * 100}%` }}
            >
              {v}h
            </span>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-px">
        {bars.map((bar, i) => {
          const total = bar.segments.reduce((s, seg) => s + seg.value, 0);
          const isHovered = hoverIdx === i;
          const weekend = isWeekend(bar.sublabel);

          return (
            <div
              key={i}
              className={`group relative flex items-center rounded-lg transition-colors duration-100 ${
                isHovered ? 'bg-gray-100 dark:bg-gray-800' : ''
              } ${weekend ? 'bg-red-50/40 dark:bg-red-900/5' : ''}`}
              style={{ height: rowH }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Day label */}
              <div className="flex w-[88px] shrink-0 items-center gap-1.5 pl-2">
                <span
                  className={`w-[26px] text-right text-sm font-bold tabular-nums ${
                    weekend ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {bar.label}
                </span>
                <span
                  className={`w-[22px] text-[11px] font-medium ${
                    weekend ? 'text-red-400 dark:text-red-500' : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {bar.sublabel}
                </span>
              </div>

              {/* Bar area */}
              <div className="relative mr-2 flex h-5 flex-1 items-center">
                {/* Grid lines */}
                {gridLines.map((v) => (
                  <div
                    key={v}
                    className="absolute top-0 h-full w-px bg-gray-200 dark:bg-gray-700"
                    style={{ left: `${(v / maxVal) * 100}%` }}
                  />
                ))}

                {/* Stacked horizontal segments */}
                <div
                  className="relative flex h-full overflow-hidden rounded-md transition-all duration-150"
                  style={{
                    width: `${Math.max((total / maxVal) * 100, 0.5)}%`,
                    opacity: hoverIdx !== null && !isHovered ? 0.45 : 1,
                  }}
                >
                  {bar.segments.map((seg, si) => {
                    if (seg.value === 0) return null;
                    const pct = (seg.value / total) * 100;
                    return (
                      <div
                        key={si}
                        className="h-full transition-all duration-150"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: seg.color,
                          filter: isHovered ? 'brightness(1.1)' : undefined,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Total value */}
                {total > 0 && (
                  <span
                    className={`ml-2 shrink-0 text-xs tabular-nums transition-colors duration-100 ${
                      isHovered
                        ? 'font-bold text-gray-800 dark:text-gray-200'
                        : 'font-medium text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {formatValue(total)}h
                  </span>
                )}
              </div>

              {/* Hover tooltip */}
              {isHovered && total > 0 && (
                <div className="pointer-events-none absolute left-[96px] top-full z-20 mt-1 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                  <div className="mb-1.5 text-xs font-bold text-gray-700 dark:text-gray-300">
                    {bar.label} {bar.sublabel} — {formatValue(total)}h
                  </div>
                  <div className="space-y-1">
                    {bar.segments.filter(seg => seg.value > 0).map((seg, si) => (
                      <div key={si} className="flex items-center gap-2 text-[11px]">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: seg.color }}
                        />
                        <span className="text-gray-500 dark:text-gray-400">{seg.name}</span>
                        <span className="ml-auto font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                          {formatValue(seg.value)}h
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
