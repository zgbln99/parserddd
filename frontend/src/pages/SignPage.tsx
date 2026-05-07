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
  FileText,
  Globe,
  Calendar,
  Lock,
  ArrowRight,
  Eraser,
  Clock,
  CircleDashed,
  Building2,
} from 'lucide-react';
import { Spinner } from '../components/Spinner';

/**
 * Public driver-signing page — banking-grade light UI.
 *
 * Design language:
 *   - Light mode by default. Pure white surface (#fff) on a soft canvas
 *     (#f6f7f9). Heavy contrast for hierarchy via type weight, not colour.
 *   - Crisp 16-20px rounded corners on cards, very soft shadow stack
 *     (matches Apple-Card / Revolut / N26 aesthetic).
 *   - Step indicator at the top: Review → Sign → Confirm. Same metaphor
 *     bank apps use for transfers / KYC.
 *   - Each violation = one card with icon, big metric, neutral status.
 *     Status pills mirror "Pending / Cleared" pills from bank statements.
 *   - Trust signals near the CTA: lock icon, hash, expiry. Builds the
 *     "this is a real, secure document" feeling without loud copy.
 *
 * Page runs OUTSIDE the dispatcher Layout because the driver opens it
 * via WhatsApp without logging in.
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

/* ----------------------------- Translations ---------------------------- */

