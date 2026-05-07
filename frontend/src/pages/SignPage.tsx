import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Globe,
  PenLine,
  Calendar,
  ChevronRight,
  Eraser,
} from 'lucide-react';
import { Spinner } from '../components/Spinner';

/**
 * Public driver-signing page.
 *
 * Flow:
 *   1. Mount fetches /api/sign/<token> and renders the violation list.
 *   2. Driver picks language, signs on the canvas, optionally adds a remark.
 *   3. Submit POSTs the signature back; backend renders a PDF and uploads
 *      to Dropbox.
 *   4. On success, a confirmation screen with the timestamp.
 *
 * The page runs OUTSIDE the authenticated Layout so the driver can open
 * it via WhatsApp without logging in.
 *
 * Design:
 *   - Liquid glass over a soft dark gradient — matches the landing page.
 *   - Wide container (1100px) so violation cards have breathing room.
 *   - Tri-language switcher in the header (DE / EN / PL). Language is
 *     a pure UI preference here — the violation rows themselves were
 *     already locale-bound by the engine, so we keep them in the locale
 *     the dispatcher chose; the chrome (titles, buttons, footer) follows
 *     the driver's pick.
 *   - No fine amounts shown. The driver doesn't need them on this page;
 *     they live in the dispatcher portal.
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
  summary: { total: number; driver_fine_total_eur: number | null; company_fine_total_eur: number | null };
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
  | { kind: 'done'; data: SignTokenInfo; dropbox_path: string | null; upload_error: string | null; signed_at: string };

/* ----------------------------- Translations ----------------------------- */

