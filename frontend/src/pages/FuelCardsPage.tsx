import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreditCard, Search, Plus, Pencil, Trash2, AlertTriangle, Fuel, Truck, PackageOpen,
  Layers, CheckCircle2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import {
  fetchFuelCards, createFuelCard, updateFuelCard, deleteFuelCard, bulkCreateFuelCards,
  fetchSamsaraVehicles,
  type FuelCard, type FuelCardPayload, type SamsaraVehicle, type BulkFuelCardResult,
} from '../lib/api';

/**
 * Fuel cards module — number, provider, limit, assigned vehicle, expiry,
 * status. Built for a fleet-wide card swap: 'ordered' cards are tracked
 * next to the 'active' ones they will replace.
 */

const EMPTY: FuelCardPayload = {
  card_number: '',
  provider: '',
  vehicle_name: '',
  driver_name: '',
  monthly_limit_eur: 0,
  expiry_date: '',
  status: 'active',
  notes: '',
};

type BulkForm = {
  provider: string;
  cards: string;
  no_driver: boolean;
  driver_name: string;
  vehicle_name: string;
  monthly_limit_eur: number;
  expiry_date: string;
  status: FuelCard['status'];
  notes: string;
};

const EMPTY_BULK: BulkForm = {
  provider: '',
  cards: '',
  no_driver: true,
  driver_name: '',
  vehicle_name: '',
  monthly_limit_eur: 0,
  expiry_date: '',
  status: 'active',
  notes: '',
};

function daysToExpiry(expiry: string): number | null {
  if (!expiry) return null;
  const d = new Date(expiry + 'T23:59:59');
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86_400_000);
}

