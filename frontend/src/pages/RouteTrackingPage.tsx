import { useCallback, useEffect, useState } from 'react';
import { Route as RouteIcon, Plus, Copy, ExternalLink, Trash2, RefreshCw, Power } from 'lucide-react';
import { useI18n } from '../i18n';
import { Spinner } from '../components/Spinner';
import {
  fetchRouteShares,
  createRouteShare,
  toggleRouteShare,
  deleteRouteShare,
  fetchVehicleLocations,
  type RouteShare,
  type VehicleLocation,
} from '../lib/api';

export function RouteTrackingPage() {
  const { locale } = useI18n();
  const de = locale === 'de';

  const [shares, setShares] = useState<RouteShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleLocation[]>([]);

  // create form state
  const [fVeh, setFVeh] = useState('');
  const [fLabel, setFLabel] = useState('');
  const [fMode, setFMode] = useState<'live' | 'day'>('live');
  const [fHours, setFHours] = useState(24);
  const [fDay, setFDay] = useState('');
  const [fExpire, setFExpire] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchRouteShares()
      .then((r) => setShares(r.shares || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); };

  const openCreate = () => {
    setFVeh(''); setFLabel(''); setFMode('live'); setFHours(24); setFDay(''); setFExpire(0); setFormErr('');
    setShowCreate(true);
    if (vehicles.length === 0) {
      fetchVehicleLocations().then((r) => setVehicles(r.vehicles || [])).catch(() => {});
    }
  };

  const submit = () => {
    if (!fVeh) { setFormErr(de ? 'Fahrzeug wählen' : 'Wybierz pojazd'); return; }
    if (fMode === 'day' && !fDay) { setFormErr(de ? 'Tag wählen' : 'Wybierz dzień'); return; }
    const veh = vehicles.find((v) => v.vehicle_id === fVeh);
    setSaving(true); setFormErr('');
    createRouteShare({
      vehicle_id: fVeh,
      vehicle_name: veh?.vehicle_name || '',
      driver_name: veh?.driver_name || '',
      label: fLabel.trim(),
      hours: fMode === 'live' ? fHours : 24,
      day: fMode === 'day' ? fDay : '',
      expires_in_days: fExpire || 0,
    })
      .then(() => { setShowCreate(false); flash(de ? 'Link erstellt' : 'Link utworzony'); load(); })
      .catch((e) => setFormErr(e.message))
      .finally(() => setSaving(false));
  };

  const copy = (url: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => flash(de ? 'Link kopiert' : 'Skopiowano link'))
        .catch(() => window.prompt('URL', url));
    } else {
      window.prompt('URL', url);
    }
  };

  const onToggle = (s: RouteShare) => { toggleRouteShare(s.id, !s.enabled).then(load).catch((e) => flash(e.message)); };

  const onDelete = (s: RouteShare) => {
    const who = s.driver_name || s.label || s.vehicle_name || `#${s.id}`;
    if (!window.confirm(de ? `Link „${who}" löschen?` : `Usunąć link „${who}"?`)) return;
    deleteRouteShare(s.id).then(() => { flash(de ? 'Gelöscht' : 'Usunięto'); load(); }).catch((e) => flash(e.message));
  };

  return (
    <div className="animate-slide-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#6366f1] text-white">
            <RouteIcon size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{de ? 'Routenverfolgung' : 'Śledzenie tras'}</h1>
            <p className="text-xs text-muted">
              {de
                ? 'Öffentliche Links zum Verfolgen einer Fahrt — mit Verlauf & Adressen'
                : 'Publiczne linki do śledzenia trasy — z historią i adresami'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50">
            <RefreshCw size={15} /> {de ? 'Aktualisieren' : 'Odśwież'}
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-[#6366f1] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4f46e5]">
            <Plus size={16} /> {de ? 'Neuer Link' : 'Nowy link'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : shares.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted">
            {de
              ? 'Noch keine Links. Erstelle den ersten mit „Neuer Link".'
              : 'Brak linków. Utwórz pierwszy przyciskiem „Nowy link".'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">{de ? 'Fahrer / Beschr.' : 'Kierowca / opis'}</th>
                  <th className="px-4 py-3">{de ? 'Fahrzeug' : 'Pojazd'}</th>
                  <th className="px-4 py-3">{de ? 'Zeitraum' : 'Zakres'}</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">{de ? 'Aufrufe' : 'Wejścia'}</th>
                  <th className="px-4 py-3 text-right">{de ? 'Aktionen' : 'Akcje'}</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{s.driver_name || s.label || '—'}</div>
                      {s.label && s.driver_name && <div className="text-xs text-muted">{s.label}</div>}
                    </td>
                    <td className="px-4 py-3">{s.vehicle_name || s.vehicle_id}</td>
                    <td className="px-4 py-3">
                      {s.day ? s.day : (de ? `Letzte ${s.hours} Std` : `Ostatnie ${s.hours} h`)}
                    </td>
                    <td className="px-4 py-3">
                      {s.expired ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{de ? 'abgelaufen' : 'wygasł'}</span>
                      ) : s.enabled ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{de ? 'aktiv' : 'aktywny'}</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">{de ? 'aus' : 'wyłączony'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{s.access_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button title={de ? 'Link kopieren' : 'Kopiuj link'} onClick={() => copy(s.url)} className="rounded-md border p-1.5 hover:bg-gray-100"><Copy size={15} /></button>
                        <a title={de ? 'Öffnen' : 'Otwórz'} href={s.url} target="_blank" rel="noopener noreferrer" className="rounded-md border p-1.5 hover:bg-gray-100"><ExternalLink size={15} /></a>
                        <button title={s.enabled ? (de ? 'Deaktivieren' : 'Wyłącz') : (de ? 'Aktivieren' : 'Włącz')} onClick={() => onToggle(s)} className="rounded-md border p-1.5 hover:bg-gray-100">
                          <Power size={15} className={s.enabled ? 'text-green-600' : 'text-gray-400'} />
                        </button>
                        <button title={de ? 'Löschen' : 'Usuń'} onClick={() => onDelete(s)} className="rounded-md border border-red-200 p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="font-bold">{de ? 'Neuer Tracking-Link' : 'Nowy link śledzenia'}</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="space-y-4 px-5 py-4">
              {formErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formErr}</div>}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">{de ? 'Fahrzeug' : 'Pojazd'} *</label>
                <select value={fVeh} onChange={(e) => setFVeh(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">{vehicles.length ? (de ? '— wählen —' : '— wybierz —') : (de ? 'Lade…' : 'Ładowanie…')}</option>
                  {vehicles.map((v) => (
                    <option key={v.vehicle_id} value={v.vehicle_id}>
                      {v.vehicle_name}{v.driver_name ? ` — ${v.driver_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  {de ? 'Beschreibung' : 'Opis'} <span className="text-gray-400">({de ? 'optional' : 'opcjonalnie'})</span>
                </label>
                <input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder={de ? 'z.B. Lieferung #4521' : 'np. Dostawa #4521'} className="w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setFMode('live')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${fMode === 'live' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : ''}`}>
                  {de ? 'Live (letzte Std)' : 'Na żywo (ostatnie h)'}
                </button>
                <button type="button" onClick={() => setFMode('day')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${fMode === 'day' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : ''}`}>
                  {de ? 'Bestimmter Tag' : 'Konkretny dzień'}
                </button>
              </div>
              {fMode === 'live' ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">{de ? 'Verlauf (Stunden)' : 'Historia (godziny)'}</label>
                  <input type="number" min={1} max={168} value={fHours} onChange={(e) => setFHours(parseInt(e.target.value) || 24)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">{de ? 'Tag' : 'Dzień'}</label>
                  <input type="date" value={fDay} onChange={(e) => setFDay(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">{de ? 'Ablauf' : 'Wygaśnięcie'}</label>
                <select value={fExpire} onChange={(e) => setFExpire(parseInt(e.target.value))} className="w-full rounded-lg border px-3 py-2 text-sm">
                  <option value={0}>{de ? 'Nie (dauerhaft)' : 'Nigdy (na stałe)'}</option>
                  <option value={1}>1 {de ? 'Tag' : 'dzień'}</option>
                  <option value={7}>7 {de ? 'Tage' : 'dni'}</option>
                  <option value={30}>30 {de ? 'Tage' : 'dni'}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button onClick={() => setShowCreate(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">{de ? 'Abbrechen' : 'Anuluj'}</button>
              <button onClick={submit} disabled={saving} className="rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4f46e5] disabled:opacity-60">
                {saving ? '…' : (de ? 'Erstellen' : 'Utwórz')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">{toast}</div>
      )}
    </div>
  );
}
