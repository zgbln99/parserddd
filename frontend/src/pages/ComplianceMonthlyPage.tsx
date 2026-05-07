import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  Calendar,
  Send,
  RefreshCcw,
  Copy,
  ClipboardCheck,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Search,
} from 'lucide-react';
import { Spinner } from '../components/Spinner';
import { useI18n } from '../i18n';
import { fetchDrivers } from '../lib/api';
import type { Driver } from '../types';

/**
 * Monthly compliance analysis.
 *
 * The driver list comes from /api/drivers (Samsara → Dropbox sync) so the
 * dispatcher only sees real, card-bearing drivers — no chance of typos
 * picking the wrong card archive. Selection drives /api/compliance/months,
 * which lists the YYYY-MM buckets that have data, and finally
 * /api/compliance/monthly which loads the DDD files and runs the engine.
 *
 * After a clean evaluation the page exposes a "Generate sign link" action
 * that posts the locale-bound report to /api/admin/sign-links and produces
 * a wa.me deep link. Dispatcher confirms the WhatsApp message and sends.
 */

interface MonthBucket {
  month: string; // YYYY-MM
  files: { path: string; name: string; date: string }[];
}

interface ViolationRow {
  rule_id: string;
  category: string;
  title: string;
  legal_basis: string;
  explanation: string;
  start_time: string;
  end_time: string;
  measured_value: number | null;
  allowed_value: number | null;
  excess_value: number | null;
  unit: string;
  driver_fine_eur: number | null;
  company_fine_eur: number | null;
  status: string;
  severity: string | null;
}

interface Section {
  category: string;
  heading: string;
  rows: ViolationRow[];
  subtotal_driver_eur: number | null;
  subtotal_company_eur: number | null;
}

interface ReportPayload {
  locale: 'de' | 'en' | 'pl';
  driver_id: string;
  evaluated_at: string;
  summary: {
    total: number;
    driver_fine_total_eur: number | null;
    company_fine_total_eur: number | null;
    by_category: Record<string, number>;
    not_evaluable_rule_ids: string[];
  };
  sections: Section[];
  not_evaluable: { rule_id: string; reason: string }[];
}

interface MonthlyResponse {
  driver_card: string;
  driver_name: string;
  month: string;
  vehicle: string | null;
  evaluation: { violations: unknown[]; not_evaluable: { rule_id: string; reason: string }[] };
  report: ReportPayload;
  categories_applied?: string[];
}

/**
 * Categories that ship enabled by default — these are violations the driver
 * has agency over: time on the road, breaks, daily/weekly rest, country
 * entries at start/end of shift.
 *
 * Other categories (CARD, MANUAL_ENTRY, ACTIVITY_SELECTION, DOWNLOAD,
 * EVENT_FAULT, MANIPULATION, PRINTOUT, MULTI_MANNING, TACHOGRAPH) are
 * available as opt-in. They tend to be either operational (e.g. download
 * cadence) or impossible to fix retroactively.
 */
const DEFAULT_DRIVER_CATEGORIES = [
  'DRIVING_TIME',
  'BREAKS',
  'REST',
  'WORKING_TIME',
  'NIGHT_WORK',
  'COUNTRY_ENTRY',
];

