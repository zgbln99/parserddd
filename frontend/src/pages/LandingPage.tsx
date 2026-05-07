import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lock,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  Truck,
  Wrench,
  Wallet,
  HeartHandshake,
  Calendar,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/Spinner';

/**
 * Public landing page for LTS Logistik GmbH.
 *
 * Targets two audiences in order of importance:
 *   1. Prospective C/CE drivers (recruitment) — the main goal of the page.
 *      Job ad sits in the hero, gets a dedicated section, and a final CTA.
 *   2. Curious B2B visitors / dispatch contacts.
 *
 * "Unsere Website" buttons link out to https://www.ltslogistik.de — this
 * page is a focused recruitment landing, the corporate site is canonical.
 *
 * Mitarbeiter-Login lives as a small pill in the nav and opens an in-page
 * modal so non-employees never see a "Login" page as the front door.
 *
 * Image strategy: the hero ships an inline SVG of a Mercedes-Actros-style
 * tractor unit so the page never renders a broken image. Replace with a
 * real photograph by dropping the file into `public/mercedes-actros.jpg`
 * and swapping the <TruckIllustration /> for an <img> tag (one-line edit).
 */

const COMPANY_URL = 'https://www.ltslogistik.de';

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
      <Recruitment />
      <Benefits />
      <Apply />
      <Contact />
      <Footer />

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

/* ----------------------------- Navigation ------------------------------ */

