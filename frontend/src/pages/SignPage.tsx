import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Lock,
  Eraser,
  Building2,
  ChevronUp,
} from 'lucide-react';
import { Spinner } from '../components/Spinner';

/**
 * Public driver-signing page — mobile-first, banking-grade light UI.
 *
 * Layout principle: NO long scroll. The page collapses violations into
 * compact one-line rows the driver can tap to expand, and the signature
 * card is the natural focal point. On mobile the signature card is below
 * the violation list (one screen of scroll), on desktop it sits in a
 * sticky right column.
 *
 * Numeric formatting: any "minutes" unit is rendered as hours (e.g.
 * 300 min → 5h, 90 min → 1h 30min), per driver request.
 */

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

interface PdfSection {
  category: string;
  heading: string;
  rows: ViolationRow[];
  subtotal_driver_eur: number | null;
  subtotal_company_eur: number | null;
}

interface PdfPayload {
  locale: 'de' | 'en' | 'pl';
  driver_id: string;
  evaluated_at: string;
  sections: PdfSection[];
  summary: {
    total: number;
    driver_fine_total_eur: number | null;
    company_fine_total_eur: number | null;
  };
  not_evaluable?: { rule_id: string; reason: string }[];
}

interface SignTokenInfo {
  token: string;
  driver_card: string;
  driver_name: string;
  locale: 'de' | 'en' | 'pl';
  expires_at: string;
  payload: PdfPayload;
  payload_hash: string;
}

type UiLang = 'de' | 'en' | 'pl';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'expired'; message: string }
  | { kind: 'ready'; data: SignTokenInfo }
  | { kind: 'submitting'; data: SignTokenInfo }
  | {
      kind: 'done';
      data: SignTokenInfo;
      dropbox_path: string | null;
      upload_error: string | null;
      signed_at: string;
    };