const STR = {
  de: {
    brandTagline: 'LTS Logistik · Fahrer-Portal',
    headerEyebrow: 'Verstoßprotokoll zur Unterschrift',
    headerTitle: 'Bitte zur Kenntnis nehmen.',
    headerSubtitle:
      'Du wurdest zum Unterzeichnen eines Verstoßprotokolls eingeladen. Die Unterschrift bestätigt, dass du den Inhalt gesehen hast — sie ist keine Schuldanerkennung.',
    stepReview: 'Prüfen',
    stepSign: 'Unterschreiben',
    stepConfirm: 'Bestätigen',
    secureSession: 'Sichere Sitzung',
    validUntil: 'Gültig bis',
    summaryTotal: 'Verstöße',
    summaryPeriod: 'Zeitraum',
    summaryDriver: 'Fahrer',
    summaryCard: 'Karte',
    summaryHash: 'Dokument-Hash',
    listEyebrow: 'Verstöße im Detail',
    listTitle: 'Was wir aufgezeichnet haben.',
    listEmpty: 'Keine Verstöße im Bewertungszeitraum — bitte trotzdem zur Kenntnis bestätigen.',
    measured: 'Gemessen',
    allowed: 'Erlaubt',
    excess: 'Über',
    rule: 'Regel',
    severity: 'Schwere',
    confirmEyebrow: 'Bestätigung',
    confirmTitle: 'Unterschreiben.',
    confirmDescription:
      'Mit deiner Unterschrift bestätigst du die Kenntnisnahme des oben genannten Inhalts. Anmerkungen kannst du im Feld unten festhalten.',
    nameLabel: 'Vor- und Nachname',
    namePlaceholder: 'z. B. Hans Mustermann',
    remarkLabel: 'Anmerkung (optional)',
    remarkPlaceholder:
      'z. B. Verspätung wegen Stau — bereits mit der Disposition geklärt.',
    signatureLabel: 'Unterschrift',
    signatureHint: 'Mit dem Finger oder der Maus unterschreiben.',
    clear: 'Zurücksetzen',
    submit: 'Unterschrift bestätigen',
    submitting: 'Sende…',
    errorEmptyName: 'Bitte deinen vollständigen Namen eingeben.',
    errorEmptySignature: 'Bitte unten unterschreiben.',
    errorPrefix: 'Fehler',
    invalidTitle: 'Link ungültig',
    expiredTitle: 'Link abgelaufen',
    expiredHint: 'Bitte wende dich an die Disposition. Wir schicken dir einen neuen Link.',
    successTitle: 'Vielen Dank.',
    successDescription:
      'Deine Unterschrift wurde gespeichert und sicher abgelegt. Die Disposition hat eine Kopie erhalten.',
    successUploadFailed:
      'Cloud-Upload schlug fehl — die Disposition wird ihn nachholen.',
    successSignedAt: 'Signatur-Zeitpunkt',
    securityCue: 'Verschlüsselte Übertragung · Einmal-Link',
    legalNote:
      'Hinweise zum Datenschutz: deine Unterschrift wird ausschließlich für die interne Dokumentation verwendet.',
    days: (n: number) => `${n} Tag${n === 1 ? '' : 'e'} verbleiben`,
    expired: 'abgelaufen',
  },
  en: {
    brandTagline: 'LTS Logistik · Driver Portal',
    headerEyebrow: 'Violation report — signature requested',
    headerTitle: 'Please review.',
    headerSubtitle:
      'You have been asked to sign a violation report. Signing confirms that you have seen the contents — it is not an admission of fault.',
    stepReview: 'Review',
    stepSign: 'Sign',
    stepConfirm: 'Confirm',
    secureSession: 'Secure session',
    validUntil: 'Valid until',
    summaryTotal: 'Violations',
    summaryPeriod: 'Period',
    summaryDriver: 'Driver',
    summaryCard: 'Card',
    summaryHash: 'Document hash',
    listEyebrow: 'Violations in detail',
    listTitle: 'What we recorded.',
    listEmpty: 'No violations in the period — please still confirm review.',
    measured: 'Measured',
    allowed: 'Allowed',
    excess: 'Over',
    rule: 'Rule',
    severity: 'Severity',
    confirmEyebrow: 'Confirmation',
    confirmTitle: 'Sign.',
    confirmDescription:
      'By signing you acknowledge the contents above. You may add a remark in the field below.',
    nameLabel: 'Full name',
    namePlaceholder: 'e.g. John Smith',
    remarkLabel: 'Remark (optional)',
    remarkPlaceholder:
      'e.g. Held up by traffic — already discussed with dispatch.',
    signatureLabel: 'Signature',
    signatureHint: 'Sign with finger or mouse.',
    clear: 'Clear',
    submit: 'Confirm signature',
    submitting: 'Sending…',
    errorEmptyName: 'Please enter your full name.',
    errorEmptySignature: 'Please sign below.',
    errorPrefix: 'Error',
    invalidTitle: 'Link invalid',
    expiredTitle: 'Link expired',
    expiredHint: 'Please contact dispatch — we will send you a fresh link.',
    successTitle: 'Thank you.',
    successDescription:
      'Your signature has been saved and filed securely. Dispatch has a copy.',
    successUploadFailed:
      'Cloud upload failed — dispatch will retry.',
    successSignedAt: 'Signed at',
    securityCue: 'Encrypted transfer · Single-use link',
    legalNote:
      'Privacy note: your signature is used exclusively for internal record-keeping.',
    days: (n: number) => `${n} day${n === 1 ? '' : 's'} remaining`,
    expired: 'expired',
  },
  pl: {
    brandTagline: 'LTS Logistik · Portal kierowcy',
    headerEyebrow: 'Protokół naruszeń do podpisu',
    headerTitle: 'Prosimy o zapoznanie.',
    headerSubtitle:
      'Otrzymałeś zaproszenie do podpisania protokołu naruszeń. Podpis potwierdza, że zapoznałeś się z treścią — nie jest przyznaniem się do winy.',
    stepReview: 'Przegląd',
    stepSign: 'Podpis',
    stepConfirm: 'Potwierdzenie',
    secureSession: 'Sesja bezpieczna',
    validUntil: 'Ważny do',
    summaryTotal: 'Naruszenia',
    summaryPeriod: 'Okres',
    summaryDriver: 'Kierowca',
    summaryCard: 'Karta',
    summaryHash: 'Hash dokumentu',
    listEyebrow: 'Naruszenia szczegółowo',
    listTitle: 'Co zostało zarejestrowane.',
    listEmpty:
      'Brak naruszeń w okresie — prosimy mimo to potwierdzić zapoznanie.',
    measured: 'Zmierzone',
    allowed: 'Dozwolone',
    excess: 'Powyżej',
    rule: 'Reguła',
    severity: 'Waga',
    confirmEyebrow: 'Potwierdzenie',
    confirmTitle: 'Podpisz.',
    confirmDescription:
      'Składając podpis potwierdzasz zapoznanie się z powyższą treścią. W polu poniżej możesz dodać uwagi.',
    nameLabel: 'Imię i nazwisko',
    namePlaceholder: 'np. Jan Kowalski',
    remarkLabel: 'Uwagi (opcjonalnie)',
    remarkPlaceholder:
      'np. opóźnienie z powodu korka — ustalone z dyspozycją.',
    signatureLabel: 'Podpis',
    signatureHint: 'Podpisz palcem lub myszą.',
    clear: 'Wyczyść',
    submit: 'Potwierdź podpis',
    submitting: 'Wysyłam…',
    errorEmptyName: 'Wpisz pełne imię i nazwisko.',
    errorEmptySignature: 'Złóż podpis poniżej.',
    errorPrefix: 'Błąd',
    invalidTitle: 'Link nieprawidłowy',
    expiredTitle: 'Link wygasł',
    expiredHint:
      'Skontaktuj się z dyspozycją — wyślemy nowy link.',
    successTitle: 'Dziękujemy.',
    successDescription:
      'Twój podpis został zapisany i bezpiecznie zarchiwizowany. Dyspozycja otrzymała kopię.',
    successUploadFailed:
      'Wysyłka do chmury nie powiodła się — dyspozycja wyśle ponownie.',
    successSignedAt: 'Czas podpisu',
    securityCue: 'Szyfrowane połączenie · Link jednorazowy',
    legalNote:
      'Ochrona danych: twój podpis będzie używany wyłącznie do wewnętrznej dokumentacji.',
    days: (n: number) => `pozostało ${n} dni`,
    expired: 'wygasł',
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
      /* private mode etc. */
    }
  }, [lang]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#0a0b0e] antialiased">
      <PageHeader lang={lang} onLang={setLang} state={state} />
      <main className="mx-auto max-w-[1180px] px-5 pb-20 pt-8 lg:px-10 lg:pt-10">
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
  state,
}: {
  lang: UiLang;
  onLang: (l: UiLang) => void;
  state: State;
}) {
  const t = STR[lang];
  const inProgress =
    state.kind === 'ready' || state.kind === 'submitting';
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-5 lg:px-10">
        <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-[#0a0b0e] text-white">
            <Building2 size={16} />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">LTS Logistik GmbH</div>
            <div className="hidden text-[11px] font-normal text-black/45 sm:block">
              {t.brandTagline}
            </div>
          </div>
        </a>
        <div className="flex items-center gap-2">
          {inProgress && (
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 md:inline-flex">
              <Lock size={11} />
              {t.secureSession}
            </span>
          )}
          <LangSwitch lang={lang} onLang={onLang} />
        </div>
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
    <div className="inline-flex items-center gap-0.5 rounded-full border border-black/10 bg-white p-1 text-xs">
      <Globe size={13} className="ml-1.5 text-black/40" aria-hidden />
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

function ErrorScreen({ kind, lang }: { kind: 'invalid' | 'expired'; lang: UiLang }) {
  const t = STR[lang];
  const title = kind === 'expired' ? t.expiredTitle : t.invalidTitle;
  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="rounded-3xl border border-black/5 bg-white p-10 text-center shadow-[0_20px_60px_-30px_rgba(15,15,20,0.18)]">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle size={20} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
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
    <div className="mx-auto mt-12 max-w-lg">
      <div className="rounded-3xl border border-black/5 bg-white p-12 text-center shadow-[0_20px_60px_-30px_rgba(15,15,20,0.18)]">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 size={28} />
        </div>
        <h1 className="mt-7 text-3xl font-semibold tracking-tight">
          {t.successTitle}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-black/60">
          {t.successDescription}
        </p>
        {state.upload_error && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            <AlertTriangle size={12} />
            {t.successUploadFailed}
          </div>
        )}
        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-black/40">
          <CheckCircle2 size={12} className="text-emerald-500" />
          <span>{t.successSignedAt}: {new Date(state.signed_at).toLocaleString(intlTag(lang))}</span>
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

  const totalRows = data.payload.summary.total;

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
    <div className="space-y-6">
      <Hero
        data={data}
        lang={lang}
        period={period}
        expiresInDays={expiresInDays}
      />

      <Stepper lang={lang} active={submitting ? 1 : 0} />

      <SectionLabel
        eyebrow={t.listEyebrow}
        title={t.listTitle}
        suffix={
          totalRows > 0 ? (
            <span className="rounded-full bg-black/[0.04] px-2.5 py-0.5 text-xs font-medium text-black/65">
              {totalRows}
            </span>
          ) : null
        }
      />

      {data.payload.sections.length === 0 ? (
        <EmptyState lang={lang} />
      ) : (
        <div className="space-y-4">
          {data.payload.sections.flatMap((s) =>
            s.rows.map((row, i) => (
              <ViolationCard
                key={`${row.rule_id}-${i}`}
                row={row}
                heading={s.heading}
                lang={lang}
              />
            )),
          )}
        </div>
      )}

      <SectionLabel eyebrow={t.confirmEyebrow} title={t.confirmTitle} />

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
    <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0a0b0e] via-[#13151b] to-[#1a1d24] text-white shadow-[0_30px_80px_-30px_rgba(15,15,20,0.45)]">
      <div className="grid gap-8 px-7 py-8 md:grid-cols-[1.4fr,1fr] md:gap-12 md:px-10 md:py-10">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-medium tracking-wide text-white/85 backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {t.headerEyebrow}
          </div>
          <h1 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.05] tracking-tight">
            {t.headerTitle}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/70">
            {t.headerSubtitle}
          </p>
          <ValidityPill expiresAt={data.expires_at} days={expiresInDays} lang={lang} />
        </div>
        <div className="flex flex-col gap-3">
          <HeroStat
            label={t.summaryDriver}
            value={data.driver_name || data.driver_card}
            sub={`${t.summaryCard} · ${data.driver_card}`}
          />
          <HeroStat
            label={t.summaryPeriod}
            value={
              period
                ? `${fmtDate(period.from, lang)} – ${fmtDate(period.to, lang)}`
                : '—'
            }
          />
          <HeroStat
            label={t.summaryTotal}
            value={String(data.payload.summary.total)}
            big
          />
        </div>
      </div>
    </section>
  );
}

