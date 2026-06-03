import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lock,
  ExternalLink,
  CheckCircle2,
  Phone,
  Mail,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/Spinner';

/**
 * Public recruitment landing for LTS Logistik GmbH — full-bleed photo with
 * glassmorphism overlay.
 *
 * Layout:
 *   - The truck photograph fills the entire viewport (object-cover, fixed
 *     position, behind everything).
 *   - A subtle dark gradient sits on top of the photo for legibility.
 *   - All content (headline, CTAs, benefits strip) lives inside frosted
 *     glass cards: bg-white/8-12, backdrop-blur-xl, white border at 12%.
 *   - Page is a single screen on desktop, light scroll on mobile.
 *
 * Image source priority:
 *   1. /landing-truck.jpg from `public/` (auto-served by Flask)
 *   2. Unsplash CDN (Mercedes Actros)
 *   3. CSS gradient + a small "drop your own JPG" hint
 */

const COMPANY_URL = 'https://www.ltslogistik.de';
// COPY: phone (tel: format + display)
const PHONE_TEL = '+493081722010';
const PHONE_HUMAN = '+49 30 81 72 20 10';
const MAIL_KARRIERE = 'info@ltslogistik.de';

const UNSPLASH_TRUCK =
  'https://images.unsplash.com/photo-1601584115197-04ecc0da31ad?auto=format&fit=crop&w=2400&q=85';

