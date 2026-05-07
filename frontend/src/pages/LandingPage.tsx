import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lock,
  ExternalLink,
  CheckCircle2,
  Phone,
  Mail,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/Spinner';

/**
 * Single-screen recruitment landing for LTS Logistik GmbH.
 *
 * Hard constraint: the page MUST fit in 100vh without scrolling on desktop.
 * Layout:
 *   ┌────────── header ──────────┐
 *   │ logo        login + .de    │
 *   ├────────────────────────────┤
 *   │  TEXT  │   TRUCK PHOTO     │
 *   │  CTA   │                   │
 *   ├────────────────────────────┤
 *   │ thin footer                │
 *   └────────────────────────────┘
 *
 * On <md the photo collapses to a small banner above the text and the page
 * is allowed to scroll, since one-screen layouts on phones almost always
 * end up with unreadable type sizes.
 *
 * Truck image: `public/landing-truck.jpg` if present, otherwise hot-linked
 * from Unsplash's CDN as a fallback. Drop your own JPG into `public/` to
 * override — no code change needed.
 */

const COMPANY_URL = 'https://www.ltslogistik.de';

// Mercedes Actros / commercial truck — Unsplash CDN, free for commercial use
// per their license. The local file in `public/` (if present) takes priority
// via the <img onError> fallback chain.
const UNSPLASH_TRUCK =
  'https://images.unsplash.com/photo-1601584115197-04ecc0da31ad?auto=format&fit=crop&w=1600&q=80';

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
    <div className="flex h-screen flex-col overflow-hidden bg-white text-[#1d1d1f] antialiased md:overflow-hidden">
      <Nav onLogin={() => setLoginOpen(true)} />
      <Main />
      <FooterBar />
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

/* ----------------------------- Navigation ------------------------------ */

function Nav({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="shrink-0 border-b border-black/5 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
          <span className="text-[15px]">LTS Logistik GmbH</span>
        </a>
        <div className="flex items-center gap-2">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-black/15 px-3.5 py-1.5 text-sm font-medium text-black/80 transition hover:border-black/40 hover:text-black sm:inline-flex"
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

/* --------------------------------- Main -------------------------------- */

function Main() {
  return (
    <main className="grid flex-1 min-h-0 grid-rows-[auto,1fr] overflow-y-auto md:grid-cols-[1fr,1.05fr] md:grid-rows-1 md:overflow-hidden">
      <TruckPhoto className="order-1 h-56 md:order-2 md:h-full" />
      <CopyPanel className="order-2 md:order-1" />
    </main>
  );
}

function CopyPanel({ className = '' }: { className?: string }) {
  return (
    <section
      className={`flex flex-col justify-center bg-[#f5f5f7] px-6 py-10 md:px-12 lg:px-16 ${className}`}
    >
      <div className="mx-auto w-full max-w-xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#0071e3]/25 bg-[#0071e3]/8 px-3 py-1 text-xs font-medium text-[#0071e3]">
          <span className="size-1.5 rounded-full bg-[#0071e3] animate-pulse" />
          Wir stellen ein
        </span>
        {/* COPY: recruitment headline */}
        <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.5px]">
          Berufskraftfahrer
          <br />
          <span className="text-[#0071e3]">C / CE</span>
          <span className="text-black/40"> gesucht.</span>
        </h1>
        {/* COPY: short pitch */}
        <p className="mt-4 max-w-md text-base leading-relaxed text-black/70">
          Festanstellung. Mercedes Actros. Pünktlicher Lohn am 1. eines
          jeden Monats. Disposition, die ans Telefon geht.
        </p>

        <ul className="mt-5 grid gap-1.5 text-sm text-black/75 sm:grid-cols-2">
          {[
            'Festanstellung, unbefristet',
            'Wochenende zu Hause',
            'Auslöse + Spesen über Tarif',
            'Bezahlte Module 95 / ADR',
          ].map((b) => (
            <li key={b} className="flex items-center gap-2">
              <CheckCircle2 size={14} className="shrink-0 text-[#34c759]" />
              {b}
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a
            href="tel:+490000000000"
            className="inline-flex items-center gap-2 rounded-full bg-[#0071e3] px-6 py-3 text-base font-medium text-white shadow-[0_8px_24px_rgba(0,113,227,0.28)] transition hover:bg-[#0077ed]"
          >
            <Phone size={17} />
            {/* COPY: phone number */}
            +49 (0) 00 00 00 00 0
          </a>
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-6 py-3 text-base font-medium text-black/80 transition hover:border-black/40 hover:text-black"
          >
            ltslogistik.de
            <ExternalLink size={15} />
          </a>
        </div>

        <a
          href="mailto:karriere@ltslogistik.de"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-black/55 hover:text-black"
        >
          <Mail size={13} />
          karriere@ltslogistik.de
        </a>
      </div>
    </section>
  );
}

/**
 * Truck photo panel.
 *
 * Image source priority:
 *   1. /landing-truck.jpg (drop a real photo into `public/`)
 *   2. Unsplash CDN (free, no API key)
 *   3. CSS gradient fallback if both fail (very rare)
 */
function TruckPhoto({ className = '' }: { className?: string }) {
  // Two-stage fallback: local file first, then Unsplash CDN, then a CSS
  // gradient so the page never shows a broken-image icon.
  const [stage, setStage] = useState<'local' | 'unsplash' | 'gradient'>('local');
  const src = stage === 'local' ? '/landing-truck.jpg' : UNSPLASH_TRUCK;

  return (
    <section
      className={`relative overflow-hidden bg-gradient-to-br from-[#0a0a0c] via-[#16181d] to-[#0a0a0c] ${className}`}
    >
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

      {/* darken bottom for legibility of the badge */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />

      {/* badge bottom-left */}
      <div className="absolute bottom-5 left-5 flex flex-wrap items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 text-xs text-white backdrop-blur">
        <span className="size-1.5 rounded-full bg-[#0071e3] animate-pulse" />
        Mercedes Actros · Eigene Flotte
      </div>

      {stage === 'gradient' && (
        <div className="absolute inset-0 grid place-items-center text-center text-white/60 text-xs px-4">
          <div>
            Bild konnte nicht geladen werden.<br />
            Lege eine Datei <code className="rounded bg-white/10 px-1">public/landing-truck.jpg</code> ab.
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------- Footer -------------------------------- */

function FooterBar() {
  return (
    <footer className="shrink-0 border-t border-black/5 bg-white">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-4 px-6 text-xs text-black/50">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-4 rounded" />
          <span>© {new Date().getFullYear()} LTS Logistik GmbH</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-black"
          >
            ltslogistik.de
          </a>
          <a href="#" className="hover:text-black">Impressum</a>
          <a href="#" className="hidden hover:text-black sm:inline">Datenschutz</a>
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

