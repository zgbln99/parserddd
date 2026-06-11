import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Clock, CreditCard, AlertTriangle, MapPin, Fuel } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDashboard, fetchVehicleLocations, fetchFuelCards } from '../lib/api';

// A truck standing this long during working hours is worth a look.
const STOP_ALERT_MIN = 180;

function isWorkingHours(): boolean {
  const now = new Date();
  const dow = now.getDay(); // 1–5 = Mon–Fri
  const h = now.getHours();
  return dow >= 1 && dow <= 5 && h >= 6 && h < 20;
}

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

  const [stopAlert, setStopAlert] = useState<Alert | null>(null);
  const [fuelAlert, setFuelAlert] = useState<Alert | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const load = () => {
      // Fuel cards expiring soon (active cards only).
      fetchFuelCards()
        .then((r) => {
          const soon = (r.cards || []).filter((c) => {
            if (c.status !== 'active' || !c.expiry_date) return false;
            const d = Math.floor((new Date(c.expiry_date + 'T23:59:59').getTime() - Date.now()) / 86_400_000);
            return d <= 45;
          });
          setFuelAlert(
            soon.length
              ? {
                  id: 'fuel',
                  icon: Fuel,
                  tone: 'amber',
                  text:
                    locale === 'de'
                      ? `${soon.length} Tankkarten laufen bald ab`
                      : `${soon.length} kart paliwowych wkrótce wygasa`,
                  to: '/fuel-cards',
                }
              : null,
          );
        })
        .catch(() => setFuelAlert(null));
      // Stop alert: trucks standing > STOP_ALERT_MIN during working hours.
      if (isWorkingHours()) {
        fetchVehicleLocations()
          .then((r) => {
            const stuck = (r.vehicles || []).filter(
              (v) => v.speed_kmh <= 5 && v.stopped_minutes != null && v.stopped_minutes >= STOP_ALERT_MIN,
            );
            if (stuck.length === 0) {
              setStopAlert(null);
              return;
            }
            const names = stuck.map((v) => v.vehicle_name).slice(0, 3).join(', ');
            const more = stuck.length > 3 ? ` +${stuck.length - 3}` : '';
            setStopAlert({
              id: 'stopped',
              icon: MapPin,
              tone: 'amber',
              text:
                locale === 'de'
                  ? `${stuck.length} Fzg. steht > 3 Std: ${names}${more}`
                  : `${stuck.length} poj. stoi > 3 h: ${names}${more}`,
              to: '/map',
            });
          })
          .catch(() => setStopAlert(null));
      } else {
        setStopAlert(null);
      }
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

  const allAlerts = [
    ...(stopAlert ? [stopAlert] : []),
    ...(fuelAlert ? [fuelAlert] : []),
    ...alerts,
  ];
  const count = allAlerts.length;

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
              {allAlerts.map((a) => {
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