const STR = {
  de: {
    brandTagline: 'Fahrer-Portal',
    intro: 'Bitte zur Kenntnis nehmen und unten unterschreiben.',
    summaryTotal: 'Verstöße',
    summaryPeriod: 'Zeitraum',
    summaryDriver: 'Fahrer',
    summaryCard: 'Karte',
    listTitle: 'Verstöße',
    listEmpty: 'Keine Verstöße — bitte trotzdem zur Kenntnis bestätigen.',
    measured: 'Gemessen',
    allowed: 'Erlaubt',
    excess: 'Über',
    confirmTitle: 'Unterschrift',
    confirmDescription:
      'Mit deiner Unterschrift bestätigst du die Kenntnisnahme. Anmerkung optional.',
    nameLabel: 'Vor- und Nachname',
    namePlaceholder: 'Hans Mustermann',
    remarkLabel: 'Anmerkung (optional)',
    remarkPlaceholder: 'z. B. mit der Disposition geklärt.',
    signatureLabel: 'Unterschrift',
    signatureHint: 'Mit Finger oder Maus unterschreiben.',
    clear: 'Zurücksetzen',
    submit: 'Bestätigen',
    submitting: 'Sende…',
    errorEmptyName: 'Bitte deinen Namen eingeben.',
    errorEmptySignature: 'Bitte unten unterschreiben.',
    errorPrefix: 'Fehler',
    invalidTitle: 'Link ungültig',
    expiredTitle: 'Link abgelaufen',
    expiredHint: 'Bitte wende dich an die Disposition.',
    successTitle: 'Vielen Dank.',
    successDescription:
      'Deine Unterschrift wurde gespeichert. Die Disposition hat eine Kopie erhalten.',
    successUploadFailed:
      'Cloud-Upload schlug fehl — die Disposition wird ihn nachholen.',
    successSignedAt: 'Signatur',
    securityCue: 'Verschlüsselt · Einmal-Link',
    legalNote:
      'Datenschutz: deine Unterschrift wird ausschließlich intern dokumentiert.',
    days: (n: number) => (n === 1 ? '1 Tag' : `${n} Tage`),
    valid: 'gültig',
    details: 'Details',
    hide: 'Ausblenden',
    hours: 'Std',
    hoursAndMin: 'h',
  },
  en: {
    brandTagline: 'Driver Portal',
    intro: 'Please review and sign below.',
    summaryTotal: 'Violations',
    summaryPeriod: 'Period',
    summaryDriver: 'Driver',
    summaryCard: 'Card',
    listTitle: 'Violations',
    listEmpty: 'No violations — please still acknowledge.',
    measured: 'Measured',
    allowed: 'Allowed',
    excess: 'Over',
    confirmTitle: 'Signature',
    confirmDescription:
      'By signing you acknowledge the contents. Remark optional.',
    nameLabel: 'Full name',
    namePlaceholder: 'John Smith',
    remarkLabel: 'Remark (optional)',
    remarkPlaceholder: 'e.g. cleared with dispatch.',
    signatureLabel: 'Signature',
    signatureHint: 'Sign with finger or mouse.',
    clear: 'Clear',
    submit: 'Confirm',
    submitting: 'Sending…',
    errorEmptyName: 'Please enter your name.',
    errorEmptySignature: 'Please sign below.',
    errorPrefix: 'Error',
    invalidTitle: 'Link invalid',
    expiredTitle: 'Link expired',
    expiredHint: 'Please contact dispatch.',
    successTitle: 'Thank you.',
    successDescription:
      'Your signature has been saved. Dispatch has a copy.',
    successUploadFailed: 'Cloud upload failed — dispatch will retry.',
    successSignedAt: 'Signed',
    securityCue: 'Encrypted · Single-use',
    legalNote:
      'Privacy: your signature is used exclusively for internal records.',
    days: (n: number) => (n === 1 ? '1 day' : `${n} days`),
    valid: 'valid',
    details: 'Details',
    hide: 'Hide',
    hours: 'h',
    hoursAndMin: 'h',
  },
  pl: {
    brandTagline: 'Portal kierowcy',
    intro: 'Prosimy o zapoznanie się i podpis poniżej.',
    summaryTotal: 'Naruszenia',
    summaryPeriod: 'Okres',
    summaryDriver: 'Kierowca',
    summaryCard: 'Karta',
    listTitle: 'Naruszenia',
    listEmpty: 'Brak naruszeń — prosimy mimo to potwierdzić zapoznanie.',
    measured: 'Zmierzone',
    allowed: 'Dozwolone',
    excess: 'Powyżej',
    confirmTitle: 'Podpis',
    confirmDescription:
      'Podpisem potwierdzasz zapoznanie się. Uwagi opcjonalne.',
    nameLabel: 'Imię i nazwisko',
    namePlaceholder: 'Jan Kowalski',
    remarkLabel: 'Uwagi (opcjonalnie)',
    remarkPlaceholder: 'np. ustalone z dyspozycją.',
    signatureLabel: 'Podpis',
    signatureHint: 'Podpisz palcem lub myszą.',
    clear: 'Wyczyść',
    submit: 'Potwierdź',
    submitting: 'Wysyłam…',
    errorEmptyName: 'Wpisz imię i nazwisko.',
    errorEmptySignature: 'Złóż podpis poniżej.',
    errorPrefix: 'Błąd',
    invalidTitle: 'Link nieprawidłowy',
    expiredTitle: 'Link wygasł',
    expiredHint: 'Skontaktuj się z dyspozycją.',
    successTitle: 'Dziękujemy.',
    successDescription:
      'Twój podpis został zapisany. Dyspozycja otrzymała kopię.',
    successUploadFailed: 'Wysyłka do chmury nie powiodła się.',
    successSignedAt: 'Podpis',
    securityCue: 'Szyfrowane · Link jednorazowy',
    legalNote: 'Ochrona danych: podpis służy wyłącznie wewnętrznej dokumentacji.',
    days: (n: number) => (n === 1 ? '1 dzień' : `${n} dni`),
    valid: 'ważny',
    details: 'Szczegóły',
    hide: 'Ukryj',
    hours: 'godz',
    hoursAndMin: 'godz',
  },
} as const;