const STR = {
  de: {
    headerTitle: 'Verstoßprotokoll',
    headerSubtitle: 'Bitte zur Kenntnis nehmen und unterzeichnen.',
    summaryTotal: 'Verstöße gesamt',
    summaryPeriod: 'Bewertungszeitraum',
    summaryDriver: 'Fahrer',
    confirmTitle: 'Bestätigung',
    confirmDescription:
      'Mit deiner Unterschrift bestätigst du, dass du die oben genannten Verstöße zur Kenntnis genommen hast. Anmerkungen kannst du im Feld unten festhalten.',
    nameLabel: 'Dein Name',
    namePlaceholder: 'Vor- und Nachname',
    remarkLabel: 'Anmerkung (optional)',
    remarkPlaceholder:
      'z. B. Verspätung wegen Stau bei Dresden, schon mit Disposition geklärt.',
    signatureLabel: 'Unterschrift',
    signatureHint: 'Mit dem Finger oder der Maus unterschreiben.',
    clear: 'Zurücksetzen',
    submit: 'Unterschrift bestätigen',
    submitting: 'Sende …',
    errorEmptyName: 'Bitte deinen vollständigen Namen eingeben.',
    errorEmptySignature: 'Bitte unten unterschreiben.',
    errorPrefix: 'Fehler',
    invalidTitle: 'Link ungültig',
    expiredTitle: 'Link abgelaufen',
    expiredHint: 'Bitte wende dich an die Disposition. Wir schicken dir einen neuen Link.',
    successTitle: 'Unterschrift gespeichert',
    successDriverThanks: (n: string) => `Vielen Dank, ${n}.`,
    successDescription:
      'Das Dokument wurde signiert und in der Disposition hinterlegt.',
    successUploadFailed:
      'Upload zur Cloud schlug fehl — die Disposition wird ihn nachholen.',
    successSignedAt: 'Signatur-Zeitpunkt:',
    expiresIn: 'gültig noch',
    days: (n: number) => `${n} Tag${n === 1 ? '' : 'e'}`,
    legalNote: 'Hash:',
    validUntil: 'Gültig bis',
    period: 'Zeitraum',
    measured: 'Gemessen',
    allowed: 'Erlaubt',
  },
  en: {
    headerTitle: 'Violation report',
    headerSubtitle: 'Please review and sign.',
    summaryTotal: 'Total violations',
    summaryPeriod: 'Evaluation period',
    summaryDriver: 'Driver',
    confirmTitle: 'Confirmation',
    confirmDescription:
      'By signing you confirm you have reviewed the violations above. You may add a remark in the field below.',
    nameLabel: 'Your name',
    namePlaceholder: 'First and last name',
    remarkLabel: 'Remark (optional)',
    remarkPlaceholder:
      'e.g. Held up by traffic near Dresden, already discussed with dispatch.',
    signatureLabel: 'Signature',
    signatureHint: 'Sign with finger or mouse.',
    clear: 'Clear',
    submit: 'Confirm signature',
    submitting: 'Sending …',
    errorEmptyName: 'Please enter your full name.',
    errorEmptySignature: 'Please sign below.',
    errorPrefix: 'Error',
    invalidTitle: 'Link invalid',
    expiredTitle: 'Link expired',
    expiredHint: 'Please contact dispatch — we will send you a fresh link.',
    successTitle: 'Signature saved',
    successDriverThanks: (n: string) => `Thank you, ${n}.`,
    successDescription:
      'The document has been signed and filed with dispatch.',
    successUploadFailed:
      'Cloud upload failed — dispatch will retry on their end.',
    successSignedAt: 'Signed at:',
    expiresIn: 'valid for',
    days: (n: number) => `${n} day${n === 1 ? '' : 's'}`,
    legalNote: 'Hash:',
    validUntil: 'Valid until',
    period: 'Period',
    measured: 'Measured',
    allowed: 'Allowed',
  },
  pl: {
    headerTitle: 'Protokół naruszeń',
    headerSubtitle: 'Prosimy o zapoznanie się i podpisanie.',
    summaryTotal: 'Naruszeń łącznie',
    summaryPeriod: 'Okres analizy',
    summaryDriver: 'Kierowca',
    confirmTitle: 'Potwierdzenie',
    confirmDescription:
      'Składając podpis potwierdzasz, że zapoznałeś się z naruszeniami powyżej. W polu poniżej możesz dodać uwagi.',
    nameLabel: 'Imię i nazwisko',
    namePlaceholder: 'Imię i nazwisko',
    remarkLabel: 'Uwagi (opcjonalnie)',
    remarkPlaceholder:
      'np. opóźnienie z powodu korka pod Dreznem, ustalone z dyspozycją.',
    signatureLabel: 'Podpis',
    signatureHint: 'Podpisz palcem lub myszą.',
    clear: 'Wyczyść',
    submit: 'Potwierdź podpis',
    submitting: 'Wysyłam …',
    errorEmptyName: 'Wpisz swoje imię i nazwisko.',
    errorEmptySignature: 'Złóż podpis poniżej.',
    errorPrefix: 'Błąd',
    invalidTitle: 'Link nieprawidłowy',
    expiredTitle: 'Link wygasł',
    expiredHint: 'Skontaktuj się z dyspozycją — wyślemy nowy link.',
    successTitle: 'Podpis zapisany',
    successDriverThanks: (n: string) => `Dziękujemy, ${n}.`,
    successDescription:
      'Dokument został podpisany i przekazany do dyspozycji.',
    successUploadFailed:
      'Wysyłka do chmury nie powiodła się — dyspozycja wyśle ponownie.',
    successSignedAt: 'Czas podpisu:',
    expiresIn: 'ważny jeszcze',
    days: (n: number) => `${n} dni`,
    legalNote: 'Hash:',
    validUntil: 'Ważny do',
    period: 'Okres',
    measured: 'Zmierzone',
    allowed: 'Dozwolone',
  },
} as const;