function Nav({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="/icon.svg" alt="" className="size-9 rounded-lg" />
          <span className="text-[15px]">LTS Logistik GmbH</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-black/70 md:flex">
          <a href="#stelle" className="hover:text-black">Offene Stelle</a>
          <a href="#leistungen" className="hover:text-black">Leistungen</a>
          <a href="#bewerben" className="hover:text-black">Bewerben</a>
          <a href="#kontakt" className="hover:text-black">Kontakt</a>
        </nav>
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

/* --------------------------------- Hero -------------------------------- */

function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-gradient-to-b from-[#f5f5f7] to-white"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-20 md:grid-cols-[1.05fr,1fr] md:pb-20 md:pt-28">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#0071e3]/20 bg-[#0071e3]/8 px-3 py-1 text-xs font-medium text-[#0071e3]">
            <span className="size-1.5 rounded-full bg-[#0071e3] animate-pulse" />
            Wir stellen ein
          </span>
          {/* COPY: recruitment headline */}
          <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-[-0.5px] md:text-6xl">
            Berufskraftfahrer
            <br />
            <span className="text-[#0071e3]">C / CE</span>
            <span className="text-black/40"> gesucht.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-black/70">
            {/* COPY: recruitment pitch */}
            Modernes Equipment, planbare Touren, faire Bezahlung — pünktlich
            am 1. eines jeden Monats. Werde Teil eines Teams, das den Job
            ernst nimmt und die Fahrer ebenso.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#bewerben"
              className="inline-flex items-center gap-2 rounded-full bg-[#0071e3] px-6 py-3 text-base font-medium text-white shadow-[0_8px_24px_rgba(0,113,227,0.3)] transition hover:bg-[#0077ed]"
            >
              Jetzt bewerben
              <ArrowRight size={18} />
            </a>
            <a
              href={COMPANY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-6 py-3 text-base font-medium text-black/80 transition hover:border-black/40 hover:text-black"
            >
              Mehr über uns
              <ExternalLink size={16} />
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-black/60">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-[#34c759]" /> Festanstellung
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-[#34c759]" /> Wochenende zu Hause
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-[#34c759]" /> Mercedes Actros
            </span>
          </div>
        </div>
        <TruckIllustration />
      </div>
    </section>
  );
}

/**
 * Mercedes-Actros-style truck illustration in pure SVG.
 *
 * No external image dependency — the page always renders. To swap in a real
 * photograph, replace the body of this component with:
 *
 *     <img src="/mercedes-actros.jpg" alt="Mercedes Actros" className="..." />
 *
 * and place the file in `frontend/public/`.
 */
function TruckIllustration() {
  return (
    <div className="relative aspect-[5/4] w-full overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0e0f12] via-[#16181d] to-[#0a0b0e] shadow-[0_30px_80px_rgba(0,0,0,0.18)]">
      {/* sky/highlight */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.06] to-transparent" />

      {/* road */}
      <div className="absolute inset-x-0 bottom-0 h-[18%] bg-gradient-to-b from-[#1a1c20] to-[#08090b]" />
      <div className="absolute inset-x-0 bottom-[14%] h-px bg-white/10" />

      <svg
        viewBox="0 0 600 480"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* trailer */}
        <g>
          <rect x="280" y="170" width="280" height="170" rx="6" fill="#fafafa" />
          <rect x="288" y="178" width="264" height="154" rx="4" fill="#f0f0f3" />
          <rect x="288" y="178" width="264" height="40" fill="#e6e6ec" />
          <text
            x="420"
            y="262"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
            fontSize="36"
            fontWeight={700}
            fill="#1d1d1f"
            letterSpacing="-1"
          >
            LTS LOGISTIK
          </text>
          <text
            x="420"
            y="296"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
            fontSize="14"
            fill="#1d1d1f"
            opacity="0.55"
            letterSpacing="3"
          >
            EUROPAWEIT · TÄGLICH
          </text>
          {/* trailer rivets */}
          {Array.from({ length: 6 }).map((_, i) => (
            <circle key={i} cx={300 + i * 50} cy="186" r="2" fill="#9ca3af" />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <circle key={i} cx={300 + i * 50} cy="324" r="2" fill="#9ca3af" />
          ))}
        </g>

        {/* connection */}
        <rect x="266" y="260" width="20" height="50" fill="#1d1d1f" />

        {/* tractor (Actros-style) */}
        <g>
          {/* main cab */}
          <path
            d="M 70 200 Q 70 160 100 160 L 220 160 Q 240 160 246 178 L 268 240 L 268 340 L 70 340 Z"
            fill="#0c52a8"
          />
          <path
            d="M 70 200 Q 70 160 100 160 L 220 160 Q 240 160 246 178 L 268 240 L 268 260 L 70 260 Z"
            fill="#0d63ce"
            opacity="0.6"
          />
          {/* roof */}
          <path
            d="M 100 160 L 100 130 Q 100 122 108 122 L 230 122 Q 244 122 248 138 L 248 160 Z"
            fill="#0a4a96"
          />
          {/* windshield */}
          <path
            d="M 110 168 L 232 168 L 252 220 L 110 220 Z"
            fill="#1d1d1f"
            opacity="0.92"
          />
          <path
            d="M 110 168 L 232 168 L 240 196 L 110 196 Z"
            fill="white"
            opacity="0.06"
          />
          {/* door & handle */}
          <rect x="96" y="232" width="58" height="80" rx="3" fill="#0a4a96" />
          <rect x="142" y="266" width="8" height="12" rx="2" fill="#1d1d1f" />
          {/* mirrors */}
          <rect x="84" y="170" width="14" height="34" rx="3" fill="#0a4a96" />
          <rect x="84" y="170" width="14" height="34" rx="3" fill="#1d1d1f" opacity="0.4" />
          {/* mercedes star (decorative) */}
          <circle cx="180" cy="280" r="14" fill="#0a4a96" stroke="white" strokeWidth="1.5" />
          <path
            d="M 180 270 L 180 290 M 180 280 L 188.66 285 M 180 280 L 171.34 285"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* headlight */}
          <rect x="252" y="250" width="14" height="22" rx="2" fill="#fef3c7" />
          {/* bumper */}
          <rect x="62" y="338" width="216" height="14" rx="3" fill="#1d1d1f" />
        </g>

        {/* wheels */}
        {[
          [120, 350],
          [220, 350],
          [340, 350],
          [410, 350],
          [490, 350],
          [550, 350],
        ].map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r="28" fill="#0a0b0e" />
            <circle cx={cx} cy={cy} r="22" fill="#1f2126" />
            <circle cx={cx} cy={cy} r="10" fill="#444851" />
            <circle cx={cx} cy={cy} r="3" fill="#1f2126" />
          </g>
        ))}

        {/* speed lines for motion */}
        <g opacity="0.25" stroke="white" strokeWidth="1.5" strokeLinecap="round">
          <line x1="20" y1="200" x2="60" y2="200" />
          <line x1="0" y1="230" x2="50" y2="230" />
          <line x1="20" y1="260" x2="60" y2="260" />
        </g>
      </svg>

      {/* bottom-right badge */}
      <div className="absolute bottom-5 right-5 flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white backdrop-blur">
        <Truck size={12} />
        Mercedes Actros · Eigene Flotte
      </div>
    </div>
  );
}