const ALL_CATEGORIES: { key: string; labelDe: string; labelPl: string }[] = [
  { key: 'DRIVING_TIME',       labelDe: 'Lenkzeit',           labelPl: 'Czas jazdy' },
  { key: 'BREAKS',             labelDe: 'Lenkpausen',         labelPl: 'Przerwy' },
  { key: 'REST',               labelDe: 'Ruhezeiten',         labelPl: 'Odpoczynki' },
  { key: 'WORKING_TIME',       labelDe: 'Arbeitszeit',        labelPl: 'Czas pracy' },
  { key: 'NIGHT_WORK',         labelDe: 'Nachtarbeit',        labelPl: 'Praca nocna' },
  { key: 'COUNTRY_ENTRY',      labelDe: 'Ländereingaben',     labelPl: 'Wpisy państw' },
  { key: 'CARD',               labelDe: 'Fahrerkarte',        labelPl: 'Karta kierowcy' },
  { key: 'MANUAL_ENTRY',       labelDe: 'Manuelle Nachträge', labelPl: 'Wpisy manualne' },
  { key: 'ACTIVITY_SELECTION', labelDe: 'Aktivitätswahl',     labelPl: 'Wybór aktywności' },
  { key: 'DOWNLOAD',           labelDe: 'Auslesungen',        labelPl: 'Pobrania' },
  { key: 'EVENT_FAULT',        labelDe: 'Ereignisse',         labelPl: 'Zdarzenia' },
  { key: 'MANIPULATION',       labelDe: 'Manipulation',       labelPl: 'Manipulacja' },
];

/**
 * Parse a response that we expect to be JSON, but might be HTML when:
 *   - the user is logged out and the server returned a redirect/login HTML
 *   - the SPA fallback served index.html because the API route is missing
 *   - a CDN/proxy injected an error page
 *
 * Throwing the raw `JSON.parse` exception gave us
 * "SyntaxError: Unexpected token '<'…" with no actionable hint. We now
 * return a typed error message based on the content-type instead.
 */