export function FuelCardsPage() {
  const { locale } = useI18n();
  const de = locale === 'de';

  const [cards, setCards] = useState<FuelCard[]>([]);
  const [vehicles, setVehicles] = useState<SamsaraVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | FuelCard['status']>('all');

  // modal form
  const [editing, setEditing] = useState<FuelCard | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FuelCardPayload>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // bulk import modal
  const [showBulk, setShowBulk] = useState(false);
  const [bulk, setBulk] = useState<BulkForm>(EMPTY_BULK);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkResult, setBulkResult] = useState<BulkFuelCardResult | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchFuelCards()
      .then((r) => { setCards(r.cards || []); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetchSamsaraVehicles()
      .then((r) => setVehicles((r.vehicles || []).filter(v => !v.name.toLowerCase().startsWith('deactivated'))))
      .catch(() => {});
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return cards.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.card_number.toLowerCase().includes(q) ||
        c.provider.toLowerCase().includes(q) ||
        c.vehicle_name.toLowerCase().includes(q) ||
        c.driver_name.toLowerCase().includes(q)
      );
    });
  }, [cards, search, statusFilter]);

  const stats = useMemo(() => ({
    total: cards.length,
    active: cards.filter((c) => c.status === 'active').length,
    ordered: cards.filter((c) => c.status === 'ordered').length,
    expiring: cards.filter((c) => {
      const d = daysToExpiry(c.expiry_date);
      return c.status === 'active' && d != null && d <= 60;
    }).length,
  }), [cards]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (c: FuelCard) => {
    setEditing(c);
    setForm({
      card_number: c.card_number,
      provider: c.provider,
      vehicle_name: c.vehicle_name,
      driver_name: c.driver_name,
      monthly_limit_eur: c.monthly_limit_eur,
      expiry_date: c.expiry_date,
      status: c.status,
      notes: c.notes,
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.card_number.trim()) return;
    setSaving(true);
    setFormError('');
    try {
      if (editing) await updateFuelCard(editing.id, form);
      else await createFuelCard(form);
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const openBulk = () => {
    setBulk(EMPTY_BULK);
    setBulkError('');
    setBulkResult(null);
    setShowBulk(true);
  };

  const bulkCount = useMemo(
    () => bulk.cards.split('\n').map((s) => s.trim()).filter(Boolean).length,
    [bulk.cards],
  );

  const handleBulkSave = async () => {
    const cards = bulk.cards.split('\n').map((s) => s.trim()).filter(Boolean);
    if (cards.length === 0) {
      setBulkError(de ? 'Bitte mindestens eine Karte eingeben.' : 'Wpisz przynajmniej jedną kartę.');
      return;
    }
    setBulkSaving(true);
    setBulkError('');
    setBulkResult(null);
    try {
      const res = await bulkCreateFuelCards({
        provider: bulk.provider.trim(),
        driver_name: bulk.no_driver ? '' : bulk.driver_name.trim(),
        vehicle_name: bulk.vehicle_name.trim(),
        monthly_limit_eur: bulk.monthly_limit_eur || 0,
        expiry_date: bulk.expiry_date,
        status: bulk.status,
        notes: bulk.notes.trim(),
        cards,
      });
      setBulkResult(res);
      setBulk((b) => ({ ...b, cards: '' }));
      load();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDelete = async (c: FuelCard) => {
    if (!window.confirm(de ? `Karte ${c.card_number} löschen?` : `Usunąć kartę ${c.card_number}?`)) return;
    try {
      await deleteFuelCard(c.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const statusBadge = (s: FuelCard['status']) => {
    if (s === 'active') return <Badge variant="green">{de ? 'Aktiv' : 'Aktywna'}</Badge>;
    if (s === 'ordered') return <Badge variant="blue">{de ? 'Bestellt' : 'Zamówiona'}</Badge>;
    return <Badge variant="red">{de ? 'Gesperrt' : 'Zablokowana'}</Badge>;
  };

  const expiryCell = (c: FuelCard) => {
    if (!c.expiry_date) return <span className="text-muted">—</span>;
    const d = daysToExpiry(c.expiry_date);
    const cls = d == null ? '' : d < 0 ? 'text-danger font-bold' : d <= 30 ? 'text-danger font-semibold' : d <= 60 ? 'text-warning font-semibold' : 'text-muted';
    return (
      <span className={`inline-flex items-center gap-1 ${cls}`}>
        {d != null && d <= 60 && <AlertTriangle size={12} />}
        {c.expiry_date}
        {d != null && <span className="text-[11px]">({d < 0 ? (de ? 'abgelaufen' : 'wygasła') : `${d} d`})</span>}
      </span>
    );
  };

  const statusFilters: { key: typeof statusFilter; label: string }[] = [
    { key: 'all', label: de ? 'Alle' : 'Wszystkie' },
    { key: 'active', label: de ? 'Aktiv' : 'Aktywne' },
    { key: 'ordered', label: de ? 'Bestellt' : 'Zamówione' },
    { key: 'blocked', label: de ? 'Gesperrt' : 'Zablokowane' },
  ];

  return (
    <div className="animate-slide-up space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#fbbf24] to-[#f59e0b] text-white">
          <Fuel size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{de ? 'Tankkarten' : 'Karty paliwowe'}</h1>
          <p className="text-xs text-muted">{de ? 'Nummern, Limits, Fahrzeuge, Ablaufdaten' : 'Numery, limity, pojazdy, terminy ważności'}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={de ? 'Karten gesamt' : 'Wszystkie karty'} value={stats.total} icon={<CreditCard size={20} />} color="primary" />
        <StatCard label={de ? 'Aktiv' : 'Aktywne'} value={stats.active} icon={<Truck size={20} />} color="green" />
        <StatCard label={de ? 'Bestellt' : 'Zamówione'} value={stats.ordered} icon={<PackageOpen size={20} />} color="blue" />
        <StatCard label={de ? 'Läuft ab ≤ 60 T.' : 'Wygasa ≤ 60 dni'} value={stats.expiring} icon={<AlertTriangle size={20} />} color={stats.expiring > 0 ? 'red' : 'green'} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={de ? 'Nummer, Fahrzeug, Anbieter…' : 'Numer, pojazd, dostawca…'}
            className="input w-full rounded-xl py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex gap-1.5">
          {statusFilters.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === key
                  ? 'bg-primary-600 text-white'
                  : 'border border-border text-muted hover:bg-surface'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={openBulk}
          className="btn-press inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface"
        >
          <Layers size={15} />
          {de ? 'Massenimport' : 'Masowe dodawanie'}
        </button>
        <button
          onClick={openCreate}
          className="btn-primary btn-press inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={15} />
          {de ? 'Karte hinzufügen' : 'Dodaj kartę'}
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Fuel size={26} />}
            title={de ? 'Keine Tankkarten' : 'Brak kart paliwowych'}
            hint={de ? 'Fügen Sie die erste Karte hinzu.' : 'Dodaj pierwszą kartę.'}
            action={
              <button onClick={openCreate} className="btn-primary btn-press inline-flex items-center gap-2 px-4 py-2 text-sm">
                <Plus size={15} /> {de ? 'Karte hinzufügen' : 'Dodaj kartę'}
              </button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Mobile cards */}
          <div className="divide-y divide-border sm:hidden">
            {filtered.map((c) => (
              <div key={c.id} className="p-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold">{c.card_number}</span>
                  {statusBadge(c.status)}
                </div>
                <div className="space-y-0.5 text-xs text-muted">
                  {c.provider && <p>{c.provider}</p>}
                  {c.vehicle_name && <p>🚛 {c.vehicle_name}{c.driver_name ? ` · ${c.driver_name}` : ''}</p>}
                  {c.monthly_limit_eur > 0 && <p>{de ? 'Limit' : 'Limit'}: <b className="text-ink">{c.monthly_limit_eur.toFixed(0)} €</b></p>}
                  <p>{expiryCell(c)}</p>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => openEdit(c)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface">
                    <Pencil size={12} className="inline" /> {de ? 'Bearbeiten' : 'Edytuj'}
                  </button>
                  <button onClick={() => handleDelete(c)} className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-300">
                    <Trash2 size={12} className="inline" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-black/[0.02] dark:bg-white/5">
                  {[
                    de ? 'Kartennummer' : 'Numer karty',
                    de ? 'Anbieter' : 'Dostawca',
                    de ? 'Fahrzeug' : 'Pojazd',
                    de ? 'Fahrer' : 'Kierowca',
                    'Limit €',
                    de ? 'Gültig bis' : 'Ważna do',
                    'Status',
                    '',
                  ].map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition hover:bg-primary-50/40 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-ink">{c.card_number}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{c.provider || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{c.vehicle_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{c.driver_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono">
                      {c.monthly_limit_eur > 0 ? c.monthly_limit_eur.toFixed(0) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{expiryCell(c)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{statusBadge(c.status)}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right">
                      <button onClick={() => openEdit(c)} className="rounded-lg p-1.5 text-muted transition hover:bg-primary-50 hover:text-primary-600" title={de ? 'Bearbeiten' : 'Edytuj'}>
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(c)} className="rounded-lg p-1.5 text-muted transition hover:bg-red-500/10 hover:text-red-500" title={de ? 'Löschen' : 'Usuń'}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create / edit modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? (de ? 'Karte bearbeiten' : 'Edytuj kartę') : (de ? 'Neue Tankkarte' : 'Nowa karta paliwowa')}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Kartennummer *' : 'Numer karty *'}</span>
              <input
                type="text"
                value={form.card_number}
                onChange={(e) => setForm({ ...form, card_number: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm font-mono"
                placeholder="7088 0012 3456 7890"
                autoFocus
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Anbieter' : 'Dostawca'}</span>
              <input
                type="text"
                list="fuel-providers"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
                placeholder="Hoyer / Aral / Star…"
              />
              <datalist id="fuel-providers">
                {['Hoyer', 'Aral', 'Star', 'DKV', 'UTA', 'Shell', 'E100', 'Orlen'].map((p) => <option key={p} value={p} />)}
              </datalist>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Fahrzeug' : 'Pojazd'}</span>
              <input
                type="text"
                list="fuel-vehicles"
                value={form.vehicle_name}
                onChange={(e) => setForm({ ...form, vehicle_name: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
              />
              <datalist id="fuel-vehicles">
                {vehicles.map((v) => <option key={v.id} value={v.name}>{v.license_plate}</option>)}
              </datalist>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Fahrer' : 'Kierowca'}</span>
              <input
                type="text"
                value={form.driver_name}
                onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Monatslimit (€)' : 'Limit miesięczny (€)'}</span>
              <input
                type="number"
                min={0}
                step={50}
                value={form.monthly_limit_eur || ''}
                onChange={(e) => setForm({ ...form, monthly_limit_eur: Number(e.target.value) || 0 })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Gültig bis' : 'Ważna do'}</span>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm dark:[color-scheme:dark]"
              />
            </label>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-muted">Status</span>
            <div className="flex gap-1.5">
              {(['active', 'ordered', 'blocked'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, status: s })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    form.status === s ? 'bg-primary-600 text-white' : 'border border-border text-muted hover:bg-surface'
                  }`}
                >
                  {s === 'active' ? (de ? 'Aktiv' : 'Aktywna') : s === 'ordered' ? (de ? 'Bestellt' : 'Zamówiona') : (de ? 'Gesperrt' : 'Zablokowana')}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Notizen' : 'Notatki'}</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="input w-full rounded-xl px-3 py-2 text-sm"
            />
          </label>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface">
              {de ? 'Abbrechen' : 'Anuluj'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.card_number.trim()}
              className="btn-primary btn-press px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {saving ? <Spinner size="sm" /> : (de ? 'Speichern' : 'Zapisz')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk import modal — many cards for one provider at once */}
      <Modal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        title={de ? 'Tankkarten – Massenimport' : 'Karty paliwowe – masowe dodawanie'}
      >
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {de
              ? 'Eine Karte pro Zeile. Es zählt die Kartennummer bzw. der Kartenname – ein Kennzeichen ist nicht nötig. Anbieter und die Felder unten gelten für alle Karten der Liste.'
              : 'Jedna karta na linię. Wpisz numer lub nazwę karty – tablica rejestracyjna nie jest wymagana. Dostawca i pola poniżej zostaną przypisane do wszystkich kart z listy.'}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Anbieter (für alle)' : 'Dostawca (dla wszystkich)'}</span>
              <input
                type="text"
                list="fuel-providers"
                value={bulk.provider}
                onChange={(e) => setBulk({ ...bulk, provider: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
                placeholder="Hoyer / Aral / Star…"
              />
            </label>
            <div className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">Status</span>
              <div className="flex gap-1.5">
                {(['active', 'ordered', 'blocked'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBulk({ ...bulk, status: s })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      bulk.status === s ? 'bg-primary-600 text-white' : 'border border-border text-muted hover:bg-surface'
                    }`}
                  >
                    {s === 'active' ? (de ? 'Aktiv' : 'Aktywna') : s === 'ordered' ? (de ? 'Bestellt' : 'Zamówiona') : (de ? 'Gesperrt' : 'Zablokowana')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="block text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {de ? 'Kartennummern / -namen (eine pro Zeile)' : 'Numery / nazwy kart (jedna na linię)'}
              </span>
              {bulkCount > 0 && (
                <span className="text-xs font-semibold text-primary-600">
                  {bulkCount} {de ? 'Karten' : 'kart'}
                </span>
              )}
            </div>
            <textarea
              value={bulk.cards}
              onChange={(e) => setBulk({ ...bulk, cards: e.target.value })}
              rows={7}
              className="input w-full rounded-xl px-3 py-2 font-mono text-sm"
              placeholder={
                de
                  ? 'Karte-A\nKarte-B\n7088 0012 3456 7890\n\n(optional pro Zeile: Karte ; Fahrer ; Fahrzeug)'
                  : 'Karta-A\nKarta-B\n7088 0012 3456 7890\n\n(opcjonalnie w linii: Karta ; Kierowca ; Pojazd)'
              }
              autoFocus
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bulk.no_driver}
              onChange={(e) => setBulk({ ...bulk, no_driver: e.target.checked })}
              className="h-4 w-4 rounded border-border"
            />
            <span className="font-medium text-ink">{de ? 'Keine Fahrerzuordnung' : 'Bez przypisania do kierowcy'}</span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`text-sm ${bulk.no_driver ? 'opacity-50' : ''}`}>
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Fahrer (für alle)' : 'Kierowca (dla wszystkich)'}</span>
              <input
                type="text"
                value={bulk.driver_name}
                disabled={bulk.no_driver}
                onChange={(e) => setBulk({ ...bulk, driver_name: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed"
                placeholder={de ? 'optional' : 'opcjonalnie'}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Fahrzeug (für alle)' : 'Pojazd (dla wszystkich)'}</span>
              <input
                type="text"
                list="fuel-vehicles"
                value={bulk.vehicle_name}
                onChange={(e) => setBulk({ ...bulk, vehicle_name: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
                placeholder={de ? 'optional' : 'opcjonalnie'}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Monatslimit (€)' : 'Limit miesięczny (€)'}</span>
              <input
                type="number"
                min={0}
                step={50}
                value={bulk.monthly_limit_eur || ''}
                onChange={(e) => setBulk({ ...bulk, monthly_limit_eur: Number(e.target.value) || 0 })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
                placeholder={de ? 'optional' : 'opcjonalnie'}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Gültig bis' : 'Ważna do'}</span>
              <input
                type="date"
                value={bulk.expiry_date}
                onChange={(e) => setBulk({ ...bulk, expiry_date: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm dark:[color-scheme:dark]"
              />
            </label>
          </div>

          {bulkResult && (
            <div className="flex items-start gap-2 rounded-xl bg-green-500/10 px-4 py-2.5 text-sm text-green-700 dark:text-green-300">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <span>
                {de ? 'Hinzugefügt' : 'Dodano'}: <b>{bulkResult.inserted}</b>
                {bulkResult.skipped_duplicates > 0 && (
                  <> · {de ? 'übersprungen (Duplikate)' : 'pominięto (duplikaty)'}: <b>{bulkResult.skipped_duplicates}</b></>
                )}
              </span>
            </div>
          )}
          {bulkError && <p className="text-sm text-danger">{bulkError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowBulk(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface">
              {de ? 'Schließen' : 'Zamknij'}
            </button>
            <button
              onClick={handleBulkSave}
              disabled={bulkSaving || bulkCount === 0}
              className="btn-primary btn-press inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {bulkSaving ? <Spinner size="sm" /> : <Layers size={15} />}
              {de ? `${bulkCount} Karten hinzufügen` : `Dodaj ${bulkCount} kart`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
