import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Truck, ShieldCheck, AlertTriangle, CheckCircle2, FileText, RefreshCcw } from 'lucide-react';
import { Spinner } from '../components/Spinner';

/**
 * Public driver-signing page.
 *
 * Flow:
 *   1. Mount fetches /api/sign/<token> — shows the violation list.
 *   2. Driver fills name (defaults to driver_name on file) + optional remark
 *      and signs on a canvas.
 *   3. Submit POSTs to the same endpoint with signature_png_b64.
 *   4. On success, success screen with the Dropbox path.
 *
 * The page is intentionally a single component file. It runs OUTSIDE the
 * authenticated Layout so unauthenticated visitors can complete the flow.
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

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'expired'; message: string }
  | { kind: 'ready'; data: SignTokenInfo }
  | { kind: 'submitting'; data: SignTokenInfo }
  | { kind: 'done'; data: SignTokenInfo; dropbox_path: string | null; upload_error: string | null; signed_at: string };

export function SignPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, { credentials: 'omit' });
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: 'invalid', message: 'Link wurde nicht gefunden oder ist ungültig.' });
          return;
        }
        if (res.status === 410) {
          setState({ kind: 'expired', message: 'Link abgelaufen oder bereits unterzeichnet.' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'invalid', message: `Fehler ${res.status}` });
          return;
        }
        const data = (await res.json()) as SignTokenInfo;
        setState({ kind: 'ready', data });
      } catch (err) {
        if (!cancelled) setState({ kind: 'invalid', message: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') return <Centered><Spinner size="lg" /></Centered>;
  if (state.kind === 'invalid' || state.kind === 'expired') {
    return <ErrorScreen kind={state.kind} message={state.message} />;
  }
  if (state.kind === 'done') {
    return <SuccessScreen state={state} />;
  }

  return <SignFlow state={state} setState={setState} />;
}

/* ------------------------------- shells -------------------------------- */

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7]">{children}</div>;
}

function ErrorScreen({ kind, message }: { kind: 'invalid' | 'expired'; message: string }) {
  const isExpired = kind === 'expired';
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-10 text-center shadow-[0_3px_30px_rgba(0,0,0,0.04)]">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle size={20} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {isExpired ? 'Link abgelaufen' : 'Link ungültig'}
        </h1>
        <p className="mt-3 text-sm text-black/60">{message}</p>
        <p className="mt-6 text-sm text-black/70">
          Bitte wende dich an die Disposition. Wir schicken dir einen neuen Link.
        </p>
      </div>
    </div>
  );
}

