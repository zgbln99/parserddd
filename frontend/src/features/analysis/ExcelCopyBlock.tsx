import { useState, useCallback } from 'react';
import { ClipboardCopy, Check } from 'lucide-react';
import type { MonthlyDays } from '../../lib/api';

interface ExcelCopyBlockProps {
  summary: Record<string, unknown>;
  monthlyDays?: MonthlyDays | null;
}

export function ExcelCopyBlock({ summary, monthlyDays }: ExcelCopyBlockProps) {
  const s = summary;
  const [copied, setCopied] = useState(false);

  const n25 = ((s.night_25_minutes as number) / 60).toFixed(2).replace('.', ',');
  const n40 = ((s.night_40_minutes as number) / 60).toFixed(2).replace('.', ',');
  const vma = String(s.diet_count ?? 0);
  const azMin = s.total_work_minutes as number;
  const az = `${Math.floor(azMin / 60)}:${String(azMin % 60).padStart(2, '0')}`;

  const urVal = monthlyDays?.vacation_days ? String(monthlyDays.vacation_days) : '';
  const krVal = monthlyDays?.sick_days ? String(monthlyDays.sick_days) : '';
  const ueVal = monthlyDays?.overtime_hm || '';

  const headers = ['25%', '40%', 'Ü', 'Ur', 'Kr', 'VMA', 'AZ'];
  const values  = [n25,   n40,   ueVal, urVal, krVal, vma, az];

  const handleCopy = useCallback(() => {
    const tsv = values.join('\t');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [n25, n40, vma, az, ueVal, urVal, krVal]);

  const cols = headers.map((h, i) => ({ header: h, value: values[i] }));

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <table className="border-collapse sm:min-w-[600px] text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.header} className="border border-white/30 bg-black/[0.04] px-2 py-1 text-center font-bold text-muted dark:text-muted-dark dark:border-white/10 dark:bg-white/10 dark:text-gray-400">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cols.map((c) => (
              <td key={c.header} className="border border-white/30 bg-white/50 px-2 py-1 text-center font-mono dark:border-white/10 dark:bg-white/5">
                {c.value || <span className="text-gray-300 dark:text-gray-600">&mdash;</span>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 rounded-lg bg-black/[0.06] px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15"
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
        {copied ? 'OK!' : 'Kopiuj'}
      </button>
    </div>
  );
}