function ValidityPill({
  expiresAt,
  days,
  lang,
}: {
  expiresAt: string;
  days: number;
  lang: UiLang;
}) {
  const t = STR[lang];
  return (
    <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-white/80 backdrop-blur-md">
      <Clock size={12} className="text-white/55" />
      <span>
        {t.validUntil}{' '}
        <span className="font-medium text-white">
          {new Date(expiresAt).toLocaleDateString(intlTag(lang))}
        </span>
      </span>
      <span className="text-white/35">·</span>
      <span className="text-white/55">{days > 0 ? t.days(days) : t.expired}</span>
    </div>
  );
}

function HeroStat({
  label,
  value,
  sub,
  big = false,
}: {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/5 p-4 backdrop-blur-md">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">
        {label}
      </div>
      <div
        className={`mt-1 truncate font-semibold tracking-tight ${
          big ? 'text-3xl tabular-nums' : 'text-base'
        }`}
        title={value}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-white/50">{sub}</div>}
    </div>
  );
}

/* ------------------------------- Stepper ------------------------------- */

function Stepper({ lang, active }: { lang: UiLang; active: number }) {
  const t = STR[lang];
  const steps = [t.stepReview, t.stepSign, t.stepConfirm];
  return (
    <ol className="flex items-center gap-3 overflow-x-auto rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,15,20,0.04)]">
      {steps.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition ${
                done
                  ? 'bg-emerald-500 text-white'
                  : current
                    ? 'bg-[#0a0b0e] text-white'
                    : 'bg-black/[0.05] text-black/40'
              }`}
            >
              {done ? <CheckCircle2 size={14} /> : i + 1}
            </span>
            <span
              className={`truncate text-sm font-medium ${
                current ? 'text-black' : 'text-black/55'
              }`}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className="ml-2 hidden h-px flex-1 bg-black/[0.06] md:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------- Section label --------------------------- */

function SectionLabel({
  eyebrow,
  title,
  suffix,
}: {
  eyebrow: string;
  title: string;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex items-end justify-between gap-4 px-1">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-black/45">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
      {suffix}
    </div>
  );
}

/* ------------------------------ Empty state ---------------------------- */

function EmptyState({ lang }: { lang: UiLang }) {
  const t = STR[lang];
  return (
    <div className="rounded-3xl border border-black/5 bg-white p-10 text-center shadow-[0_1px_2px_rgba(15,15,20,0.04)]">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle2 size={20} />
      </div>
      <p className="mt-5 text-base text-black/70">{t.listEmpty}</p>
    </div>
  );
}

/* ----------------------------- Violation card -------------------------- */

function ViolationCard({
  row,
  heading,
  lang,
}: {
  row: ViolationRow;
  heading: string;
  lang: UiLang;
}) {
  const t = STR[lang];
  const tone = severityTone(row.severity);
  const measured = row.measured_value;
  const allowed = row.allowed_value;
  const hasNumbers = measured !== null && allowed !== null;
  const overPercent =
    hasNumbers && allowed > 0
      ? Math.round((Math.max(measured - allowed, 0) / allowed) * 100)
      : null;

  return (
    <article className="rounded-3xl border border-black/5 bg-white p-6 shadow-[0_1px_2px_rgba(15,15,20,0.04)] transition hover:-translate-y-px hover:shadow-[0_12px_36px_-20px_rgba(15,15,20,0.18)] md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-black/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-black/65">
              {heading}
            </span>
            <SeverityPill severity={row.severity} lang={lang} />
          </div>
          <h3 className="mt-3 text-[20px] font-semibold leading-tight tracking-tight">
            {row.title}
          </h3>
          <p className="mt-1 text-[13px] text-black/45">{row.legal_basis}</p>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-black/70">
            {row.explanation}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-black/50">
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={12} className="text-black/35" />
              {fmtDateTime(row.start_time, lang)} → {fmtDateTime(row.end_time, lang)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText size={12} className="text-black/35" />
              <code className="font-mono text-[11px]">{row.rule_id}</code>
            </span>
          </div>
        </div>

        {hasNumbers && (
          <div className="grid w-full max-w-[300px] grid-cols-2 gap-3 md:w-auto md:min-w-[260px]">
            <Metric
              label={t.measured}
              value={fmtNumber(measured!)}
              unit={fmtUnit(row.unit, lang)}
              tone={tone === 'good' ? 'good' : 'warn'}
            />
            <Metric
              label={t.allowed}
              value={fmtNumber(allowed!)}
              unit={fmtUnit(row.unit, lang)}
              tone="neutral"
            />
            {overPercent !== null && overPercent > 0 && (
              <div className="col-span-2 inline-flex items-center justify-between rounded-2xl bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">
                <span>{t.excess}</span>
                <span className="tabular-nums">+{overPercent}%</span>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const valueClass =
    tone === 'warn'
      ? 'text-rose-700'
      : tone === 'good'
        ? 'text-emerald-700'
        : 'text-black/85';
  return (
    <div className="rounded-2xl border border-black/5 bg-[#fafafc] px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-black/45">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valueClass}`}>
        {value}{' '}
        <span className="text-sm font-medium text-black/45">{unit}</span>
      </div>
    </div>
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
  const label = severityLabel(severity, lang);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      <CircleDashed size={10} />
      {label}
    </span>
  );
}

