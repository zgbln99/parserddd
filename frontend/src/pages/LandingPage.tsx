import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lock,
  ExternalLink,
  CheckCircle2,
  Phone,
  Mail,
  ArrowRight,
  Truck,
  Wallet,
  Calendar,
  HeartHandshake,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/Spinner';

/**
 * Public recruitment landing for LTS Logistik GmbH.
 *
 * Layout philosophy:
 *   - Designed for a single laptop screen at 1280×720+ but reads OK at any
 *     width — no `overflow-hidden` on the root, just compact vertical rhythm.
 *   - The hero is a proper full-bleed photograph, not a CSS rectangle.
 *   - Side-by-side hero + photo on >=lg, photo first on mobile.
 *   - 4-column "Was wir bieten" strip below the hero — same viewport, no
 *     long-form scroll. The corporate site at ltslogistik.de is canonical
 *     for everything else.
 *
 * Image strategy: drop a JPG into `public/landing-truck.jpg` and it wins.
 * Fallback chain: local file → Unsplash CDN → CSS gradient + instructions.
 */

const COMPANY_URL = 'https://www.ltslogistik.de';
const PHONE_TEL = '+490000000000';   // COPY: phone (tel: format)
const PHONE_HUMAN = '+49 (0) 00 00 00 00 0'; // COPY: phone (display)
const MAIL_KARRIERE = 'karriere@ltslogistik.de';

// Mercedes Actros / commercial truck — Unsplash CDN, free for commercial
// use under their license. Override by dropping public/landing-truck.jpg.
const UNSPLASH_TRUCK =
  'https://images.unsplash.com/photo-1601584115197-04ecc0da31ad?auto=format&fit=crop&w=2200&q=85';