function pickLang(initial: UiLang): UiLang {
  // Read browser language for first-time visitors, falls back to the
  // dispatcher's locale if anything goes sideways.
  const stored = typeof window !== 'undefined'
    ? (window.localStorage.getItem('sign-lang') as UiLang | null)
    : null;
  if (stored && (stored === 'de' || stored === 'en' || stored === 'pl')) return stored;
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
        const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, { credentials: 'omit' });
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

  // Persist the language preference so refresh keeps the same chrome.
  useEffect(() => {
    try {
      window.localStorage.setItem('sign-lang', lang);
    } catch {
      /* ignore quota / private mode errors */
    }
  }, [lang]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#0a0b0e] text-white antialiased">
      {/* Soft ambient background — same vibe as landing without the photo */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1117] via-[#0a0b0e] to-[#0d1117]" />
        <div className="pointer-events-none absolute -top-40 right-0 h-[520px] w-[520px] rounded-full bg-[#0071e3]/[0.13] blur-[140px]" />
        <div className="pointer-events-none absolute -bottom-40 left-0 h-[460px] w-[460px] rounded-full bg-[#34c759]/[0.10] blur-[140px]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <PageHeader lang={lang} onLang={setLang} />

        <main className="flex-1">
          {state.kind === 'loading' && <Centered><Spinner size="lg" /></Centered>}
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
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] items-center justify-center">{children}</div>;
}

/* ------------------------------- Header -------------------------------- */

function PageHeader({ lang, onLang }: { lang: UiLang; onLang: (l: UiLang) => void }) {
  return (
    <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
          <span className="text-[15px]">LTS Logistik GmbH</span>
        </a>
        <LangSwitch lang={lang} onLang={onLang} />
      </div>
    </header>
  );
}