function severityTone(severity: string | null): 'good' | 'warn' | 'high' | 'med' {
  if (!severity) return 'good';
  const s = severity.toUpperCase();
  if (s.includes('MOST') || s.includes('VERY')) return 'high';
  if (s.includes('SERIOUS')) return 'med';
  if (s.includes('MINOR')) return 'warn';
  return 'good';
}

function severityLabel(severity: string, lang: UiLang): string {
  const map: Record<string, Record<UiLang, string>> = {
    MOST_SERIOUS: { de: 'Sehr schwer', en: 'Most serious', pl: 'Bardzo poważne' },
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
      <div className="grid gap-0 md:grid-cols-[1fr,400px]">
        {/* Left: form */}
        <div className="border-b border-black/5 p-7 md:border-b-0 md:border-r md:p-9">
          <p className="text-[15px] leading-relaxed text-black/65">
            {t.confirmDescription}
          </p>

          <label className="mt-7 block text-sm">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-black/55">
              {t.nameLabel}
            </span>
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              className="h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-[15px] text-black placeholder-black/30 transition focus:border-[#0a0b0e] focus:outline-none focus:ring-2 focus:ring-black/[0.06]"
              placeholder={t.namePlaceholder}
            />
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-black/55">
              {t.remarkLabel}
            </span>
            <textarea
              rows={4}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="w-full resize-none rounded-2xl border border-black/10 bg-white p-4 text-[14px] text-black placeholder-black/30 transition focus:border-[#0a0b0e] focus:outline-none focus:ring-2 focus:ring-black/[0.06]"
              placeholder={t.remarkPlaceholder}
            />
          </label>
        </div>

        {/* Right: signature pad + CTA */}
        <div className="flex flex-col gap-5 bg-[#fafafc] p-7 md:p-9">
          <div>
            <div className="mb-2 flex items-center justify-between">
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
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0a0b0e] text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(15,15,20,0.6)] transition hover:bg-black disabled:opacity-60"
          >
            {submitting ? (
              <Spinner size="sm" />
            ) : (
              <>
                <Lock size={15} />
                {t.submit}
                <ArrowRight
                  size={15}
                  className="-mr-1 transition group-hover:translate-x-0.5"
                />
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-2 text-[11px] text-black/45">
            <ShieldCheck size={11} />
            {t.securityCue}
          </div>

          <div className="text-[10px] leading-relaxed text-black/35">
            {t.legalNote}
          </div>
          <div className="text-center text-[10px] text-black/30">
            {t.summaryHash}: <code className="font-mono">{data.payload_hash.slice(0, 16)}…</code>
          </div>
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
      <div className="rounded-2xl border border-dashed border-black/15 bg-white p-2">
        <canvas
          ref={canvasRef}
          className="h-44 w-full touch-none rounded-xl bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
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
      <div className="mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-2 px-5 py-6 text-xs text-black/45 sm:flex-row sm:items-center lg:px-10">
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded bg-[#0a0b0e] text-white">
            <Building2 size={11} />
          </span>
          <span>© {new Date().getFullYear()} LTS Logistik GmbH</span>
        </div>
        <div className="text-black/35">
          {lang === 'pl'
            ? 'Bezpieczny formularz podpisu — szyfrowanie TLS'
            : lang === 'en'
              ? 'Secure signature form — TLS encrypted'
              : 'Sicheres Signaturformular — TLS-verschlüsselt'}
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------ formatting ----------------------------- */

function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
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
  return d.toLocaleDateString(intlTag(lang), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
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