export function LandingPage() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [imgStage, setImgStage] = useState<'local' | 'unsplash' | 'gradient'>('local');

  useEffect(() => {
    if (!loginOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLoginOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [loginOpen]);

  const photoSrc = imgStage === 'local' ? '/landing-truck.jpg' : UNSPLASH_TRUCK;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0b0e] text-white antialiased">
      {/* full-bleed photo */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {imgStage !== 'gradient' ? (
          <img
            key={imgStage}
            src={photoSrc}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() =>
              setImgStage((s) => (s === 'local' ? 'unsplash' : 'gradient'))
            }
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-[#0a0b0e] via-[#16181d] to-[#0a0b0e]" />
        )}
        {/* darken + tint for legibility */}
        <div className="absolute inset-0 bg-gradient-to-br from-black/55 via-black/35 to-black/65" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
      </div>

      {/* foreground content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <Nav onLogin={() => setLoginOpen(true)} />
        <Hero />
        <FooterBar />
      </div>

      {imgStage === 'gradient' && (
        <div className="fixed bottom-4 left-4 z-20 max-w-xs rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-[11px] text-white/70 backdrop-blur-md">
          Bild fehlt. Lege{' '}
          <code className="rounded bg-white/10 px-1">public/landing-truck.jpg</code>{' '}
          ab.
        </div>
      )}

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

/* ----------------------------- Navigation ------------------------------ */

function Nav({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="shrink-0 border-b border-white/10 bg-black/15 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-6 lg:px-10">
        <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="/icon.svg" alt="" className="size-9 rounded-lg" />
          <span className="text-[15px]">LTS Logistik GmbH</span>
        </a>
        <nav className="hidden items-center gap-7 text-sm text-white/75 md:flex">
          <a href="#stelle" className="hover:text-white">Offene Stelle</a>
          <a href="#vorteile" className="hover:text-white">Was wir bieten</a>
          <a href={`tel:${PHONE_TEL}`} className="hover:text-white">Kontakt</a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-white/25 bg-white/8 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur-md transition hover:border-white/50 hover:bg-white/15 sm:inline-flex"
          >
            ltslogistik.de
            <ExternalLink size={13} />
          </a>
          <button
            onClick={onLogin}
            aria-label="Mitarbeiter-Login"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-1.5 text-sm font-semibold text-[#0a0b0e] transition hover:bg-white"
          >
            <Lock size={14} />
            <span className="hidden sm:inline">Mitarbeiter-Login</span>
          </button>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------- Hero -------------------------------- */

function Hero() {
  return (
    <section
      id="stelle"
      className="relative flex flex-1 items-center"
    >
      <div className="mx-auto grid w-full max-w-[1500px] gap-8 px-6 py-12 lg:grid-cols-[1.05fr,1fr] lg:gap-14 lg:px-10 lg:py-20">
        <CopyCard />
        <BenefitsCard />
      </div>
    </section>
  );
}

function CopyCard() {
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-white/15 bg-white/8 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-12"
    >
      {/* faint glow on the top-left corner of the glass */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-[#0071e3]/35 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-24 -right-20 h-72 w-72 rounded-full bg-[#34c759]/20 blur-[100px]" />

      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-md">
          <span className="size-1.5 rounded-full bg-[#0071e3] animate-pulse" />
          Wir stellen ein · Festanstellung
        </span>

        {/* COPY: recruitment headline */}
        <h1 className="mt-5 text-[clamp(2.4rem,4.8vw,4.5rem)] font-semibold leading-[1.04] tracking-[-0.02em] text-white">
          Berufskraftfahrer
          <br />
          <span className="text-[#7eb6ff]">C / CE</span>
          <span className="text-white/55"> gesucht.</span>
        </h1>

        <p className="mt-6 max-w-xl text-[clamp(1rem,1.4vw,1.2rem)] leading-relaxed text-white/80">
          {/* COPY: short pitch */}
          Mercedes Actros. Pünktlicher Lohn am 1. eines jeden Monats.
          Disposition, die ans Telefon geht. Wenn dir das wichtig ist —
          bist du hier richtig.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href={`tel:${PHONE_TEL}`}
            className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-semibold text-[#0a0b0e] shadow-[0_12px_32px_rgba(255,255,255,0.18)] transition hover:bg-white/95"
          >
            <Phone size={17} />
            {PHONE_HUMAN}
            <ArrowRight
              size={16}
              className="-mr-1 transition group-hover:translate-x-0.5"
            />
          </a>
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-7 py-3.5 text-base font-medium text-white backdrop-blur-md transition hover:border-white/50 hover:bg-white/15"
          >
            ltslogistik.de
            <ExternalLink size={15} />
          </a>
        </div>

        <a
          href={`mailto:${MAIL_KARRIERE}`}
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-white"
        >
          <Mail size={13} />
          {MAIL_KARRIERE}
        </a>
      </div>
    </div>
  );
}

function BenefitsCard() {
  // 4 benefits styled as small glass tiles inside one big glass panel.
  // The whole right column reads as a single liquid-glass piece.
  const items: { title: string; text: string }[] = [
    { title: 'Lohn am 1.', text: 'Pünktlich auf dem Konto. Jeden Monat.' },
    { title: 'Mercedes Actros', text: 'Moderne Zugmaschinen, Automatik, sauber.' },
    { title: 'Wochenende daheim', text: 'Auf Wunsch jedes Wochenende zu Hause.' },
    { title: 'Disposition mit Hirn', text: 'Wir gehen ans Telefon. Touren mit Verstand.' },
  ];

  return (
    <aside
      id="vorteile"
      className="relative overflow-hidden rounded-3xl border border-white/15 bg-white/8 p-8 backdrop-blur-2xl md:p-10"
    >
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/8 blur-[80px]" />

      <div className="relative">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-white/55">
          Was wir bieten
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
          Damit der Job sich lohnt.
        </h2>

        <ul className="mt-7 grid gap-3 sm:grid-cols-2">
          {items.map((it) => (
            <li
              key={it.title}
              className="rounded-2xl border border-white/12 bg-white/6 p-5 backdrop-blur-md transition hover:border-white/25 hover:bg-white/10"
            >
              <div className="flex items-start gap-2.5">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#7eb6ff]" />
                <div>
                  <div className="text-[15px] font-semibold text-white">{it.title}</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-white/70">
                    {it.text}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <a
          href={COMPANY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-white/85 hover:text-white"
        >
          Mehr auf ltslogistik.de
          <ExternalLink size={13} />
        </a>
      </div>
    </aside>
  );
}

/* ------------------------------- Footer -------------------------------- */

function FooterBar() {
  return (
    <footer className="shrink-0 border-t border-white/10 bg-black/25 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] flex-col items-start justify-between gap-3 px-6 py-5 text-xs text-white/60 sm:flex-row sm:items-center lg:px-10">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-5 rounded" />
          <span>© {new Date().getFullYear()} LTS Logistik GmbH</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-white/80 hover:text-white"
          >
            ltslogistik.de
          </a>
          <a href={`tel:${PHONE_TEL}`} className="hover:text-white">
            {PHONE_HUMAN}
          </a>
          <a href={`mailto:${MAIL_KARRIERE}`} className="hover:text-white">
            {MAIL_KARRIERE}
          </a>
          <a
            href={`${COMPANY_URL}/impressum`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white"
          >
            Impressum
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ----------------------------- Login Modal ----------------------------- */

function LoginModal({ onClose }: { onClose: () => void }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      onClose();
      navigate('/', { replace: true });
    } catch {
      setError('Falsches Passwort');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Glass panel for the modal itself, matches the rest of the page. */}
      <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-white/12 p-8 text-white backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/15 text-white border border-white/20">
            <Lock size={16} />
          </span>
          <div>
            <h2 id="login-modal-title" className="text-base font-semibold tracking-tight">
              Mitarbeiter-Login
            </h2>
            <p className="text-xs text-white/55">Nur für autorisiertes Personal.</p>
          </div>
        </div>
        <form className="mt-6 grid gap-4" onSubmit={onSubmit}>
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-medium text-white/60">Passwort</span>
            <input
              autoFocus
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/15 bg-white/8 px-4 text-sm text-white placeholder-white/40 focus:border-[#7eb6ff] focus:outline-none focus:ring-1 focus:ring-[#7eb6ff]"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-200">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-[#0a0b0e] transition hover:bg-white/95 disabled:opacity-60"
          >
            {loading ? <Spinner size="sm" /> : 'Anmelden'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-center text-xs text-white/55 hover:text-white"
          >
            Abbrechen
          </button>
        </form>
      </div>
    </div>
  );
}