function pickLang(initial: UiLang): UiLang {
  const stored =
    typeof window !== 'undefined'
      ? (window.localStorage.getItem('sign-lang') as UiLang | null)
      : null;
  if (stored && (stored === 'de' || stored === 'en' || stored === 'pl'))
    return stored;
  if (typeof navigator !== 'undefined') {
    const code = (navigator.language || '').slice(0, 2).toLowerCase();
    if (code === 'pl') return 'pl';
    if (code === 'en') return 'en';
    if (code === 'de') return 'de';
  }
  return initial;
}

/* ------------------------------ Page shell ----------------------------- */

export function SignPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [lang, setLang] = useState<UiLang>('de');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
          credentials: 'omit',
        });
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: 'invalid', message: 'not found' });
          return;
        }
        if (res.status === 410) {
          setState({ kind: 'expired', message: 'expired or already used' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'invalid', message: `HTTP ${res.status}` });
          return;
        }
        const data = (await res.json()) as SignTokenInfo;
        setState({ kind: 'ready', data });
        setLang(pickLang(data.locale));
      } catch (err) {
        if (!cancelled) setState({ kind: 'invalid', message: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    try {
      window.localStorage.setItem('sign-lang', lang);
    } catch {
      /* private mode */
    }
  }, [lang]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#0a0b0e] antialiased">
      <PageHeader lang={lang} onLang={setLang} />
      <main className="mx-auto max-w-[1100px] px-4 pb-10 pt-5 sm:px-6 lg:px-8 lg:pt-8">
        {state.kind === 'loading' && (
          <Centered><Spinner size="lg" /></Centered>
        )}
        {(state.kind === 'invalid' || state.kind === 'expired') && (
          <ErrorScreen kind={state.kind} lang={lang} />
        )}
        {state.kind === 'done' && <SuccessScreen state={state} lang={lang} />}
        {(state.kind === 'ready' || state.kind === 'submitting') && (
          <SignFlow state={state} setState={setState} lang={lang} />
        )}
      </main>
      <PageFooter lang={lang} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">{children}</div>
  );
}

/* ------------------------------- Header -------------------------------- */

function PageHeader({
  lang,
  onLang,
}: {
  lang: UiLang;
  onLang: (l: UiLang) => void;
}) {
  const t = STR[lang];
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-3 px-4 sm:h-16 sm:px-6 lg:px-8">
        <a href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#0a0b0e] text-white sm:size-9">
            <Building2 size={15} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[14px] font-semibold sm:text-[15px]">
              LTS Logistik GmbH
            </div>
            <div className="hidden text-[11px] text-black/45 sm:block">
              {t.brandTagline}
            </div>
          </div>
        </a>
        <LangSwitch lang={lang} onLang={onLang} />
      </div>
    </header>
  );
}

function LangSwitch({
  lang,
  onLang,
}: {
  lang: UiLang;
  onLang: (l: UiLang) => void;
}) {
  const langs: { code: UiLang; label: string }[] = [
    { code: 'de', label: 'DE' },
    { code: 'en', label: 'EN' },
    { code: 'pl', label: 'PL' },
  ];
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-black/10 bg-white p-1 text-xs">
      <Globe size={13} className="ml-1.5 hidden text-black/40 sm:block" />
      {langs.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => onLang(l.code)}
          className={`grid h-7 min-w-9 place-items-center rounded-full px-2 font-medium transition ${
            lang === l.code
              ? 'bg-[#0a0b0e] text-white shadow-[0_2px_6px_rgba(0,0,0,0.08)]'
              : 'text-black/55 hover:text-black/85'
          }`}
          aria-label={l.label}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Error / OK ----------------------------- */

function ErrorScreen({
  kind,
  lang,
}: {
  kind: 'invalid' | 'expired';
  lang: UiLang;
}) {
  const t = STR[lang];
  const title = kind === 'expired' ? t.expiredTitle : t.invalidTitle;
  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-3xl border border-black/5 bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(15,15,20,0.18)] sm:p-10">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle size={20} />
        </div>
        <h1 className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-black/60">{t.expiredHint}</p>
      </div>
    </div>
  );
}

