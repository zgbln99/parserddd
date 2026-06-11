import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Clock, CreditCard, AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDashboard } from '../lib/api';

interface Alert {
  id: string;
  icon: typeof Bell;
  tone: 'red' | 'amber';
  text: string;
  to: string;
}

const POLL = 120_000;

export function NotificationCenter() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const load = () => {
      fetchDashboard()
        .then((d) => {
          const out: Alert[] = [];
          const overdue = (d.stale_drivers || []).filter(
            (s) => s.days_since === null || (s.days_since ?? 0) > 28,
          );
          if (overdue.length) {
            out.push({
              id: 'overdue',
              icon: Clock,
              tone: 'amber',
              text:
                locale === 'de'
                  ? `${overdue.length} Fahrer überfällig (Download)`
                  : `${overdue.length} kierowców zalega z pobraniem`,
              to: '/drivers',
            });
          }
          const expiring = (d.expiring_cards || []).filter((c) => c.days_left <= 90);
          if (expiring.length) {
            out.push({
              id: 'expiring',
              icon: CreditCard,
              tone: 'red',
              text:
                locale === 'de'
                  ? `${expiring.length} Karten laufen bald ab`
                  : `${expiring.length} kart wkrótce wygasa`,
              to: '/',
            });
          }
          if ((d.last_sync_errors || 0) > 0) {
            out.push({
              id: 'sync',
              icon: AlertTriangle,
              tone: 'red',
              text:
                locale === 'de'
                  ? `${d.last_sync_errors} Sync-Fehler`
                  : `${d.last_sync_errors} błędów synchronizacji`,
              to: '/sync',
            });
          }
          setAlerts(out);
        })
        .catch(() => {});
    };
    load();
    timer = setInterval(load, POLL);
    return () => clearInterval(timer);
  }, [locale]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const count = alerts.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-ink"
        title={locale === 'de' ? 'Benachrichtigungen' : 'Powiadomienia'}
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-xl animate-scale-in">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">
            {locale === 'de' ? 'Benachrichtigungen' : 'Powiadomienia'}
          </div>
          {count === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              {locale === 'de' ? 'Alles erledigt 🎉' : 'Wszystko ogarnięte 🎉'}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      navigate(a.to);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        a.tone === 'red' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'
                      }`}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="text-sm text-ink">{a.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