export function LandingPage() {
  const [loginOpen, setLoginOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-white text-[#1d1d1f] antialiased">
      <Nav onLogin={() => setLoginOpen(true)} />
      <Hero />
      <BenefitsStrip />
      <FooterBar />
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

/* ----------------------------- Navigation ------------------------------ */

function Nav({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6 lg:px-10">
        <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="/icon.svg" alt="" className="size-9 rounded-lg" />
          <span className="text-[15px]">LTS Logistik GmbH</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-black/70 md:flex">
          <a href="#stelle" className="hover:text-black">Offene Stelle</a>
          <a href="#vorteile" className="hover:text-black">Was wir bieten</a>
          <a href={`tel:${PHONE_TEL}`} className="hover:text-black">Kontakt</a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-black/15 px-4 py-1.5 text-sm font-medium text-black/80 transition hover:border-black/40 hover:text-black sm:inline-flex"
          >
            ltslogistik.de
            <ExternalLink size={13} />
          </a>
          <button
            onClick={onLogin}
            aria-label="Mitarbeiter-Login"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1d1d1f] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-black"
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
      className="relative overflow-hidden bg-gradient-to-b from-[#f5f5f7] via-white to-white"
    >
      {/* Soft accent gradient floating in the background */}
      <div className="pointer-events-none absolute -top-40 right-0 h-[480px] w-[480px] rounded-full bg-[#0071e3]/[0.07] blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 left-1/3 h-[400px] w-[400px] rounded-full bg-[#34c759]/[0.06] blur-[110px]" />

      <div className="relative mx-auto grid max-w-[1400px] items-center gap-10 px-6 pb-16 pt-14 lg:grid-cols-[1fr,1.15fr] lg:gap-14 lg:px-10 lg:pb-20 lg:pt-20">
        <CopyColumn />
        <TruckPhoto />
      </div>
    </section>
  );
}

function CopyColumn() {
  return (
    <div>
      <span className="inline-flex items-center gap-2 rounded-full border border-[#0071e3]/25 bg-[#0071e3]/[0.08] px-3 py-1 text-xs font-medium text-[#0071e3]">
        <span className="size-1.5 rounded-full bg-[#0071e3] animate-pulse" />
        Wir stellen ein · Festanstellung
      </span>

      {/* COPY: recruitment headline */}
      <h1 className="mt-5 text-[clamp(2.4rem,5vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.02em]">
        Berufskraftfahrer
        <br />
        <span className="text-[#0071e3]">C / CE</span>
        <span className="text-black/40"> gesucht.</span>
      </h1>

      <p className="mt-6 max-w-xl text-[clamp(1rem,1.4vw,1.18rem)] leading-relaxed text-black/70">
        {/* COPY: short pitch */}
        Mercedes Actros. Pünktlicher Lohn am 1. eines jeden Monats.
        Disposition, die ans Telefon geht. Wenn dir das wichtig ist —
        bist du hier richtig.
      </p>

      <ul className="mt-7 grid max-w-xl gap-2.5 text-[15px] text-black/80 sm:grid-cols-2">
        {[
          'Festanstellung, unbefristet',
          'Wochenende zu Hause',
          'Auslöse + Spesen über Tarif',
          'Bezahlte Module 95 / ADR',
        ].map((b) => (
          <li key={b} className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-[#34c759]" />
            {b}
          </li>
        ))}
      </ul>

      <div className="mt-9 flex flex-wrap items-center gap-3">
        <a
          href={`tel:${PHONE_TEL}`}
          className="group inline-flex items-center gap-2 rounded-full bg-[#0071e3] px-7 py-3.5 text-base font-medium text-white shadow-[0_10px_28px_rgba(0,113,227,0.3)] transition hover:bg-[#0077ed]"
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
          className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-7 py-3.5 text-base font-medium text-black/80 transition hover:border-black/40 hover:text-black"
        >
          ltslogistik.de
          <ExternalLink size={15} />
        </a>
      </div>

      <a
        href={`mailto:${MAIL_KARRIERE}`}
        className="mt-5 inline-flex items-center gap-1.5 text-sm text-black/55 hover:text-black"
      >
        <Mail size={13} />
        {MAIL_KARRIERE}
      </a>
    </div>
  );
}

/**
 * Truck photo with a two-stage fallback chain.
 *
 *   1. /landing-truck.jpg from `public/`           ← drop your own file
 *   2. Unsplash CDN (Mercedes Actros)              ← works out of the box
 *   3. CSS gradient + instructions                 ← never broken-image icon
 */
function TruckPhoto() {
  const [stage, setStage] = useState<'local' | 'unsplash' | 'gradient'>('local');
  const src = stage === 'local' ? '/landing-truck.jpg' : UNSPLASH_TRUCK;

  return (
    <figure className="relative">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0a0b0e] via-[#16181d] to-[#0a0b0e] shadow-[0_30px_80px_rgba(0,0,0,0.18)] lg:aspect-[5/4]">
        {stage !== 'gradient' && (
          <img
            src={src}
            alt="Mercedes Actros — LTS Logistik Flotte"
            loading="eager"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() =>
              setStage((s) => (s === 'local' ? 'unsplash' : 'gradient'))
            }
          />
        )}

        {/* darken bottom for legibility */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

        {/* small live-pill bottom-left */}
        <div className="absolute bottom-5 left-5 flex flex-wrap items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 text-xs text-white backdrop-blur">
          <span className="size-1.5 rounded-full bg-[#0071e3] animate-pulse" />
          Mercedes Actros · Eigene Flotte
        </div>

        {/* big stat bottom-right (only when image loaded) */}
        {stage !== 'gradient' && (
          <div className="absolute right-5 top-5 hidden rounded-2xl bg-black/40 px-4 py-3 text-right text-white backdrop-blur md:block">
            <div className="text-3xl font-semibold tracking-tight">
              {/* COPY: vehicle count */}
              120+
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">
              Sattelzüge im Einsatz
            </div>
          </div>
        )}

        {stage === 'gradient' && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-white/65 text-sm leading-relaxed">
            <div>
              Bild konnte nicht geladen werden.<br />
              Lege eine Datei{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5">
                public/landing-truck.jpg
              </code>{' '}
              ab.
            </div>
          </div>
        )}
      </div>
      <figcaption className="sr-only">
        Mercedes Actros — eigene Flotte von LTS Logistik
      </figcaption>
    </figure>
  );
}

/* ---------------------------- Benefits strip --------------------------- */

function BenefitsStrip() {
  // 4 cards — one viewport's worth of additional information without the
  // page becoming a full marketing site.
  const items = [
    {
      icon: <Wallet size={18} />,
      title: 'Lohn am 1.',
      text: 'Pünktlich auf dem Konto. Jeden Monat. Ohne Wenn und Aber.',
    },
    {
      icon: <Truck size={18} />,
      title: 'Mercedes Actros',
      text: 'Moderne Zugmaschinen, Automatik, gut gewartet, sauber.',
    },
    {
      icon: <Calendar size={18} />,
      title: 'Wochenende daheim',
      text: 'Auf Wunsch jedes Wochenende zu Hause. Wir planen vor.',
    },
    {
      icon: <HeartHandshake size={18} />,
      title: 'Disposition mit Hirn',
      text: 'Wir gehen ans Telefon und drehen Touren bei Stau.',
    },
  ];

  return (
    <section
      id="vorteile"
      className="border-t border-black/5 bg-[#f5f5f7]"
    >
      <div className="mx-auto max-w-[1400px] px-6 py-12 lg:px-10 lg:py-16">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight md:text-[28px]">
            Was wir bieten.
          </h2>
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0066cc] hover:underline"
          >
            Mehr auf ltslogistik.de
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <article
              key={it.title}
              className="rounded-2xl bg-white p-6 shadow-[0_3px_24px_rgba(0,0,0,0.04)] transition hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)]"
            >
              <div className="grid size-10 place-items-center rounded-xl bg-[#1d1d1f] text-white">
                {it.icon}
              </div>
              <h3 className="mt-4 text-base font-semibold tracking-tight">
                {it.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-black/65">
                {it.text}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Footer -------------------------------- */

function FooterBar() {
  return (
    <footer className="border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-3 px-6 py-6 text-xs text-black/55 sm:flex-row sm:items-center lg:px-10">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-5 rounded" />
          <span>© {new Date().getFullYear()} LTS Logistik GmbH</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-black/70 hover:text-black"
          >
            ltslogistik.de
          </a>
          <a href={`tel:${PHONE_TEL}`} className="hover:text-black">
            {PHONE_HUMAN}
          </a>
          <a href={`mailto:${MAIL_KARRIERE}`} className="hover:text-black">
            {MAIL_KARRIERE}
          </a>
          <a href="#" className="hover:text-black">Impressum</a>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[0_30px_80px_rgba(0,0,0,0.18)]">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#1d1d1f] text-white">
            <Lock size={16} />
          </span>
          <div>
            <h2 id="login-modal-title" className="text-base font-semibold tracking-tight">
              Mitarbeiter-Login
            </h2>
            <p className="text-xs text-black/50">Nur für autorisiertes Personal.</p>
          </div>
        </div>
        <form className="mt-6 grid gap-4" onSubmit={onSubmit}>
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-medium text-black/60">Passwort</span>
            <input
              autoFocus
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-sm focus:border-[#0071e3] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0071e3] text-sm font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-60"
          >
            {loading ? <Spinner size="sm" /> : 'Anmelden'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-center text-xs text-black/50 hover:text-black"
          >
            Abbrechen
          </button>
        </form>
      </div>
    </div>
  );
}
