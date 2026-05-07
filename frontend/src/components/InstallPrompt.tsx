import { useState, useEffect } from 'react';
import { X, Share } from 'lucide-react';

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
}

export function InstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIOS() || isStandalone()) return;
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) return;
    const timer = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem('pwa-install-dismissed', '1');
    setShow(false);
  };

  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 mx-auto max-w-sm animate-slide-up lg:bottom-4">
      <div className="flex items-start gap-3 rounded-xl border border-primary-200 bg-white/95 p-4 backdrop-blur-lg dark:border-primary-800 dark:bg-gray-900/95">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5750f1] text-white">
          <Share size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">Zainstaluj aplikację</p>
          <p className="mt-0.5 text-xs text-muted">
            Kliknij <Share size={12} className="inline mx-0.5" /> na dole ekranu, potem "Dodaj do ekranu głównego"
          </p>
        </div>
        <button onClick={dismiss} className="shrink-0 rounded-lg p-1 text-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