function SuccessScreen({
  state,
  lang,
}: {
  state: Extract<State, { kind: 'done' }>;
  lang: UiLang;
}) {
  const t = STR[lang];
  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-3xl border border-black/5 bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(15,15,20,0.18)] sm:p-12">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 sm:size-16">
          <CheckCircle2 size={26} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:mt-7 sm:text-3xl">
          {t.successTitle}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-black/60 sm:text-[15px]">
          {t.successDescription}
        </p>
        {state.upload_error && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            <AlertTriangle size={12} />
            {t.successUploadFailed}
          </div>
        )}
        <div className="mt-7 flex items-center justify-center gap-2 text-[11px] text-black/40">
          <CheckCircle2 size={11} className="text-emerald-500" />
          <span>
            {t.successSignedAt}: {new Date(state.signed_at).toLocaleString(intlTag(lang))}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Sign flow ------------------------------ */

function SignFlow({
  state,
  setState,
  lang,
}: {
  state: Extract<State, { kind: 'ready' } | { kind: 'submitting' }>;
  setState: (s: State) => void;
  lang: UiLang;
}) {
  const data = state.data;
  const submitting = state.kind === 'submitting';
  const t = STR[lang];

  const [signerName, setSignerName] = useState(data.driver_name || '');
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  const expiresInDays = useMemo(() => {
    const ms = new Date(data.expires_at).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
  }, [data.expires_at]);

  const period = useMemo(() => {
    const allRows = data.payload.sections.flatMap((s) => s.rows);
    if (allRows.length === 0) return null;
    const starts = allRows.map((r) => new Date(r.start_time).getTime());
    const ends = allRows.map((r) => new Date(r.end_time).getTime());
    return {
      from: new Date(Math.min(...starts)),
      to: new Date(Math.max(...ends)),
    };
  }, [data.payload]);

  const onSubmit = async () => {
    setError(null);
    if (!signerName.trim() || signerName.trim().length < 2) {
      setError(t.errorEmptyName);
      return;
    }
    const png = sigRef.current?.toPng() ?? '';
    if (!png || sigRef.current?.isEmpty()) {
      setError(t.errorEmptySignature);
      return;
    }
    setState({ kind: 'submitting', data });
    try {
      const res = await fetch(`/api/sign/${encodeURIComponent(data.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          signature_png_b64: png,
          signer_name: signerName.trim(),
          driver_remark: remark.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `${t.errorPrefix} ${res.status}`);
        setState({ kind: 'ready', data });
        return;
      }
      setState({
        kind: 'done',
        data,
        dropbox_path: body.dropbox_path || null,
        upload_error: body.upload_error || null,
        signed_at: body.signed_at,
      });
    } catch (err) {
      setError(String(err));
      setState({ kind: 'ready', data });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr,400px] lg:items-start lg:gap-8">
      {/* LEFT: hero summary + violations */}
      <div className="space-y-5 lg:space-y-6">
        <Hero
          data={data}
          lang={lang}
          period={period}
          expiresInDays={expiresInDays}
        />
        <ViolationsList payload={data.payload} lang={lang} />
      </div>

      {/* RIGHT: sticky signature card on desktop, normal flow on mobile */}
      <aside className="lg:sticky lg:top-20">
        <ConfirmCard
          data={data}
          lang={lang}
          sigRef={sigRef}
          signerName={signerName}
          setSignerName={setSignerName}
          remark={remark}
          setRemark={setRemark}
          submitting={submitting}
          error={error}
          onSubmit={onSubmit}
        />
      </aside>
    </div>
  );
}

/* ---------------------------- Hero / Summary --------------------------- */

function Hero({
  data,
  lang,
  period,
  expiresInDays,
}: {
  data: SignTokenInfo;
  lang: UiLang;
  period: { from: Date; to: Date } | null;
  expiresInDays: number;
}) {
  const t = STR[lang];
  return (
    <section className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(15,15,20,0.04)]">
      {/* top: driver name + intro */}
      <div className="border-b border-black/5 bg-gradient-to-br from-[#0a0b0e] to-[#1a1d24] px-5 py-6 text-white sm:px-7 sm:py-8">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
          {t.summaryDriver}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">
          {data.driver_name || data.driver_card}
        </h1>
        <p className="mt-3 max-w-md text-[13px] leading-relaxed text-white/65 sm:text-sm">
          {t.intro}
        </p>
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/8 px-2.5 py-1 text-[11px] text-white/75 backdrop-blur-md">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {t.valid} · {expiresInDays > 0 ? t.days(expiresInDays) : 'expired'}
        </div>
      </div>

      {/* bottom: compact summary — meaningless tiles render to null */}
      <div className="grid auto-cols-fr grid-flow-col divide-x divide-black/5">
        <SummaryTile
          label={t.summaryTotal}
          value={String(data.payload.summary.total)}
          big
        />
        <SummaryTile
          label={t.summaryPeriod}
          value={
            period
              ? `${fmtDate(period.from, lang)} – ${fmtDate(period.to, lang)}`
              : '—'
          }
        />
        <SummaryTile
          label={t.summaryCard}
          value={data.driver_card}
          mono
        />
      </div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  big = false,
  mono = false,
}: {
  label: string;
  value: string | null;
  big?: boolean;
  mono?: boolean;
}) {
  // Skip rendering for empty / placeholder values — the page is more
  // useful when blank tiles disappear instead of showing "—".
  if (value === null || value === '' || value === '—') return null;
  return (
    <div className="px-3 py-3 text-center sm:px-4 sm:py-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-black/45">
        {label}
      </div>
      <div
        className={`mt-1 break-words ${
          big
            ? 'text-2xl font-semibold tabular-nums sm:text-3xl'
            : 'text-[12px] font-medium leading-tight sm:text-[13px]'
        } ${mono ? 'font-mono text-[12px] sm:text-[13px]' : ''}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

/* ---------------------------- Violations list -------------------------- */

function ViolationsList({
  payload,
  lang,
}: {
  payload: PdfPayload;
  lang: UiLang;
}) {
  const t = STR[lang];
  const sections = useMemo(
    () => payload.sections.filter((s) => (s.rows?.length ?? 0) > 0),
    [payload],
  );
  const totalRows = useMemo(
    () => sections.reduce((acc, s) => acc + s.rows.length, 0),
    [sections],
  );

  if (totalRows === 0) return null;

  const allRows = sections.flatMap((s) =>
    s.rows.map((r) => ({ row: r, heading: s.heading })),
  );

  return (
    <section>
      <header className="mb-3 flex items-end justify-between gap-3 px-1">
        <h2 className="text-[20px] font-semibold tracking-tight">{t.listTitle}</h2>
        <span className="text-[12px] font-medium text-black/45">{totalRows}</span>
      </header>
      <div className="space-y-3">
        {allRows.map(({ row, heading }, i) => (
          <ViolationCard
            key={`${row.rule_id}-${i}`}
            row={row}
            heading={heading}
            lang={lang}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One violation, one card. Open by default — no accordion. The card reads
 * top-to-bottom like a paragraph in a document:
 *   1. severity stripe on the left edge (color = urgency)
 *   2. heading chip + severity label
 *   3. bold title
 *   4. plain-language explanation
 *   5. when applicable: numeric metric pair + "+N%" pill (time-based only)
 *   6. small footer line with the period
 *
 * For "count" violations (missing country entry, etc.) the numeric pair
 * "0 / 1" is hidden — those numbers are confusing for the driver because
 * "0 of 1" can read as "all clear". The headline + explanation already
 * convey the issue.
 */
function ViolationCard({
  row,
  heading,
  lang,
}: {
  row: ViolationRow;
  heading: string;
  lang: UiLang;
}) {
  const tone = severityTone(row.severity);
  const stripe =
    tone === 'high'
      ? 'bg-rose-500'
      : tone === 'med'
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  // Decide what (if anything) to render in the metrics row.
  //
  // A violation is one of:
  //   over       — measured > allowed (driving time, breaks)
  //   shortfall  — measured < allowed AND excess > 0 (rest too short)
  //   structural — measured == 0 / count rule (missing entry)
  //
  // Only "over" and "shortfall" have meaningful numbers for the driver.
  // "structural" rules render headline + explanation only — the numbers
  // 0 / 1 are confusing because they look like "all clear".
  const m = row.measured_value;
  const a = row.allowed_value;
  const isTimeUnit =
    row.unit === 'minutes' || row.unit === 'hours' || row.unit === 'days';
  const hasNumbers =
    isTimeUnit && m !== null && a !== null && (m > 0 || a > 0);

  type Mode = 'over' | 'shortfall' | 'none';
  let mode: Mode = 'none';
  if (hasNumbers && m! > a! && a! > 0) mode = 'over';
  else if (hasNumbers && m! < a! && a! > 0) mode = 'shortfall';

  const measuredStr = hasNumbers ? formatMaybeHours(m, row.unit, lang) : null;
  const allowedStr = hasNumbers ? formatMaybeHours(a, row.unit, lang) : null;

  const overPercent =
    mode === 'over' && a! > 0
      ? Math.round(((m! - a!) / a!) * 100)
      : null;
  const shortfallStr =
    mode === 'shortfall'
      ? formatMaybeHours(a! - m!, row.unit, lang)
      : null;

  return (
    <article className="relative overflow-hidden rounded-3xl border border-black/5 bg-white p-5 pl-6 shadow-[0_1px_2px_rgba(15,15,20,0.04)] sm:p-7 sm:pl-8">
      <span className={`absolute left-0 top-0 h-full w-1 ${stripe}`} aria-hidden />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-black/55">
          {heading}
        </span>
        <SeverityPill severity={row.severity} lang={lang} />
      </div>

      <h3 className="mt-3 text-[18px] font-semibold leading-tight tracking-tight text-black sm:text-[20px]">
        {row.title}
      </h3>

      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-black/70 sm:text-[15px]">
        {row.explanation}
      </p>

      {mode === 'over' && (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-rose-700 sm:text-3xl">
            {measuredStr}
          </span>
          <span className="text-base text-black/40">/</span>
          <span className="text-base font-medium tabular-nums text-black/55 sm:text-lg">
            {allowedStr}
          </span>
          {overPercent !== null && overPercent > 0 && (
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-rose-700">
              +{overPercent}%
            </span>
          )}
        </div>
      )}

      {mode === 'shortfall' && (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-rose-700 sm:text-3xl">
            {measuredStr}
          </span>
          <span className="text-base text-black/40">/</span>
          <span className="text-base font-medium tabular-nums text-black/55 sm:text-lg">
            {allowedStr}
          </span>
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-rose-700">
            {shortfallLabel(lang, shortfallStr ?? '')}
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/5 pt-3 text-[11px] text-black/40">
        <span>
          {fmtDateTime(row.start_time, lang)} → {fmtDateTime(row.end_time, lang)}
        </span>
      </div>
    </article>
  );
}

function SeverityPill({
  severity,
  lang,
}: {
  severity: string | null;
  lang: UiLang;
}) {
  if (!severity) return null;
  const tone = severityTone(severity);
  const cls =
    tone === 'high'
      ? 'bg-rose-50 text-rose-700'
      : tone === 'med'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-emerald-50 text-emerald-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {severityLabel(severity, lang)}
    </span>
  );
}

function severityTone(severity: string | null): 'high' | 'med' | 'low' {
  if (!severity) return 'low';
  const s = severity.toUpperCase();
  if (s.includes('MOST') || s.includes('VERY')) return 'high';
  if (s.includes('SERIOUS')) return 'med';
  return 'low';
}

function severityLabel(severity: string, lang: UiLang): string {
  const map: Record<string, Record<UiLang, string>> = {
    MOST_SERIOUS: {
      de: 'Sehr schwer',
      en: 'Most serious',
      pl: 'Bardzo poważne',
    },
    VERY_SERIOUS: { de: 'Schwer', en: 'Very serious', pl: 'Poważne' },
    SERIOUS: { de: 'Erheblich', en: 'Serious', pl: 'Istotne' },
    MINOR: { de: 'Gering', en: 'Minor', pl: 'Drobne' },
  };
  const slot = map[severity.toUpperCase()];
  if (!slot) return severity;
  return slot[lang];
}

/* ------------------------------ Confirm -------------------------------- */

function ConfirmCard({
  data,
  lang,
  sigRef,
  signerName,
  setSignerName,
  remark,
  setRemark,
  submitting,
  error,
  onSubmit,
}: {
  data: SignTokenInfo;
  lang: UiLang;
  sigRef: React.RefObject<SignaturePadHandle | null>;
  signerName: string;
  setSignerName: (n: string) => void;
  remark: string;
  setRemark: (r: string) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const t = STR[lang];
  return (
    <div className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(15,15,20,0.04)]">
      <header className="border-b border-black/5 px-5 py-3.5 sm:px-6">
        <h2 className="text-[15px] font-semibold tracking-tight">
          {t.confirmTitle}
        </h2>
        <p className="mt-0.5 text-[12px] text-black/55">
          {t.confirmDescription}
        </p>
      </header>

      <div className="space-y-4 p-5 sm:p-6">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-black/55">
            {t.nameLabel}
          </span>
          <input
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className="h-11 w-full rounded-2xl border border-black/10 bg-white px-4 text-[15px] text-black placeholder-black/30 transition focus:border-[#0a0b0e] focus:outline-none focus:ring-2 focus:ring-black/[0.06]"
            placeholder={t.namePlaceholder}
            inputMode="text"
            autoComplete="name"
          />
        </label>

        <details className="group">
          <summary className="flex cursor-pointer items-center justify-between text-[12px] font-medium text-black/55 hover:text-black">
            <span>{t.remarkLabel}</span>
            <ChevronUp
              size={14}
              className="transition group-open:rotate-180"
            />
          </summary>
          <textarea
            rows={3}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            className="mt-2 w-full resize-none rounded-2xl border border-black/10 bg-white p-3 text-[14px] text-black placeholder-black/30 transition focus:border-[#0a0b0e] focus:outline-none focus:ring-2 focus:ring-black/[0.06]"
            placeholder={t.remarkPlaceholder}
          />
        </details>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-black/55">
              {t.signatureLabel}
            </span>
            <button
              type="button"
              onClick={() => sigRef.current?.clear()}
              className="inline-flex items-center gap-1 text-xs text-black/55 hover:text-black"
            >
              <Eraser size={12} />
              {t.clear}
            </button>
          </div>
          <SignaturePad ref={sigRef} hint={t.signatureHint} />
        </div>

        {error && (
          <div className="rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0a0b0e] text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(15,15,20,0.6)] transition hover:bg-black active:scale-[0.99] disabled:opacity-60"
        >
          {submitting ? (
            <Spinner size="sm" />
          ) : (
            <>
              <Lock size={15} />
              {t.submit}
            </>
          )}
        </button>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-black/40">
          <ShieldCheck size={11} />
          {t.securityCue}
        </div>
        <div className="text-center text-[10px] text-black/30">
          <code className="font-mono">{data.payload_hash.slice(0, 16)}…</code>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Signature canvas -------------------------- */

interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toPng: () => string;
}

const SignaturePad = forwardRef<SignaturePadHandle, { hint: string }>(
  ({ hint }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawing = useRef(false);
    const empty = useRef(true);
    const last = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // The canvas has to be re-measured every time its CSS size changes
      // (orientation flip, fonts loading, on-screen keyboard opening on
      // iOS). Without this, the internal bitmap size diverges from the
      // CSS size and pointer events end up at the wrong canvas pixel —
      // which is exactly the "signature is offset from my finger" bug
      // the driver reported.
      //
      // We snapshot the existing pixels into an off-screen ImageData
      // before resizing so partial signatures survive the rescale.
      const setupForCurrentSize = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const targetW = Math.max(1, Math.round(rect.width * dpr));
        const targetH = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width === targetW && canvas.height === targetH) return;

        // Save current bitmap so we can restore after resize.
        let snapshot: HTMLCanvasElement | null = null;
        if (canvas.width > 0 && canvas.height > 0 && !empty.current) {
          snapshot = document.createElement('canvas');
          snapshot.width = canvas.width;
          snapshot.height = canvas.height;
          const sctx = snapshot.getContext('2d');
          if (sctx) sctx.drawImage(canvas, 0, 0);
        }

        canvas.width = targetW;
        canvas.height = targetH;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0a0b0e';

        if (snapshot) {
          // Repaint the previous signature into the new bitmap, scaled
          // proportionally so it aligns with the new CSS size.
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, targetW, targetH);
          ctx.restore();
          ctx.scale(dpr, dpr);
        }
      };

      setupForCurrentSize();

      const ro = new ResizeObserver(setupForCurrentSize);
      ro.observe(canvas);
      window.addEventListener('orientationchange', setupForCurrentSize);
      return () => {
        ro.disconnect();
        window.removeEventListener('orientationchange', setupForCurrentSize);
      };
    }, []);

    const point = (e: React.PointerEvent) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const start = (e: React.PointerEvent) => {
      drawing.current = true;
      empty.current = false;
      last.current = point(e);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: React.PointerEvent) => {
      if (!drawing.current || !last.current) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      e.preventDefault();
    };
    const end = () => {
      drawing.current = false;
      last.current = null;
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, c.width, c.height);
        empty.current = true;
      },
      isEmpty: () => empty.current,
      toPng: () => canvasRef.current?.toDataURL('image/png') ?? '',
    }));

    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-white p-2">
        <canvas
          ref={canvasRef}
          className="h-40 w-full touch-none rounded-xl bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          aria-label={hint}
        />
        <div className="px-2 pb-1 pt-1 text-[11px] text-black/40">{hint}</div>
      </div>
    );
  },
);
SignaturePad.displayName = 'SignaturePad';

/* ------------------------------- Footer -------------------------------- */

function PageFooter({ lang }: { lang: UiLang }) {
  return (
    <footer className="border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-[1100px] flex-col items-start justify-between gap-2 px-4 py-5 text-[11px] text-black/45 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded bg-[#0a0b0e] text-white">
            <Building2 size={11} />
          </span>
          <span>© {new Date().getFullYear()} LTS Logistik GmbH</span>
        </div>
        <div className="text-black/35">
          {lang === 'pl'
            ? 'Bezpieczne TLS'
            : lang === 'en'
              ? 'TLS encrypted'
              : 'TLS-verschlüsselt'}
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------ formatting ----------------------------- */

/**
 * Convert a "minutes" measurement to a human-friendly hours string.
 *   90  → "1h 30min"
 *   300 → "5h"
 *   12  → "12 min"      (under one hour: keep minutes)
 *   720 → "12h"
 * Other units render as-is with a translated suffix.
 */
function formatMaybeHours(
  value: number | null,
  unit: string,
  lang: UiLang,
): string {
  if (value === null) return '—';
  const t = STR[lang];
  if (unit === 'minutes') {
    const total = Math.round(value);
    if (total < 60) return `${total} min`;
    const h = Math.floor(total / 60);
    const m = total - h * 60;
    if (m === 0) return `${h}${t.hours}`;
    return `${h}${t.hoursAndMin} ${m}min`;
  }
  if (unit === 'hours') {
    return `${fmtNumber(value)}${t.hours}`;
  }
  if (unit === 'days') {
    if (lang === 'pl') return `${fmtNumber(value)} dni`;
    if (lang === 'en') return `${fmtNumber(value)} ${value === 1 ? 'day' : 'days'}`;
    return `${fmtNumber(value)} ${value === 1 ? 'Tag' : 'Tage'}`;
  }
  if (unit === 'count') {
    return fmtNumber(value);
  }
  return `${fmtNumber(value)} ${unit}`.trim();
}

function shortfallLabel(lang: UiLang, amount: string): string {
  if (lang === 'pl') return `brakuje ${amount}`;
  if (lang === 'en') return `${amount} short`;
  return `fehlt ${amount}`;
}

function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
}

function intlTag(lang: UiLang): string {
  if (lang === 'pl') return 'pl-PL';
  if (lang === 'en') return 'en-GB';
  return 'de-DE';
}

function fmtDate(d: Date, lang: UiLang): string {
  return d.toLocaleDateString(intlTag(lang), {
    day: '2-digit',
    month: 'short',
  });
}

function fmtDateTime(iso: string, lang: UiLang): string {
  const d = new Date(iso);
  return d.toLocaleString(intlTag(lang), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
