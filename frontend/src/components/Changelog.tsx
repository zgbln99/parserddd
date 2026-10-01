import { useState, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import { createPortal } from 'react-dom';

const CHANGELOG_VERSION = '2026-10-01';

const ENTRIES = [
  {
    version: '2026-10-01',
    items: [
      'Nowy wygląd: ciemny pasek nawigacji, jeden kolor akcentu, kolory tylko dla stanu',
      'Pulpit zaczyna od listy spraw do załatwienia z przyciskiem akcji',
      'Logowanie nazwą użytkownika i hasłem; hasło zmieniasz w panelu admina',
      'Liczby, godziny i tablice w czcionce o stałej szerokości cyfr',
      'Maut: podział pojazdu na 2 tury wg zakresu godzin',
      'Usunięte moduły: km kierowców, diagnostyka, wykroczenia jazdy, siatka zbiorcza, terminy pojazdów, karty paliwowe, km dzień/noc',
    ],
  },
];

export function Changelog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem('changelog-seen');
    if (seen !== CHANGELOG_VERSION) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem('changelog-seen', CHANGELOG_VERSION);
    setOpen(false);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="card relative w-full max-w-md rounded-2xl p-6 animate-scale-in">
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink"
        >
          <X size={18} />
        </button>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">Co nowego?</h2>
            <p className="text-xs text-muted">{CHANGELOG_VERSION}</p>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {ENTRIES.map((entry) => (
            <ul key={entry.version} className="space-y-2">
              {entry.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                  {item}
                </li>
              ))}
            </ul>
          ))}
        </div>

        <button
          onClick={handleClose}
          className="btn-press mt-5 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Super, rozumiem!
        </button>
      </div>
    </div>,
    document.body,
  );
}