async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `Backend returned content-type=JSON but invalid body (status ${res.status})`,
      );
    }
  }
  if (text.trimStart().startsWith('<')) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Sitzung abgelaufen — bitte erneut anmelden (status ${res.status}).`
        : res.status === 404
        ? `API-Endpoint /${res.url.split('/').slice(3).join('/')} fehlt — Backend wurde nach Code-Änderung wahrscheinlich nicht neu gestartet (status 404).`
        : `Backend hat HTML statt JSON zurückgegeben (status ${res.status}). Vermutlich ein nicht abgefangener Server-Fehler — schaue ins Backend-Log.`,
    );
  }
  // Plain-text non-HTML response — surface it as-is.
  throw new Error(`Backend response (status ${res.status}): ${text.slice(0, 200)}`);
}

export function ComplianceMonthlyPage() {
  const { t } = useI18n();

  // Driver state — bound to /api/drivers (Samsara/Dropbox).
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);

  // Month + analysis state.
  const [months, setMonths] = useState<MonthBucket[]>([]);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [locale, setLocale] = useState<'de' | 'en' | 'pl'>('de');

  // Driver-facing categories that ship by default. The dispatcher can
  // tick on extra ones (card / manual entry / etc.) but the driver should
  // only see things they can actually do something about post-fact.
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(
    () => new Set(DEFAULT_DRIVER_CATEGORIES),
  );

  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<MonthlyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signLink, setSignLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);

  // Load the Samsara driver list once on mount.
  useEffect(() => {
    let cancelled = false;
    setDriversLoading(true);
    fetchDrivers()
      .then((res) => {
        if (cancelled) return;
        const list = res.drivers ?? [];
        setDrivers(list.filter((d) => d.card_number));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setDriversLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchMonthsFor = useCallback(async (driver: Driver) => {
    setLoadingMonths(true);
    setError(null);
    setMonths([]);
    setSelectedMonth(null);
    setResult(null);
    setSignLink(null);
    try {
      const res = await fetch(
        `/api/compliance/months?driver=${encodeURIComponent(driver.name)}`,
        { credentials: 'include' },
      );
      const body = (await parseJsonOrThrow(res)) as {
        error?: string;
        months?: MonthBucket[];
      };
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setMonths(body.months || []);
      if (body.months?.[0]) setSelectedMonth(body.months[0].month);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMonths(false);
    }
  }, []);

  const onPickDriver = useCallback(
    (driver: Driver | null) => {
      setSelectedDriver(driver);
      setMonths([]);
      setSelectedMonth(null);
      setResult(null);
      setSignLink(null);
      if (driver) void fetchMonthsFor(driver);
    },
    [fetchMonthsFor],
  );

  const analyze = useCallback(async () => {
    if (!selectedDriver || !selectedMonth) return;
    const bucket = months.find((m) => m.month === selectedMonth);
    if (!bucket) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setSignLink(null);
    try {
      const [yearStr, monthStr] = selectedMonth.split('-');
      const res = await fetch('/api/compliance/monthly', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_card: selectedDriver.card_number,
          driver_name: selectedDriver.name,
          year: Number(yearStr),
          month: Number(monthStr),
          locale,
          file_paths: bucket.files.map((f) => f.path),
          categories: Array.from(enabledCategories),
        }),
      });
      const body = (await parseJsonOrThrow(res)) as {
        error?: string;
        detail?: string;
      } & MonthlyResponse;
      if (!res.ok) {
        setError(body.detail || body.error || `HTTP ${res.status}`);
        return;
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }, [selectedDriver, selectedMonth, months, locale, enabledCategories]);

  const createSignLink = useCallback(async () => {
    if (!result) return;
    setCreatingLink(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sign-links', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_card: result.driver_card,
          driver_name: result.driver_name,
          locale,
          payload: result.report,
        }),
      });
      const body = (await parseJsonOrThrow(res)) as {
        error?: string;
        url?: string;
        expires_at?: string;
      };
      if (!res.ok || !body.url || !body.expires_at) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setSignLink({ url: body.url, expires_at: body.expires_at });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingLink(false);
    }
  }, [result, locale]);

  return (
    <div className="space-y-6">
      <Header />

      <div className="glass-card rounded-2xl p-5">
        <div className="grid items-end gap-3 md:grid-cols-[2fr,1fr,1fr,auto]">
          <Field label={t('complianceDriverLabel')}>
            <DriverPicker
              drivers={drivers}
              loading={driversLoading}
              selected={selectedDriver}
              onSelect={onPickDriver}
              placeholder={t('complianceDriverPlaceholder')}
            />
          </Field>
          <Field label={t('complianceMonthLabel')}>
            <select
              value={selectedMonth ?? ''}
              onChange={(e) => setSelectedMonth(e.target.value || null)}
              disabled={months.length === 0 || loadingMonths}
              className="h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm disabled:opacity-50 dark:border-white/10 dark:bg-white/5"
            >
              {months.length === 0 && <option value="">—</option>}
              {months.map((m) => (
                <option key={m.month} value={m.month}>
                  {m.month} ({m.files.length})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('complianceLanguageLabel')}>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'de' | 'en' | 'pl')}
              className="h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-white/5"
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="pl">Polski</option>
            </select>
          </Field>
          <button
            onClick={analyze}
            disabled={analyzing || !selectedDriver || !selectedMonth}
            className="inline-flex h-10 items-center gap-1 rounded-lg bg-[#0071e3] px-4 text-sm font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-50"
          >
            {analyzing ? <Spinner size="sm" /> : <Calendar size={14} />}
            {t('complianceAnalyze')}
          </button>
        </div>
        <CategoryFilter
          enabled={enabledCategories}
          onChange={setEnabledCategories}
          locale={locale}
        />

        {selectedDriver && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>
              {t('complianceActiveDriver')}:{' '}
              <span className="font-medium">{selectedDriver.name}</span>
            </span>
            <span>·</span>
            <span>
              {t('complianceCard')}: <code>{selectedDriver.card_number}</code>
            </span>
            {loadingMonths && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Spinner size="sm" /> {t('complianceLoadMonths')}…
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {analyzing && <AnalyzingBanner />}

      {result && (
        <>
          <SummaryCards report={result.report} />
          <SignLinkCard
            result={result}
            signLink={signLink}
            creatingLink={creatingLink}
            onCreate={createSignLink}
            locale={locale}
          />
          <ViolationsList sections={result.report.sections} />
          {result.report.not_evaluable.length > 0 && (
            <NotEvaluableCard items={result.report.not_evaluable} />
          )}
        </>
      )}
    </div>
  );
}

function Header() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0071e3] text-white">
        <ShieldCheck size={20} />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('complianceTitle')}</h1>
        <p className="text-xs text-muted">{t('complianceSubtitle')}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * Toggle which violation categories are emitted to the driver. The default
 * set leaves out card-handling, manual entries, downloads and similar
 * operational rules — operators report those as noise. Click "Reset" to
 * restore the curated default.
 */
function CategoryFilter({
  enabled,
  onChange,
  locale,
}: {
  enabled: Set<string>;
  onChange: (next: Set<string>) => void;
  locale: 'de' | 'en' | 'pl';
}) {
  const label = (cat: { labelDe: string; labelPl: string; key: string }): string => {
    if (locale === 'pl') return cat.labelPl;
    return cat.labelDe;
  };

  const toggle = (key: string) => {
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const allDefault = DEFAULT_DRIVER_CATEGORIES.every((c) => enabled.has(c)) &&
    Array.from(enabled).every((c) => DEFAULT_DRIVER_CATEGORIES.includes(c));

  return (
    <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.02] p-3 text-sm dark:border-white/10 dark:bg-white/[0.04]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          {locale === 'pl' ? 'Kategorie naruszeń' : 'Verstoß-Kategorien'}
        </span>
        <button
          type="button"
          onClick={() => onChange(new Set(DEFAULT_DRIVER_CATEGORIES))}
          disabled={allDefault}
          className="text-xs text-[#0066cc] hover:underline disabled:opacity-40 disabled:no-underline"
        >
          {locale === 'pl' ? 'Domyślne' : 'Standard'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {ALL_CATEGORIES.map((cat) => {
          const on = enabled.has(cat.key);
          const isDefault = DEFAULT_DRIVER_CATEGORIES.includes(cat.key);
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => toggle(cat.key)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition ${
                on
                  ? 'border-[#0071e3] bg-[#0071e3]/10 text-[#0071e3] dark:border-[#7eb6ff] dark:bg-[#7eb6ff]/15 dark:text-[#7eb6ff]'
                  : 'border-black/10 bg-white text-muted hover:border-black/20 dark:border-white/15 dark:bg-white/5'
              }`}
              title={isDefault ? '' : (locale === 'pl' ? 'Opcjonalne — domyślnie wyłączone' : 'Optional — standardmäßig aus')}
            >
              <span className={`size-1.5 rounded-full ${on ? 'bg-[#0071e3] dark:bg-[#7eb6ff]' : 'bg-black/20 dark:bg-white/30'}`} />
              {label(cat)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------- Driver picker ---------------------------- */

function DriverPicker({
  drivers,
  loading,
  selected,
  onSelect,
  placeholder,
}: {
  drivers: Driver[];
  loading: boolean;
  selected: Driver | null;
  onSelect: (d: Driver | null) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Sync query with selection.
  useEffect(() => {
    if (selected && !open) setQuery(selected.name);
  }, [selected, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drivers.slice(0, 50);
    return drivers
      .filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.card_number.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [drivers, query]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (e.target.value.trim() === '') onSelect(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-black/10 bg-white pl-8 pr-3 text-sm dark:border-white/10 dark:bg-white/5"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size="sm" />
          </span>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[#1f2a37]"
        >
          {filtered.map((d) => {
            const isSelected = selected?.card_number === d.card_number;
            return (
              <button
                key={d.card_number || d.name}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(d);
                  setQuery(d.name);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ${
                  isSelected ? 'bg-[#0071e3]/10' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.name || '—'}</div>
                  <div className="truncate text-xs text-muted">
                    <code>{d.card_number}</code> · {d.file_count} DDD
                  </div>
                </div>
                {d.days_since !== null && (
                  <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-black/60 dark:bg-white/10 dark:text-white/60">
                    {d.days_since}d
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {open && !loading && filtered.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-3 text-sm text-muted shadow-lg dark:border-white/10 dark:bg-[#1f2a37]">
          —
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="font-mono text-xs">{message}</div>
    </div>
  );
}

function AnalyzingBanner() {
  const { t } = useI18n();
  return (
    <div className="glass-card flex items-center gap-3 rounded-2xl p-5">
      <Spinner size="md" />
      <div>
        <div className="font-medium">{t('complianceLoading')}</div>
        <div className="text-xs text-muted">{t('complianceLoadingHint')}</div>
      </div>
    </div>
  );
}

function SummaryCards({ report }: { report: ReportPayload }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <SummaryCard
        icon={<FileText size={16} />}
        label={t('complianceTotal')}
        value={String(report.summary.total)}
        tone={report.summary.total === 0 ? 'good' : 'warn'}
      />
      <SummaryCard
        icon={<AlertTriangle size={16} />}
        label={t('complianceFineDriver')}
        value={fmtEuro(report.summary.driver_fine_total_eur)}
        tone="neutral"
      />
      <SummaryCard
        icon={<AlertTriangle size={16} />}
        label={t('complianceFineCompany')}
        value={fmtEuro(report.summary.company_fine_total_eur)}
        tone="neutral"
      />
      <SummaryCard
        icon={<RefreshCcw size={16} />}
        label={t('complianceNotEvaluableShort')}
        value={String(report.summary.not_evaluable_rule_ids.length)}
        tone={report.summary.not_evaluable_rule_ids.length > 0 ? 'warn' : 'good'}
      />
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const ring =
    tone === 'good'
      ? 'ring-1 ring-green-200/60 dark:ring-green-700/30'
      : tone === 'warn'
      ? 'ring-1 ring-amber-300/50 dark:ring-amber-700/30'
      : '';
  return (
    <div className={`glass-card flex items-center gap-3 rounded-2xl p-4 ${ring}`}>
      <span className="grid size-9 place-items-center rounded-xl bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70">
        {icon}
      </span>
      <div>
        <div className="text-xs text-muted">{label}</div>
        <div className="text-lg font-semibold tracking-tight">{value}</div>
      </div>
    </div>
  );
}

function SignLinkCard({
  result,
  signLink,
  creatingLink,
  onCreate,
  locale,
}: {
  result: MonthlyResponse;
  signLink: { url: string; expires_at: string } | null;
  creatingLink: boolean;
  onCreate: () => void;
  locale: 'de' | 'en' | 'pl';
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const waLink = useMemo(() => {
    if (!signLink) return null;
    const template = t('complianceWaMessage');
    const text = template
      .replace('{name}', result.driver_name || result.driver_card)
      .replace('{month}', result.month)
      .replace('{url}', signLink.url)
      .replace('{expires}', new Date(signLink.expires_at).toLocaleDateString(localeTag(locale)));
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [signLink, result, locale, t]);

  const onCopy = async () => {
    if (!signLink) return;
    try {
      await navigator.clipboard.writeText(signLink.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  if (result.report.summary.total === 0) {
    return (
      <div className="glass-card flex items-start gap-3 rounded-2xl bg-green-50/50 p-5 dark:bg-green-900/10">
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-green-600" />
        <div>
          <div className="font-medium">
            {t('complianceNoViolationsForMonth')} {result.month}.
          </div>
          <p className="mt-1 text-sm text-muted">{t('complianceNoViolationsHint')}</p>
          <button
            onClick={onCreate}
            disabled={creatingLink}
            className="mt-3 inline-flex h-9 items-center gap-1 rounded-lg border border-black/10 px-3 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
          >
            {creatingLink ? <Spinner size="sm" /> : <Send size={14} />}
            {t('complianceCreateConfirmLink')}
          </button>
        </div>
      </div>
    );
  }

  if (!signLink) {
    return (
      <div className="glass-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
        <div>
          <div className="font-medium">{t('complianceReadyTitle')}</div>
          <div className="text-xs text-muted">{t('complianceReadyHint')}</div>
        </div>
        <button
          onClick={onCreate}
          disabled={creatingLink}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0071e3] px-5 text-sm font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-50"
        >
          {creatingLink ? <Spinner size="sm" /> : <Send size={14} />}
          {t('complianceCreateSignLink')}
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
        <CheckCircle2 size={16} />
        {t('complianceLinkCreated')} {new Date(signLink.expires_at).toLocaleString(localeTag(locale))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
          {signLink.url}
        </code>
        <button
          onClick={onCopy}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-black/10 px-3 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          {copied ? <ClipboardCheck size={14} className="text-green-600" /> : <Copy size={14} />}
          {copied ? t('complianceCopied') : t('complianceCopyLink')}
        </button>
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#25D366] px-3 text-sm font-medium text-white transition hover:bg-[#1ebe5a]"
          >
            <ExternalLink size={14} />
            {t('complianceWhatsApp')}
          </a>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{t('complianceWhatsAppHint')}</p>
    </div>
  );
}

function ViolationsList({ sections }: { sections: Section[] }) {
  const { t } = useI18n();
  if (sections.length === 0) return null;
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.category} className="glass-card rounded-2xl p-5">
          <h3 className="text-base font-semibold tracking-tight">{section.heading}</h3>
          <ul className="mt-3 grid gap-3">
            {section.rows.map((row, i) => (
              <li
                key={`${row.rule_id}-${i}`}
                className="rounded-xl bg-black/[0.02] p-4 dark:bg-white/[0.04]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{row.title}</div>
                    <div className="mt-1 text-xs text-muted">{row.legal_basis}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs uppercase tracking-wide text-muted">
                      {fmtUnit(row.unit, t)}
                    </div>
                    <div className="text-base font-semibold">
                      {fmt(row.measured_value)}{' '}
                      <span className="text-muted">/ {fmt(row.allowed_value)}</span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted">{row.explanation}</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  <span>
                    {fmtIso(row.start_time)} → {fmtIso(row.end_time)}
                  </span>
                  <span>
                    {t('complianceFinesDriverShort')} {fmtEuro(row.driver_fine_eur)}
                  </span>
                  <span>
                    {t('complianceFinesCompanyShort')} {fmtEuro(row.company_fine_eur)}
                  </span>
                  {row.severity && (
                    <span>
                      {t('complianceSeverity')} {row.severity}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NotEvaluableCard({ items }: { items: { rule_id: string; reason: string }[] }) {
  const { t } = useI18n();
  return (
    <div className="glass-card rounded-2xl p-5">
      <h3 className="text-base font-semibold tracking-tight">
        {t('complianceNotEvaluableTitle')}
      </h3>
      <p className="mt-1 text-xs text-muted">{t('complianceNotEvaluableHint')}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((it) => (
          <li
            key={it.rule_id}
            className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-amber-50/40 px-3 py-2 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
          >
            <code className="text-xs">{it.rule_id}</code>
            <span className="text-xs text-amber-800/80 dark:text-amber-200/70">{it.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ formatting ----------------------------- */

function fmt(value: number | null): string {
  if (value === null) return '—';
  return String(value);
}

function fmtEuro(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(2)} €`;
}

function fmtUnit(unit: string, t: (key: never) => string): string {
  if (unit === 'minutes') return t('complianceUnitMinutes' as never);
  if (unit === 'hours') return t('complianceUnitHours' as never);
  if (unit === 'days') return t('complianceUnitDays' as never);
  if (unit === 'count') return t('complianceUnitCount' as never);
  return unit;
}

function fmtIso(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

function localeTag(locale: 'de' | 'en' | 'pl'): string {
  if (locale === 'pl') return 'pl-PL';
  if (locale === 'en') return 'en-GB';
  return 'de-DE';
}
