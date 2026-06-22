import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreditCard, Search, Plus, Pencil, Trash2, AlertTriangle, Fuel, Truck, PackageOpen,
  ListPlus, CheckCircle2,
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
  type FuelCard, type FuelCardPayload, type FuelCardBulkResult, type SamsaraVehicle,
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

const PROVIDERS = ['Hoyer', 'Aral', 'Star', 'DKV', 'UTA', 'Shell', 'E100', 'Orlen'];

interface BulkForm {
  provider: string;
  cardsText: string;
  monthly_limit_eur: number;
  expiry_date: string;
  status: FuelCard['status'];
  notes: string;
}

const BULK_EMPTY: BulkForm = {
  provider: '',
  cardsText: '',
  monthly_limit_eur: 0,
  expiry_date: '',
  status: 'active',
  notes: '',
};

export interface BulkRow {
  card_number: string;
  vehicle_name: string;
}

/**
 * Parse the bulk textarea into de-duped {card number, vehicle} rows. Each
 * line is "card number<sep>vehicle"; the separator is Tab (Excel paste),
 * ';' or '|', or 2+ spaces — single spaces stay intact because card numbers
 * and plates contain them. A line with no separator = card number only.
 */
function parseBulkRows(text: string): BulkRow[] {
  const seen = new Set<string>();
  const out: BulkRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parts: string[];
    if (line.includes('\t')) parts = line.split('\t');
    else if (line.includes(';')) parts = line.split(';');
    else if (line.includes('|')) parts = line.split('|');
    else if (/\s{2,}/.test(line)) parts = line.split(/\s{2,}/);
    else parts = [line];
    const card_number = (parts[0] || '').trim();
    if (!card_number) continue;
    const key = card_number.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ card_number, vehicle_name: (parts[1] || '').trim() });
  }
  return out;
}

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
  const [noDriver, setNoDriver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // bulk-add modal
  const [showBulk, setShowBulk] = useState(false);
  const [bulkForm, setBulkForm] = useState<BulkForm>(BULK_EMPTY);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkResult, setBulkResult] = useState<FuelCardBulkResult | null>(null);
  const bulkRows = useMemo(() => parseBulkRows(bulkForm.cardsText), [bulkForm.cardsText]);

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
    setNoDriver(false);
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
    setNoDriver(!c.driver_name);
    setFormError('');
    setShowForm(true);
  };

  const openBulk = () => {
    setBulkForm(BULK_EMPTY);
    setBulkError('');
    setBulkResult(null);
    setShowBulk(true);
  };

  const toggleNoDriver = (checked: boolean) => {
    setNoDriver(checked);
    if (checked) setForm((f) => ({ ...f, driver_name: '' }));
  };

  const handleBulkSave = async () => {
    if (bulkRows.length === 0) return;
    setBulkSaving(true);
    setBulkError('');
    try {
      const res = await bulkCreateFuelCards({
        provider: bulkForm.provider.trim(),
        cards: bulkRows,
        driver_name: '',
        monthly_limit_eur: bulkForm.monthly_limit_eur || 0,
        expiry_date: bulkForm.expiry_date,
        status: bulkForm.status,
        notes: bulkForm.notes.trim(),
      });
      setBulkResult(res);
      load();
      // Nothing skipped → batch is clean, close right away. Otherwise keep the
      // modal open and refill it with just the skipped rows (vehicle kept).
      if (res.skipped.length === 0) {
        setShowBulk(false);
      } else {
        const byNumber = new Map(bulkRows.map((r) => [r.card_number.toLowerCase(), r]));
        const lines = res.skipped.map((s) => {
          const row = byNumber.get(s.card_number.toLowerCase());
          return row?.vehicle_name ? `${s.card_number}\t${row.vehicle_name}` : s.card_number;
        });
        setBulkForm((f) => ({ ...f, cardsText: lines.join('\n') }));
      }
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkSaving(false);
    }
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
          <ListPlus size={15} />
          {de ? 'Massenimport' : 'Dodaj masowo'}
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
                {PROVIDERS.map((p) => <option key={p} value={p} />)}
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
              <span className="mb-1 flex items-center justify-between gap-2">
                <span className="block text-xs font-medium text-muted">{de ? 'Fahrer' : 'Kierowca'}</span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted">
                  <input
                    type="checkbox"
                    checked={noDriver}
                    onChange={(e) => toggleNoDriver(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary-600"
                  />
                  {de ? 'Keine Zuordnung' : 'Bez przypisania'}
                </label>
              </span>
              <input
                type="text"
                value={form.driver_name}
                onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
                disabled={noDriver}
                placeholder={noDriver ? (de ? 'Keinem Fahrer zugeordnet' : 'Bez przypisania do kierowcy') : ''}
                className="input w-full rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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

      {/* Bulk-add modal — one provider, "card number + vehicle" pairs */}
      <Modal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        title={de ? 'Karten im Stapel hinzufügen' : 'Masowe dodawanie kart'}
      >
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Anbieter' : 'Dostawca'}</span>
            <input
              type="text"
              list="fuel-providers-bulk"
              value={bulkForm.provider}
              onChange={(e) => setBulkForm({ ...bulkForm, provider: e.target.value })}
              className="input w-full rounded-xl px-3 py-2 text-sm"
              placeholder="Hoyer / Aral / DKV…"
              autoFocus
            />
            <datalist id="fuel-providers-bulk">
              {PROVIDERS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </label>

          <label className="block text-sm">
            <span className="mb-1 flex items-center justify-between gap-2">
              <span className="block text-xs font-medium text-muted">
                {de ? 'Kartennummer + Fahrzeug' : 'Numer karty + pojazd'}
              </span>
              <span className="text-[11px] font-medium text-muted">
                {bulkRows.length} {de ? 'Karten' : 'kart'}
              </span>
            </span>
            <textarea
              value={bulkForm.cardsText}
              onChange={(e) => setBulkForm({ ...bulkForm, cardsText: e.target.value })}
              rows={6}
              className="input w-full rounded-xl px-3 py-2 text-sm font-mono"
              placeholder={de
                ? 'Kartennummer und Fahrzeug pro Zeile — z. B.:\n7088 0012 3456 7890;  WGM 12345\nKarte Lager;  Anhänger 7'
                : 'Numer karty i pojazd w jednej linii — np.:\n7088 0012 3456 7890;  WGM 12345\nKarta magazyn;  Naczepa 7'}
            />
            <span className="mt-1 block text-[11px] text-muted">
              {de
                ? 'Eine Karte pro Zeile: Kartennummer, dann Fahrzeug — getrennt durch Tab (Einfügen aus Excel), ; oder |. Das Fahrzeug darf auch eines sein, das nicht im System ist. Duplikate werden übersprungen.'
                : 'Jedna karta na linię: numer karty, potem pojazd — rozdzielone Tabem (wklejanie z Excela), ; lub |. Pojazd może być spoza systemu. Duplikaty są pomijane.'}
            </span>
          </label>

          {bulkRows.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-muted">
                    <th className="px-3 py-1.5 font-semibold">{de ? 'Kartennummer' : 'Numer karty'}</th>
                    <th className="px-3 py-1.5 font-semibold">{de ? 'Fahrzeug' : 'Pojazd'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bulkRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-mono">{r.card_number}</td>
                      <td className="px-3 py-1.5">{r.vehicle_name || <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Monatslimit (€)' : 'Limit miesięczny (€)'}</span>
              <input
                type="number"
                min={0}
                step={50}
                value={bulkForm.monthly_limit_eur || ''}
                onChange={(e) => setBulkForm({ ...bulkForm, monthly_limit_eur: Number(e.target.value) || 0 })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Gültig bis' : 'Ważna do'}</span>
              <input
                type="date"
                value={bulkForm.expiry_date}
                onChange={(e) => setBulkForm({ ...bulkForm, expiry_date: e.target.value })}
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
                  onClick={() => setBulkForm({ ...bulkForm, status: s })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    bulkForm.status === s ? 'bg-primary-600 text-white' : 'border border-border text-muted hover:bg-surface'
                  }`}
                >
                  {s === 'active' ? (de ? 'Aktiv' : 'Aktywna') : s === 'ordered' ? (de ? 'Bestellt' : 'Zamówiona') : (de ? 'Gesperrt' : 'Zablokowana')}
                </button>
              ))}
            </div>
          </div>

          {bulkResult && (
            <div className="space-y-1 rounded-xl bg-green-500/10 px-4 py-2.5 text-sm text-green-700 dark:text-green-300">
              <p className="inline-flex items-center gap-1.5 font-semibold">
                <CheckCircle2 size={15} />
                {de ? `${bulkResult.count} Karten angelegt` : `Dodano kart: ${bulkResult.count}`}
              </p>
              {bulkResult.skipped.length > 0 && (
                <p className="text-amber-700 dark:text-amber-300">
                  {de ? 'Übersprungen (Duplikat/Fehler): ' : 'Pominięto (duplikat/błąd): '}
                  {bulkResult.skipped.map((s) => s.card_number).join(', ')}
                </p>
              )}
            </div>
          )}
          {bulkError && <p className="text-sm text-danger">{bulkError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowBulk(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface">
              {de ? 'Schließen' : 'Zamknij'}
            </button>
            <button
              onClick={handleBulkSave}
              disabled={bulkSaving || bulkRows.length === 0}
              className="btn-primary btn-press px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {bulkSaving ? <Spinner size="sm" /> : (de ? `${bulkRows.length} Karten anlegen` : `Dodaj ${bulkRows.length} kart`)}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
