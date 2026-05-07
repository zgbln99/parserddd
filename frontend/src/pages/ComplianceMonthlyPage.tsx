import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { Spinner } from '../components/Spinner';

/**
 * Monthly compliance analysis.
 *
 * Workflow:
 *   1. Dispatcher picks a driver (typed or selected from dropdown).
 *   2. App fetches /api/compliance/months — picks the YYYY-MM bucket.
 *   3. Dispatcher clicks "Analysieren" → POST /api/compliance/monthly
 *      which loads the corresponding DDD files from Dropbox, runs the
 *      compliance engine and returns evaluation + locale-bound report.
 *   4. Dispatcher reviews violations and presses "Link erstellen" — the
 *      app posts the report payload to /api/admin/sign-links and gets
 *      back a one-time signing URL ready to paste into WhatsApp.
 *
 * Two pure-UI invariants here:
 *   - We always render a violation count (even when zero), so a clean
 *     month is visibly clean rather than ambiguous.
 *   - The "Send to WhatsApp" button is a real `wa.me` deep link with the
 *     URL pre-filled, so the dispatcher just confirms and sends.
 */

interface DriverInfo {
  card_number: string;
  driver_name: string;
}

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
}

export function ComplianceMonthlyPage() {
  const [driverInput, setDriverInput] = useState('');
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [months, setMonths] = useState<MonthBucket[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [locale, setLocale] = useState<'de' | 'en' | 'pl'>('de');

  const [loadingMonths, setLoadingMonths] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<MonthlyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signLink, setSignLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);

  const fetchMonths = useCallback(async () => {
    if (!driverInput.trim()) return;
    setLoadingMonths(true);
    setError(null);
    setMonths([]);
    setSelectedMonth(null);
    setResult(null);
    setSignLink(null);
    try {
      const res = await fetch(
        `/api/compliance/months?driver=${encodeURIComponent(driverInput.trim())}`,
        { credentials: 'include' },
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setDriver({ card_number: body.card_number, driver_name: body.driver_name });
      setMonths(body.months || []);
      if (body.months?.[0]) setSelectedMonth(body.months[0].month);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMonths(false);
    }
  }, [driverInput]);

  const analyze = useCallback(async () => {
    if (!driver || !selectedMonth) return;
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
          driver_card: driver.card_number,
          driver_name: driver.driver_name,
          year: Number(yearStr),
          month: Number(monthStr),
          locale,
          file_paths: bucket.files.map((f) => f.path),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail || body.error || `HTTP ${res.status}`);
        return;
      }
      setResult(body);
    } catch (err) {
      setError(String(err));
    } finally {
      setAnalyzing(false);
    }
  }, [driver, selectedMonth, months, locale]);

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
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setSignLink({ url: body.url, expires_at: body.expires_at });
    } catch (err) {
      setError(String(err));
    } finally {
      setCreatingLink(false);
    }
  }, [result, locale]);

  return (
    <div className="space-y-6">
      <Header />

      <div className="glass-card rounded-2xl p-5">
        <div className="grid items-end gap-3 md:grid-cols-[2fr,1fr,1fr,auto]">
          <Field label="Fahrer (Name oder Karten-Nr.)">
            <input
              value={driverInput}
              onChange={(e) => setDriverInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchMonths();
              }}
              placeholder="Mustermann, Hans"
              className="h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-white/5"
            />
          </Field>
          <Field label="Monat">
            <select
              value={selectedMonth ?? ''}
              onChange={(e) => setSelectedMonth(e.target.value || null)}
              disabled={months.length === 0}
              className="h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm disabled:opacity-50 dark:border-white/10 dark:bg-white/5"
            >
              {months.length === 0 && <option value="">—</option>}
              {months.map((m) => (
                <option key={m.month} value={m.month}>
                  {m.month} ({m.files.length} Datei{m.files.length === 1 ? '' : 'en'})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sprache">
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
          <div className="flex gap-2">
            <button
              onClick={fetchMonths}
              disabled={loadingMonths || !driverInput.trim()}
              className="inline-flex h-10 items-center gap-1 rounded-lg border border-black/10 px-3 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
            >
              {loadingMonths ? <Spinner size="sm" /> : <RefreshCcw size={14} />}
              Monate laden
            </button>
            <button
              onClick={analyze}
              disabled={analyzing || !driver || !selectedMonth}
              className="inline-flex h-10 items-center gap-1 rounded-lg bg-[#0071e3] px-4 text-sm font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-50"
            >
              {analyzing ? <Spinner size="sm" /> : <Calendar size={14} />}
              Analysieren
            </button>
          </div>
        </div>
        {driver && (
          <div className="mt-4 text-xs text-muted">
            Aktiver Fahrer: <span className="font-medium">{driver.driver_name || '—'}</span> ·
            Karte: <code>{driver.card_number}</code>
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
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0071e3] text-white">
        <ShieldCheck size={20} />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance — Monatsanalyse</h1>
        <p className="text-xs text-muted">
          Pro Fahrer + Monat. Generiert WhatsApp-Link zur Unterschrift.
        </p>
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="font-mono text-xs">{message}</div>
    </div>
  );
}

function AnalyzingBanner() {
  return (
    <div className="glass-card flex items-center gap-3 rounded-2xl p-5">
      <Spinner size="md" />
      <div>
        <div className="font-medium">Lade DDD-Dateien aus Dropbox …</div>
        <div className="text-xs text-muted">
          Compliance-Engine läuft, kann je nach Datenmenge 5–30 Sekunden dauern.
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ report }: { report: ReportPayload }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <SummaryCard
        icon={<FileText size={16} />}
        label="Verstöße gesamt"
        value={String(report.summary.total)}
        tone={report.summary.total === 0 ? 'good' : 'warn'}
      />
      <SummaryCard
        icon={<AlertTriangle size={16} />}
        label="Bußgeld Fahrer"
        value={fmtEuro(report.summary.driver_fine_total_eur)}
        tone="neutral"
      />
      <SummaryCard
        icon={<AlertTriangle size={16} />}
        label="Bußgeld Unternehmen"
        value={fmtEuro(report.summary.company_fine_total_eur)}
        tone="neutral"
      />
      <SummaryCard
        icon={<RefreshCcw size={16} />}
        label="Nicht auswertbar"
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
}: {
  result: MonthlyResponse;
  signLink: { url: string; expires_at: string } | null;
  creatingLink: boolean;
  onCreate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const waLink = useMemo(() => {
    if (!signLink) return null;
    const text = `Hallo ${result.driver_name || result.driver_card},\n\nbitte unterzeichne dein Verstoßprotokoll für ${result.month}:\n${signLink.url}\n\nGültig bis ${new Date(signLink.expires_at).toLocaleDateString()}.`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [signLink, result]);

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
          <div className="font-medium">Keine Verstöße im {result.month}.</div>
          <p className="mt-1 text-sm text-muted">
            Ein Signatur-Link ist nicht erforderlich. Du kannst trotzdem einen
            erzeugen, wenn die Bestätigung schriftlich gewünscht ist.
          </p>
          <button
            onClick={onCreate}
            disabled={creatingLink}
            className="mt-3 inline-flex h-9 items-center gap-1 rounded-lg border border-black/10 px-3 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
          >
            {creatingLink ? <Spinner size="sm" /> : <Send size={14} />}
            Bestätigungslink erstellen
          </button>
        </div>
      </div>
    );
  }

  if (!signLink) {
    return (
      <div className="glass-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
        <div>
          <div className="font-medium">Verstöße zur Unterschrift bereit</div>
          <div className="text-xs text-muted">
            Erzeugt einen einmaligen Link mit 14 Tagen Gültigkeit, den du
            per WhatsApp an den Fahrer schickst.
          </div>
        </div>
        <button
          onClick={onCreate}
          disabled={creatingLink}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0071e3] px-5 text-sm font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-50"
        >
          {creatingLink ? <Spinner size="sm" /> : <Send size={14} />}
          Signatur-Link erstellen
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
        <CheckCircle2 size={16} />
        Link erstellt — gültig bis {new Date(signLink.expires_at).toLocaleString()}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
          {signLink.url}
        </code>
        <button
          onClick={onCopy}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-black/10 px-3 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          {copied ? <ClipboardCheck size={14} className="text-green-600" /> : <Copy size={14} />}
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#25D366] px-3 text-sm font-medium text-white transition hover:bg-[#1ebe5a]"
          >
            <ExternalLink size={14} />
            WhatsApp
          </a>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Der WhatsApp-Button öffnet einen vorbereiteten Text mit dem Link —
        wähle den Kontakt und sende ab.
      </p>
    </div>
  );
}

function ViolationsList({ sections }: { sections: Section[] }) {
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
                      {fmtUnit(row.unit)}
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
                  <span>Fahrer: {fmtEuro(row.driver_fine_eur)}</span>
                  <span>Unternehmen: {fmtEuro(row.company_fine_eur)}</span>
                  {row.severity && <span>Schwere: {row.severity}</span>}
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
  return (
    <div className="glass-card rounded-2xl p-5">
      <h3 className="text-base font-semibold tracking-tight">Nicht auswertbar</h3>
      <p className="mt-1 text-xs text-muted">
        Diese Regeln benötigen zusätzliche Daten (z.B. Auslese-Verlauf,
        Werkstatt-Nachweise) und werden NICHT als compliant gewertet.
      </p>
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

function fmtUnit(unit: string): string {
  if (unit === 'minutes') return 'Minuten';
  if (unit === 'hours') return 'Stunden';
  if (unit === 'days') return 'Tage';
  if (unit === 'count') return 'Anzahl';
  return unit;
}

function fmtIso(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