function LangSwitch({ lang, onLang }: { lang: UiLang; onLang: (l: UiLang) => void }) {
  const langs: { code: UiLang; label: string }[] = [
    { code: 'de', label: 'DE' },
    { code: 'en', label: 'EN' },
    { code: 'pl', label: 'PL' },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1 text-xs backdrop-blur-md">
      <Globe size={14} className="ml-2 text-white/55" />
      {langs.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => onLang(l.code)}
          className={`grid h-7 min-w-9 place-items-center rounded-full px-2 font-medium transition ${
            lang === l.code
              ? 'bg-white text-[#0a0b0e]'
              : 'text-white/70 hover:text-white'
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
    <div className="mx-auto flex max-w-md items-center justify-center px-6 py-20">
      <div className="w-full rounded-3xl border border-white/15 bg-white/8 p-10 text-center backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-amber-400/15 text-amber-300">
          <AlertTriangle size={20} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-white/65">{t.expiredHint}</p>
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
    <div className="mx-auto flex max-w-md items-center justify-center px-6 py-20">
      <div className="w-full rounded-3xl border border-white/15 bg-white/8 p-10 text-center backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-green-400/15 text-green-300">
          <CheckCircle2 size={26} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t.successTitle}</h1>
        <p className="mt-3 text-sm text-white/70">
          {t.successDriverThanks(state.data.driver_name || state.data.driver_card)}
        </p>
        <p className="mt-1 text-sm text-white/55">{t.successDescription}</p>
        {state.upload_error && (
          <p className="mt-4 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            {t.successUploadFailed}
          </p>
        )}
        <p className="mt-6 text-xs text-white/35">
          {t.successSignedAt} {new Date(state.signed_at).toLocaleString(intlTag(lang))}
        </p>
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

  // Compute the period covered by the violations for the summary card.
  const period = useMemo(() => {
    const allRows = data.payload.sections.flatMap((s) => s.rows);
    if (allRows.length === 0) return null;
    const starts = allRows.map((r) => new Date(r.start_time).getTime());
    const ends = allRows.map((r) => new Date(r.end_time).getTime());
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends));
    return { from: min, to: max };
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
    <div className="mx-auto max-w-[1100px] px-6 py-10">
      {/* Page heading */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-white/55">
            {t.headerTitle}
          </div>
          <h1 className="mt-2 text-[clamp(2rem,3.4vw,2.6rem)] font-semibold leading-[1.05] tracking-tight">
            {data.driver_name || data.driver_card}
          </h1>
          <p className="mt-1 text-sm text-white/55">{t.headerSubtitle}</p>
        </div>
        <ValidityPill days={expiresInDays} expiresAt={data.expires_at} lang={lang} />
      </div>

      {/* Top summary strip */}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <SummaryTile
          icon={<FileText size={16} />}
          label={t.summaryTotal}
          value={String(data.payload.summary.total)}
        />
        <SummaryTile
          icon={<Calendar size={16} />}
          label={t.summaryPeriod}
          value={period ? `${fmtDate(period.from, lang)} – ${fmtDate(period.to, lang)}` : '—'}
        />
        <SummaryTile
          icon={<ShieldCheck size={16} />}
          label={t.summaryDriver}
          value={`${data.driver_name || data.driver_card} · ${data.driver_card}`}
        />
      </div>

      {/* Two-column layout: violation list (wide) + sticky signature card */}
      <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
        <div className="space-y-4">
          {data.payload.sections.length === 0 ? (
            <EmptyState lang={lang} />
          ) : (
            data.payload.sections.map((s) => (
              <SectionCard key={s.category} section={s} lang={lang} />
            ))
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
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
    </div>
  );
}

function ValidityPill({
  days,
  expiresAt,
  lang,
}: {
  days: number;
  expiresAt: string;
  lang: UiLang;
}) {
  const t = STR[lang];
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-white/75 backdrop-blur-md">
      <span className="size-1.5 rounded-full bg-[#34c759] animate-pulse" />
      {t.validUntil} {new Date(expiresAt).toLocaleDateString(intlTag(lang))}
      <span className="text-white/40">· {t.expiresIn} {t.days(days)}</span>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-md">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-white/80 border border-white/15">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-white/45">{label}</div>
        <div className="truncate text-sm font-medium text-white" title={value}>{value}</div>
      </div>
    </div>
  );
}

function EmptyState({ lang }: { lang: UiLang }) {
  const t = STR[lang];
  return (
    <div className="rounded-3xl border border-white/15 bg-white/8 p-10 text-center backdrop-blur-2xl">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-green-400/15 text-green-300">
        <CheckCircle2 size={20} />
      </div>
      <h3 className="mt-5 text-lg font-semibold">
        {lang === 'pl' ? 'Brak naruszeń.' : lang === 'en' ? 'No violations.' : 'Keine Verstöße.'}
      </h3>
      <p className="mt-1 text-sm text-white/60">
        {lang === 'pl'
          ? 'Tu i tak prosimy o podpis jako potwierdzenie zapoznania.'
          : lang === 'en'
          ? 'Please still sign as acknowledgement of review.'
          : 'Bitte trotzdem zur Kenntnis-Bestätigung unterzeichnen.'}
      </p>
      {/* Reuse t for type-stability across builds */}
      <p className="sr-only">{t.confirmTitle}</p>
    </div>
  );
}

/* ----------------------------- Section card ---------------------------- */

function SectionCard({ section, lang }: { section: PdfSection; lang: UiLang }) {
  const t = STR[lang];
  return (
    <section className="rounded-3xl border border-white/15 bg-white/8 p-6 backdrop-blur-2xl">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/70">
          {section.rows.length}
        </span>
      </div>

      <ul className="grid gap-3">
        {section.rows.map((row, i) => (
          <li
            key={`${row.rule_id}-${i}`}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-white/20 hover:bg-white/[0.07]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-white">{row.title}</div>
                <div className="mt-1 text-xs text-white/50">{row.legal_basis}</div>
              </div>
              {row.measured_value !== null && row.allowed_value !== null && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">
                    {fmtUnit(row.unit, lang)}
                  </div>
                  <div className="text-base font-semibold tabular-nums">
                    {fmtNumber(row.measured_value)}
                    <span className="text-white/40"> / {fmtNumber(row.allowed_value)}</span>
                  </div>
                </div>
              )}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white/75">{row.explanation}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/50">
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={12} className="text-white/35" />
                {fmtDateTime(row.start_time, lang)} → {fmtDateTime(row.end_time, lang)}
              </span>
              {row.measured_value !== null && row.allowed_value !== null && (
                <>
                  <span>{t.measured}: <span className="text-white/70 tabular-nums">{fmtNumber(row.measured_value)} {fmtUnit(row.unit, lang)}</span></span>
                  <span>{t.allowed}: <span className="text-white/70 tabular-nums">{fmtNumber(row.allowed_value)} {fmtUnit(row.unit, lang)}</span></span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
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
    <div className="rounded-3xl border border-white/15 bg-white/8 p-6 backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-white/10 border border-white/15 text-white/85">
          <PenLine size={15} />
        </span>
        <h2 className="text-base font-semibold tracking-tight">{t.confirmTitle}</h2>
      </div>
      <p className="mt-3 text-sm text-white/65">{t.confirmDescription}</p>

      <label className="mt-5 block text-sm">
        <span className="mb-1.5 block text-xs font-medium text-white/55">{t.nameLabel}</span>
        <input
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          className="h-11 w-full rounded-xl border border-white/15 bg-white/8 px-4 text-sm text-white placeholder-white/35 focus:border-[#7eb6ff] focus:outline-none focus:ring-1 focus:ring-[#7eb6ff]"
          placeholder={t.namePlaceholder}
        />
      </label>

      <label className="mt-3 block text-sm">
        <span className="mb-1.5 block text-xs font-medium text-white/55">{t.remarkLabel}</span>
        <textarea
          rows={3}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          className="w-full resize-none rounded-xl border border-white/15 bg-white/8 p-3 text-sm text-white placeholder-white/35 focus:border-[#7eb6ff] focus:outline-none focus:ring-1 focus:ring-[#7eb6ff]"
          placeholder={t.remarkPlaceholder}
        />
      </label>

      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-white/55">
          <span>{t.signatureLabel}</span>
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            className="inline-flex items-center gap-1 text-white/55 hover:text-white"
          >
            <Eraser size={12} />
            {t.clear}
          </button>
        </div>
        <SignaturePad ref={sigRef} hint={t.signatureHint} />
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-base font-semibold text-[#0a0b0e] shadow-[0_12px_32px_rgba(255,255,255,0.18)] transition hover:bg-white/95 disabled:opacity-60"
      >
        {submitting ? <Spinner size="sm" /> : (
          <>
            {t.submit}
            <ChevronRight size={16} />
          </>
        )}
      </button>

      <p className="mt-3 text-center text-[10px] text-white/30">
        {t.legalNote} <code className="font-mono">{data.payload_hash.slice(0, 16)}…</code>
      </p>
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
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0a0b0e';
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
      <div className="rounded-2xl border border-dashed border-white/20 bg-white/95 p-2">
        <canvas
          ref={canvasRef}
          className="h-44 w-full touch-none rounded-xl bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          aria-label={hint}
        />
        <div className="px-2 pb-1 pt-1 text-[11px] text-black/45">{hint}</div>
      </div>
    );
  },
);
SignaturePad.displayName = 'SignaturePad';

/* ------------------------------- Footer -------------------------------- */

function PageFooter({ lang }: { lang: UiLang }) {
  return (
    <footer className="border-t border-white/10 bg-black/25 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1100px] flex-col items-start justify-between gap-2 px-6 py-5 text-xs text-white/55 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-5 rounded" />
          <span>© {new Date().getFullYear()} LTS Logistik GmbH</span>
        </div>
        <div className="text-white/40">
          {lang === 'pl'
            ? 'Bezpieczny formularz podpisu'
            : lang === 'en'
            ? 'Secure signature form'
            : 'Sicheres Signaturformular'}
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------ formatting ----------------------------- */

function fmtNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtUnit(unit: string, lang: UiLang): string {
  if (lang === 'pl') {
    if (unit === 'minutes') return 'min';
    if (unit === 'hours') return 'godz';
    if (unit === 'days') return 'dni';
    if (unit === 'count') return 'szt';
  } else if (lang === 'en') {
    if (unit === 'minutes') return 'min';
    if (unit === 'hours') return 'h';
    if (unit === 'days') return 'days';
    if (unit === 'count') return 'count';
  } else {
    if (unit === 'minutes') return 'min';
    if (unit === 'hours') return 'Std';
    if (unit === 'days') return 'Tage';
    if (unit === 'count') return 'Anz.';
  }
  return unit;
}

function intlTag(lang: UiLang): string {
  if (lang === 'pl') return 'pl-PL';
  if (lang === 'en') return 'en-GB';
  return 'de-DE';
}

function fmtDate(d: Date, lang: UiLang): string {
  return d.toLocaleDateString(intlTag(lang), { day: '2-digit', month: 'short' });
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
