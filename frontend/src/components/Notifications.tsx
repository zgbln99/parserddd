import { useEffect, useState, useCallback } from 'react';
import { X, Bell, FileText } from 'lucide-react';
import { fetchDashboard } from '../lib/api';

/** Set PWA badge count (iOS 16.4+, Chrome) */
function setBadge(count: number) {
  try {
    if ('setAppBadge' in navigator) {
      if (count > 0) (navigator as any).setAppBadge(count);
      else (navigator as any).clearAppBadge();
    }
  } catch {}
}

/** Play a short notification sound */
export function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
    // Second beep
    setTimeout(() => {
      try {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1000;
        gain2.gain.value = 0.15;
        osc2.start();
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc2.stop(ctx.currentTime + 0.3);
      } catch {}
    }, 150);
  } catch {}
}

export function NewFilesNotification() {
  const [newCount, setNewCount] = useState(0);
  const [show, setShow] = useState(false);
  const [lastSync, setLastSync] = useState('');

  useEffect(() => {
    fetchDashboard()
      .then((data) => {
        const uploaded = data.last_sync_uploaded || 0;
        const syncTime = data.last_sync || '';
        const lastSeen = localStorage.getItem('last-seen-sync') || '';

        if (syncTime && syncTime !== lastSeen && uploaded > 0) {
          setNewCount(uploaded);
          setLastSync(syncTime);
          setShow(true);
          setBadge(uploaded);
        } else {
          setBadge(0);
        }
      })
      .catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    setShow(false);
    setBadge(0);
    if (lastSync) {
      localStorage.setItem('last-seen-sync', lastSync);
    }
  }, [lastSync]);

  if (!show || newCount === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-50 animate-slide-up max-w-sm">
      <div className="flex items-start gap-3 rounded-xl border border-primary-200 bg-white/95 p-4 backdrop-blur-lg dark:border-primary-800 dark:bg-gray-900/95">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0071e3] text-white">
          <Bell size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">
            {newCount} {newCount === 1 ? 'nowy plik' : 'nowe pliki'}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Pobrano z Samsary przy ostatnim sync
          </p>
        </div>
        <button onClick={dismiss} className="shrink-0 rounded-lg p-1 text-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