function SuccessScreen({ state }: { state: Extract<State, { kind: 'done' }> }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-10 text-center shadow-[0_3px_30px_rgba(0,0,0,0.04)]">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-green-50 text-green-600">
          <CheckCircle2 size={24} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Unterschrift gespeichert</h1>
        <p className="mt-3 text-sm text-black/60">
          Vielen Dank, {state.data.driver_name || state.data.driver_card}. Das Dokument
          wurde signiert und in der Disposition hinterlegt.
        </p>
        {state.upload_error && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Upload zur Cloud schlug fehl: {state.upload_error}. Die Disposition wird
            den Upload nachholen.
          </p>
        )}
        <p className="mt-6 text-xs text-black/40">
          Signatur-Zeitpunkt: {new Date(state.signed_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ sign flow ------------------------------ */

function SignFlow({
  state,
  setState,
}: {
  state: Extract<State, { kind: 'ready' } | { kind: 'submitting' }>;
  setState: (s: State) => void;
}) {
  const data = state.data;
  const submitting = state.kind === 'submitting';

  const [signerName, setSignerName] = useState(data.driver_name || '');
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  const expiresIn = useMemo(() => {
    const ms = new Date(data.expires_at).getTime() - Date.now();
    const days = Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
    return `${days} Tag${days === 1 ? '' : 'e'}`;
  }, [data.expires_at]);

  const onSubmit = async () => {
    setError(null);
    if (!signerName.trim() || signerName.trim().length < 2) {
      setError('Bitte deinen vollständigen Namen eingeben.');
      return;
    }
    const png = sigRef.current?.toPng() ?? '';
    if (!png || sigRef.current?.isEmpty()) {
      setError('Bitte unten unterschreiben.');
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
        setError(body.error || `Fehler ${res.status}`);
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
    <div className="min-h-screen bg-[#f5f5f7] pb-24 text-[#1d1d1f]">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-[#1d1d1f] text-white">
              <Truck size={16} />
            </span>
            <span>LTS Logistik GmbH</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-black/50">
            <ShieldCheck size={14} />
            Sicheres Signaturformular
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-3xl bg-white p-8 shadow-[0_3px_30px_rgba(0,0,0,0.04)]">
          <div className="text-sm text-black/50">
            Verstoßprotokoll für
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {data.driver_name || data.driver_card}
          </h1>
          <div className="mt-1 text-xs text-black/40">
            Karte: {data.driver_card} · gültig noch {expiresIn}
          </div>
        </div>

        <Summary payload={data.payload} />

        {data.payload.sections.map((s) => (
          <Section key={s.category} section={s} />
        ))}

        <div className="mt-10 rounded-3xl bg-white p-8 shadow-[0_3px_30px_rgba(0,0,0,0.04)]">
          <h2 className="text-lg font-semibold tracking-tight">Bestätigung</h2>
          <p className="mt-2 text-sm text-black/60">
            Mit deiner Unterschrift bestätigst du, dass du die oben genannten
            Verstöße zur Kenntnis genommen hast. Anmerkungen kannst du im
            Feld unten festhalten.
          </p>

          <label className="mt-6 block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-black/60">Dein Name</span>
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-sm focus:border-[#0071e3] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
              placeholder="Vor- und Nachname"
            />
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-black/60">
              Anmerkung (optional)
            </span>
            <textarea
              rows={3}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white p-4 text-sm focus:border-[#0071e3] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
              placeholder="z.B. Verspätung wegen Stau bei Dresden, schon mit Disposition geklärt."
            />
          </label>

          <div className="mt-6">
            <span className="mb-1.5 block text-xs font-medium text-black/60">Unterschrift</span>
            <SignaturePad ref={sigRef} />
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <button
            onClick={onSubmit}
            disabled={submitting}
            className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0071e3] text-base font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-60"
          >
            {submitting ? <Spinner size="sm" /> : 'Unterschrift bestätigen'}
          </button>
          <p className="mt-3 text-center text-[11px] text-black/40">
            Hash: <code className="font-mono">{data.payload_hash.slice(0, 16)}…</code>
          </p>
        </div>
      </main>
    </div>
  );
}

function Summary({ payload }: { payload: PdfPayload }) {
  return (
    <div className="mt-6 grid gap-3 rounded-3xl bg-white p-6 shadow-[0_3px_30px_rgba(0,0,0,0.04)] md:grid-cols-3">
      <Stat
        icon={<FileText size={16} />}
        label="Verstöße gesamt"
        value={String(payload.summary.total)}
      />
      <Stat
        icon={<AlertTriangle size={16} />}
        label="Bußgeld Fahrer"
        value={fmtEuro(payload.summary.driver_fine_total_eur)}
      />
      <Stat
        icon={<RefreshCcw size={16} />}
        label="Bußgeld Unternehmen"
        value={fmtEuro(payload.summary.company_fine_total_eur)}
      />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#f5f5f7] p-4">
      <span className="grid size-9 place-items-center rounded-xl bg-white text-black/70">{icon}</span>
      <div>
        <div className="text-xs text-black/50">{label}</div>
        <div className="text-lg font-semibold tracking-tight">{value}</div>
      </div>
    </div>
  );
}

function Section({ section }: { section: PdfSection }) {
  return (
    <section className="mt-8 rounded-3xl bg-white p-8 shadow-[0_3px_30px_rgba(0,0,0,0.04)]">
      <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
      <ul className="mt-4 grid gap-3">
        {section.rows.map((row, i) => (
          <li key={`${row.rule_id}-${i}`} className="rounded-2xl bg-[#f5f5f7] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">{row.title}</div>
                <div className="mt-1 text-xs text-black/50">{row.legal_basis}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs uppercase tracking-wide text-black/40">{fmtUnit(row.unit)}</div>
                <div className="text-base font-semibold">
                  {fmt(row.measured_value)} <span className="text-black/40">/ {fmt(row.allowed_value)}</span>
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-black/70">{row.explanation}</p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-black/50">
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
  );
}

/* --------------------------- signature canvas -------------------------- */

interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toPng: () => string;
}

const SignaturePad = forwardRef<SignaturePadHandle>((_props, ref) => {
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
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d1d1f';
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
    <div className="rounded-2xl border border-dashed border-black/15 bg-[#fafafc] p-3">
      <canvas
        ref={canvasRef}
        className="h-48 w-full touch-none rounded-xl bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        aria-label="Unterschrift"
      />
      <div className="mt-2 flex justify-between text-xs text-black/50">
        <span>Mit dem Finger oder der Maus unterschreiben.</span>
        <button
          type="button"
          onClick={() => {
            const handle = (ref as React.MutableRefObject<SignaturePadHandle | null>).current;
            handle?.clear();
          }}
          className="hover:text-black"
        >
          Zurücksetzen
        </button>
      </div>
    </div>
  );
});
SignaturePad.displayName = 'SignaturePad';

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
