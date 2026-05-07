import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Lock, ArrowRight, MapPin, ShieldCheck, Users, Phone, Mail } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/Spinner';

/**
 * Public landing page for LTS Logistik GmbH.
 *
 * Goals:
 *  - Make the public face look like a normal logistics company website
 *    (so curious visitors don't see the dispatcher login as the front door).
 *  - Single CTA for prospective drivers ("Karriere") and a small
 *    "Mitarbeiter-Login" button that opens the password modal.
 *
 * Copy is intentionally generic-yet-credible German freight-forwarder
 * phrasing — replace with the operator's actual claims via simple text edits
 * (search for `// COPY:` markers below). No CMS, no JSON config — keep it
 * obvious for non-technical edits.
 */
export function LandingPage() {
  const [loginOpen, setLoginOpen] = useState(false);

  // Closing the modal on ESC + body scroll lock when open.
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
      <Stats />
      <Services />
      <Career onLogin={() => setLoginOpen(true)} />
      <Contact />
      <Footer />

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

/* ----------------------------- Navigation ------------------------------ */

function Nav({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-[#1d1d1f] text-white">
            <Truck size={16} />
          </span>
          <span>LTS Logistik GmbH</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-black/70 md:flex">
          <a href="#leistungen" className="hover:text-black">Leistungen</a>
          <a href="#karriere" className="hover:text-black">Karriere</a>
          <a href="#kontakt" className="hover:text-black">Kontakt</a>
        </nav>
        <button
          onClick={onLogin}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/15 px-4 py-1.5 text-sm font-medium text-black/80 transition hover:border-black/40 hover:text-black"
        >
          <Lock size={14} />
          Mitarbeiter-Login
        </button>
      </div>
    </header>
  );
}

/* --------------------------------- Hero -------------------------------- */

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-[#f5f5f7]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-[1.1fr,1fr] md:py-32">
        <div>
          {/* COPY: marquee headline */}
          <h1 className="text-5xl font-semibold leading-[1.07] tracking-[-0.5px] md:text-6xl">
            Logistik mit Substanz.
            <br />
            <span className="text-black/60">Termingerecht. Ohne Drama.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-black/70">
            {/* COPY: company short pitch */}
            Wir disponieren, fahren und liefern in ganz Europa — vom
            Direktverkehr bis zum täglichen Linienverkehr. Eigener Fuhrpark,
            eigene Fahrer, eine Disposition, die ans Telefon geht.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="#karriere"
              className="inline-flex items-center gap-2 rounded-full bg-[#0071e3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0077ed]"
            >
              Wir suchen Fahrer
              <ArrowRight size={16} />
            </a>
            <a
              href="#leistungen"
              className="inline-flex items-center gap-2 rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium text-black/80 transition hover:border-black/40 hover:text-black"
            >
              Mehr erfahren
            </a>
          </div>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-black">
          {/* Decorative truck silhouette built with CSS gradients to avoid
              shipping a stock photo. Designers can swap for a real photo. */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0c] via-[#1a1a1e] to-[#0a0a0c]" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
          <div className="absolute left-8 top-8 flex items-center gap-2 text-white/80 text-xs uppercase tracking-[0.2em]">
            <span className="size-1.5 rounded-full bg-[#0071e3] animate-pulse" />
            Live-Disposition aktiv
          </div>
          <div className="absolute bottom-8 left-8 right-8 text-white">
            <div className="text-3xl font-semibold tracking-tight">DE → PL → CZ</div>
            <div className="mt-1 text-sm text-white/60">Tagesverkehr, montags–freitags</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Stats -------------------------------- */

function Stats() {
  // COPY: hard numbers — replace with real ones the company publishes.
  const items = [
    { value: '120+', label: 'Sattelzüge im Einsatz' },
    { value: '24/7', label: 'Disposition erreichbar' },
    { value: '8', label: 'Standorte in Mitteleuropa' },
    { value: '99,2 %', label: 'Termintreue 2025' },
  ];
  return (
    <section className="border-y border-black/5 bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-16 md:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="text-center">
            <div className="text-4xl font-semibold tracking-tight">{it.value}</div>
            <div className="mt-2 text-sm text-black/60">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- Services -------------------------------- */

function Services() {
  // COPY: cards — keep three short, parallel descriptions.
  const cards = [
    {
      icon: <Truck size={20} />,
      title: 'Direktverkehr',
      text: 'Komplettladungen DE/PL/CZ/AT mit fester Ankunftszeit. Eigene Zugmaschinen, geprüfte Fahrer, durchgehende GPS-Verfolgung.',
    },
    {
      icon: <MapPin size={20} />,
      title: 'Linienverkehr',
      text: 'Tägliche Verbindungen zwischen unseren Hubs. Pünktlich abgefertigt, planbar abgerechnet, ohne versteckte Zuschläge.',
    },
    {
      icon: <ShieldCheck size={20} />,
      title: 'Compliance',
      text: 'Sozialvorschriften, Lenk- und Ruhezeiten, Mautabwicklung — sauber dokumentiert, prüfungsfest archiviert, behördentauglich.',
    },
  ];
  return (
    <section id="leistungen" className="bg-[#f5f5f7]">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <div className="text-sm font-medium uppercase tracking-[0.2em] text-black/50">
            Leistungen
          </div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Was wir machen — und was nicht.
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {cards.map((c) => (
            <article
              key={c.title}
              className="rounded-2xl bg-white p-8 shadow-[0_3px_30px_rgba(0,0,0,0.04)]"
            >
              <div className="grid size-10 place-items-center rounded-xl bg-[#1d1d1f] text-white">
                {c.icon}
              </div>
              <h3 className="mt-6 text-xl font-semibold tracking-tight">{c.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-black/70">{c.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Career --------------------------------- */

function Career({ onLogin: _onLogin }: { onLogin: () => void }) {
  return (
    <section id="karriere" className="bg-black text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-[1.2fr,1fr] md:py-32">
        <div>
          <div className="text-sm font-medium uppercase tracking-[0.2em] text-white/50">
            Karriere
          </div>
          <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Wir suchen Berufskraftfahrer C+E.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70">
            {/* COPY: career pitch */}
            Modernes Equipment, planbare Touren, faire Bezahlung pünktlich
            am Monatsersten. Du fährst, wir kümmern uns um den Rest —
            inklusive Tachographen-Auswertung und Sozialnachweis.
          </p>
          <ul className="mt-8 grid gap-3 text-sm md:grid-cols-2">
            {[
              'Festanstellung, unbefristet',
              'Moderne Mercedes Actros / MAN TGX',
              'Wochenende zu Hause (auf Wunsch)',
              'Auslöse + Spesen über Tarif',
              'Bezahlte Weiterbildungen (BKF / ADR)',
              'Disponenten, die ans Telefon gehen',
            ].map((b) => (
              <li key={b} className="flex items-center gap-2 text-white/80">
                <span className="size-1.5 rounded-full bg-[#0071e3]" />
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href="#kontakt"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/90"
            >
              Jetzt bewerben
              <ArrowRight size={16} />
            </a>
            <a
              href="mailto:karriere@ltslogistik.de"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-2.5 text-sm font-medium text-white/90 transition hover:border-white/60"
            >
              <Mail size={16} />
              karriere@ltslogistik.de
            </a>
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <div className="flex items-center gap-3 text-white/80">
            <Users size={18} />
            <span className="text-sm uppercase tracking-[0.2em]">Was Fahrer sagen</span>
          </div>
          <blockquote className="mt-6 text-lg leading-relaxed text-white">
            “Disposition ruft an, wenn was Neues kommt — nicht erst, wenn’s
            zu spät ist. Bezahlung kommt am 1. Klingt banal, ist es aber
            offenbar nicht.”
          </blockquote>
          <div className="mt-4 text-sm text-white/50">
            Marek, fährt für uns seit 2021
          </div>
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
            <a href="tel:+49000000000" className="inline-flex items-center gap-2 text-black/80 hover:text-black">
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
          </div>
        </div>
        <form
          className="rounded-2xl bg-[#f5f5f7] p-8"
          onSubmit={(e) => {
            // No backend yet; the form is a placeholder until the user
            // wires it up to a real inbox.
            e.preventDefault();
            alert('Vielen Dank — wir melden uns.');
          }}
        >
          <div className="grid gap-4">
            <input
              required
              placeholder="Name"
              className="h-11 rounded-xl border border-black/10 bg-white px-4 text-sm focus:border-[#0071e3] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
            />
            <input
              required
              type="email"
              placeholder="E-Mail"
              className="h-11 rounded-xl border border-black/10 bg-white px-4 text-sm focus:border-[#0071e3] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
            />
            <textarea
              required
              rows={4}
              placeholder="Worum geht es?"
              className="rounded-xl border border-black/10 bg-white p-4 text-sm focus:border-[#0071e3] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-black"
            >
              Nachricht senden
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

/* ------------------------------- Footer -------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-xs text-black/50 md:flex-row md:items-center md:justify-between">
        <div>© {new Date().getFullYear()} LTS Logistik GmbH</div>
        <div className="flex gap-6">
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