/* --------------------------- Recruitment hook -------------------------- */

function Recruitment() {
  return (
    <section id="stelle" className="border-y border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid items-center gap-12 md:grid-cols-[1fr,1.2fr]">
          <div>
            <div className="text-sm font-medium uppercase tracking-[0.2em] text-black/50">
              Offene Stelle
            </div>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Berufskraftfahrer C / CE (m/w/d)
            </h2>
            <p className="mt-4 text-base leading-relaxed text-black/70">
              {/* COPY: short JD pitch */}
              Festanstellung in Vollzeit. Eingespieltes Team, deutscher
              Arbeitgeber, moderne Mercedes-Actros-Fahrzeuge. Du fährst — wir
              kümmern uns um Disposition, Technik und den Papierkram.
            </p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {[
              { title: 'Führerschein C oder CE', text: 'Module 95 (BKF) und Fahrerkarte.' },
              { title: 'Tachograph-Erfahrung', text: 'Lenk- und Ruhezeiten kennst du im Schlaf.' },
              { title: 'Deutsch oder Polnisch', text: 'Disposition spricht beides — keine Sprachbarriere.' },
              { title: 'Saubere Arbeit', text: 'Pünktlichkeit, Ordnung im LKW, ehrlicher Umgang.' },
            ].map((req) => (
              <li
                key={req.title}
                className="rounded-2xl border border-black/8 bg-[#fafafc] p-5"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#0071e3]" />
                  <div>
                    <div className="font-medium">{req.title}</div>
                    <div className="mt-1 text-sm text-black/60">{req.text}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Benefits ------------------------------- */

function Benefits() {
  // COPY: keep parallel structure — six punchy benefit cards.
  const items = [
    {
      icon: <Wallet size={20} />,
      title: 'Pünktliche Bezahlung',
      text: 'Lohn am 1. eines jeden Monats auf dem Konto. Ohne Wenn und Aber.',
    },
    {
      icon: <Truck size={20} />,
      title: 'Moderne Flotte',
      text: 'Mercedes Actros der neuesten Generation. Automatik, gut gewartet, sauber.',
    },
    {
      icon: <Calendar size={20} />,
      title: 'Wochenende daheim',
      text: 'Auf Wunsch jedes Wochenende zu Hause. Du planst mit der Disposition vor.',
    },
    {
      icon: <Wrench size={20} />,
      title: 'Bezahlte Weiterbildung',
      text: 'Modul-95 und ADR-Schein zahlen wir. Du investierst nur deine Zeit.',
    },
    {
      icon: <ShieldCheck size={20} />,
      title: 'Auslöse + Spesen',
      text: 'Auslöse über Tarif, Mautkarte, Tankkarte — du legst nichts aus.',
    },
    {
      icon: <HeartHandshake size={20} />,
      title: 'Disposition mit Hirn',
      text: 'Wir gehen ans Telefon, planen realistisch und drehen Touren bei Stau.',
    },
  ];

  return (
    <section id="leistungen" className="bg-[#f5f5f7]">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <div className="text-sm font-medium uppercase tracking-[0.2em] text-black/50">
            Was wir bieten
          </div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Damit der Job sich lohnt.
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {items.map((it) => (
            <article
              key={it.title}
              className="rounded-2xl bg-white p-7 shadow-[0_3px_30px_rgba(0,0,0,0.04)]"
            >
              <div className="grid size-11 place-items-center rounded-xl bg-[#1d1d1f] text-white">
                {it.icon}
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-black/70">{it.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Apply -------------------------------- */

function Apply() {
  return (
    <section id="bewerben" className="bg-black text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 md:grid-cols-[1.2fr,1fr] md:py-28">
        <div>
          <div className="text-sm font-medium uppercase tracking-[0.2em] text-white/50">
            Bewerben
          </div>
          <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Drei Wege uns zu erreichen.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/70">
            Lebenslauf nicht zwingend nötig — wir telefonieren erst, schreiben
            danach. Ruf direkt an oder schreib uns auf WhatsApp.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href="tel:+490000000000"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-base font-medium text-black transition hover:bg-white/90"
            >
              <Phone size={18} />
              {/* COPY: phone number */}
              +49 (0) 00 00 00 00 0
            </a>
            <a
              href="mailto:karriere@ltslogistik.de"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3 text-base font-medium text-white/90 transition hover:border-white/60 hover:text-white"
            >
              <Mail size={18} />
              karriere@ltslogistik.de
            </a>
            <a
              href={COMPANY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3 text-base font-medium text-white/90 transition hover:border-white/60 hover:text-white"
            >
              ltslogistik.de
              <ExternalLink size={16} />
            </a>
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <div className="flex items-center gap-3 text-white/80">
            <HeartHandshake size={18} />
            <span className="text-sm uppercase tracking-[0.2em]">Was Fahrer sagen</span>
          </div>
          <blockquote className="mt-5 text-lg leading-relaxed text-white">
            &bdquo;Disposition ruft an, wenn was Neues kommt — nicht erst,
            wenn&apos;s zu spät ist. Bezahlung kommt am 1. Klingt banal, ist
            es aber offenbar nicht.&rdquo;
          </blockquote>
          <div className="mt-4 text-sm text-white/50">Marek, fährt für uns seit 2021</div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Contact -------------------------------- */

function Contact() {
  return (
    <section id="kontakt" className="bg-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-2">
        <div>
          <div className="text-sm font-medium uppercase tracking-[0.2em] text-black/50">
            Kontakt
          </div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Wir sind erreichbar.
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-black/70">
            Disposition Mo–Fr 06:00–20:00, Wochenende auf Notruf. Schreiben
            geht jederzeit — wir antworten innerhalb eines Werktages.
          </p>
          <div className="mt-8 grid gap-4 text-sm">
            <a href="tel:+490000000000" className="inline-flex items-center gap-2 text-black/80 hover:text-black">
              <Phone size={16} className="text-black/40" />
              +49 (0) 00 00 00 00 0
            </a>
            <a href="mailto:dispo@ltslogistik.de" className="inline-flex items-center gap-2 text-black/80 hover:text-black">
              <Mail size={16} className="text-black/40" />
              dispo@ltslogistik.de
            </a>
            <div className="inline-flex items-center gap-2 text-black/80">
              <MapPin size={16} className="text-black/40" />
              {/* COPY: address */}
              Musterstraße 1, 00000 Musterstadt
            </div>
            <a
              href={COMPANY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#0066cc] hover:underline"
            >
              <ExternalLink size={16} className="text-black/40" />
              www.ltslogistik.de
            </a>
          </div>
        </div>
        <a
          href={COMPANY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative overflow-hidden rounded-3xl bg-[#f5f5f7] p-10 transition hover:bg-[#eeeef1]"
        >
          <div className="text-sm font-medium uppercase tracking-[0.2em] text-black/50">
            Mehr Infos
          </div>
          <h3 className="mt-3 text-3xl font-semibold tracking-tight">
            Auf der offiziellen Website von LTS Logistik.
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-black/60">
            Aktuelle Tourenangebote, Standortübersicht, Pressemitteilungen
            und das Bewerbungsformular findest du unter{' '}
            <span className="text-[#0066cc]">ltslogistik.de</span>.
          </p>
          <span className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-[#0071e3] group-hover:underline">
            Zur Website <ArrowRight size={16} />
          </span>
        </a>
      </div>
    </section>
  );
}

/* ------------------------------- Footer -------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-xs text-black/50 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-5 rounded" />
          <span>© {new Date().getFullYear()} LTS Logistik GmbH</span>
        </div>
        <div className="flex flex-wrap gap-6">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-black"
          >
            ltslogistik.de
          </a>
          <a href="#" className="hover:text-black">Impressum</a>
          <a href="#" className="hover:text-black">Datenschutz</a>
          <a href="#" className="hover:text-black">AGB</a>
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
