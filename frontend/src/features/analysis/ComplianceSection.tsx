import { useCallback, useState } from 'react';
import {
  evaluateParserAnalysis,
  type ComplianceResponse,
  type ComplianceSeverity,
  type ComplianceViolation,
} from '../../lib/api';
import type { AnalysisResult } from '../../types';

/**
 * Optional, **manually triggered** compliance check.
 *
 * The section is purely additive — it does not change the existing
 * analysis result, never re-runs the parser, and never recomputes hours.
 * The button posts the current ``AnalysisResult`` (which the backend
 * adapter knows how to read) to ``/api/compliance/evaluate-parser-analysis``
 * and renders the returned violations in a separate block below the
 * existing analysis output.
 */
interface ComplianceSectionProps {
  data: AnalysisResult | null | undefined;
  countryProfile?: string;
}

const severityClass: Record<ComplianceSeverity, string> = {
  INFO: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  LOW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  MEDIUM: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  CRITICAL: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

function severityLabel(s: ComplianceSeverity): string {
  switch (s) {
    case 'INFO': return 'Info';
    case 'LOW': return 'Niski';
    case 'MEDIUM': return 'Średni';
    case 'HIGH': return 'Wysoki';
    case 'CRITICAL': return 'Krytyczny';
  }
}

function formatDt(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  } catch {
    return iso;
  }
}

function rowTitle(v: ComplianceViolation): string {
  return v.titlePl || v.title || v.titleDe || v.ruleCode;
}

export function ComplianceSection({
  data,
  countryProfile = 'DE',
}: ComplianceSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComplianceResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const hasData = !!(data && data.shift_details && data.shift_details.length > 0);

  const handleCheck = useCallback(async () => {
    if (!data) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await evaluateParserAnalysis(data, countryProfile);
      setResult(res);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Nie udało się sprawdzić wykroczeń'
      );
    } finally {
      setLoading(false);
    }
  }, [data, countryProfile]);

  const violations = result?.violations ?? [];

  return (
    <div
      data-testid="compliance-section"
      className="mt-6 rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-semibold">Wykroczenia / Verstöße</div>
          <div className="text-xs text-muted">
            Dodatkowa, ręczna kontrola czasu pracy kierowcy. Nie zmienia
            wyniku obliczania godzin powyżej.
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheck}
          disabled={!hasData || loading}
          data-testid="compliance-check-button"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Analizuję wykroczenia…' : 'Sprawdź wykroczenia'}
        </button>
      </div>

      {!hasData && (
        <div className="mt-3 text-xs text-muted" data-testid="compliance-no-data">
          Brak danych analizy do sprawdzenia.
        </div>
      )}

      {error && (
        <div
          data-testid="compliance-error"
          className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
        >
          {error || 'Nie udało się sprawdzić wykroczeń'}
        </div>
      )}

      {result && !error && violations.length === 0 && (
        <div
          data-testid="compliance-empty"
          className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-200"
        >
          Nie wykryto wykroczeń.
        </div>
      )}

      {violations.length > 0 && (
        <div className="mt-4 overflow-x-auto" data-testid="compliance-list">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-black/[0.04] dark:bg-white/10">
                <th className="border border-border px-2 py-1 text-left">Poziom</th>
                <th className="border border-border px-2 py-1 text-left">Reguła</th>
                <th className="border border-border px-2 py-1 text-left">Opis</th>
                <th className="border border-border px-2 py-1 text-left">Od</th>
                <th className="border border-border px-2 py-1 text-left">Do</th>
                <th className="border border-border px-2 py-1 text-right">Wartość</th>
                <th className="border border-border px-2 py-1 text-right">Limit</th>
                <th className="border border-border px-2 py-1 text-right">Przekroczenie</th>
                <th className="border border-border px-2 py-1 text-left">Podstawa prawna</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v) => (
                <tr key={v.id || `${v.ruleCode}-${v.start}-${v.end}`}>
                  <td className="border border-border px-2 py-1">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityClass[v.severity]}`}
                    >
                      {severityLabel(v.severity)}
                    </span>
                  </td>
                  <td className="border border-border px-2 py-1 font-mono text-[11px]">
                    {v.ruleCode}
                  </td>
                  <td className="border border-border px-2 py-1">
                    <div className="font-medium">{rowTitle(v)}</div>
                    {v.description && (
                      <div className="text-[11px] text-muted">{v.description}</div>
                    )}
                    {v.recommendedAction && (
                      <div className="mt-1 text-[11px] italic text-muted">
                        {v.recommendedAction}
                      </div>
                    )}
                  </td>
                  <td className="border border-border px-2 py-1 whitespace-nowrap">
                    {formatDt(v.start)}
                  </td>
                  <td className="border border-border px-2 py-1 whitespace-nowrap">
                    {formatDt(v.end)}
                  </td>
                  <td className="border border-border px-2 py-1 text-right tabular-nums">
                    {v.actualMinutes ?? ''}
                  </td>
                  <td className="border border-border px-2 py-1 text-right tabular-nums">
                    {v.limitMinutes ?? ''}
                  </td>
                  <td className="border border-border px-2 py-1 text-right tabular-nums">
                    {v.excessMinutes ?? ''}
                  </td>
                  <td className="border border-border px-2 py-1 text-[11px]">
                    {v.legalBasis}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs text-muted underline-offset-2 hover:underline"
            data-testid="compliance-raw-toggle"
          >
            {showRaw ? 'Ukryj szczegóły techniczne' : 'Pokaż szczegóły techniczne'}
          </button>
          {showRaw && (
            <pre
              data-testid="compliance-raw"
              className="mt-2 max-h-96 overflow-auto rounded bg-black/[0.04] p-2 text-[10px] dark:bg-white/5"
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
