import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, Pencil, Trash2, Search, AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import {
  fetchVehicleDeadlines, createVehicleDeadline, updateVehicleDeadline, deleteVehicleDeadline,
  fetchSamsaraVehicles,
  type VehicleDeadline, type VehicleDeadlinePayload, type SamsaraVehicle,
} from '../lib/api';

/**
 * Vehicle deadlines — TÜV/HU, insurance, ADR, tachograph calibration, etc.
 * Sorted by due date; colour-coded by days remaining; bell warns on
 * deadlines due within 30 days or overdue.
 */

const KINDS_DE = ['HU / TÜV', 'AU (Abgas)', 'Versicherung', 'ADR', 'Tachograph (Kalibrierung)', 'UVV', 'SP (§29)', 'Leasing'];
const KINDS_PL = ['Przegląd (HU/TÜV)', 'Badanie spalin', 'Ubezpieczenie', 'ADR', 'Tachograf (legalizacja)', 'UVV', 'SP', 'Leasing'];

const EMPTY: VehicleDeadlinePayload = { vehicle_name: '', kind: '', due_date: '', notes: '' };

function daysTo(due: string): number | null {
  if (!due) return null;
  const d = new Date(due + 'T23:59:59');
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86_400_000);
}

export function DeadlinesPage() {
  const { locale } = useI18n();
  const de = locale === 'de';
  const KINDS = de ? KINDS_DE : KINDS_PL;

  const [rows, setRows] = useState<VehicleDeadline[]>([]);
  const [vehicles, setVehicles] = useState<SamsaraVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<VehicleDeadline | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<VehicleDeadlinePayload>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchVehicleDeadlines()
      .then((r) => { setRows(r.deadlines || []); setError(''); })
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
    if (!q) return rows;
    return rows.filter((r) => r.vehicle_name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    soon: rows.filter((r) => { const d = daysTo(r.due_date); return d != null && d >= 0 && d <= 30; }).length,
    overdue: rows.filter((r) => { const d = daysTo(r.due_date); return d != null && d < 0; }).length,
  }), [rows]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setFormError(''); setShowForm(true); };
  const openEdit = (r: VehicleDeadline) => {
    setEditing(r);
    setForm({ vehicle_name: r.vehicle_name, kind: r.kind, due_date: r.due_date, notes: r.notes });
    setFormError(''); setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.vehicle_name.trim() || !form.kind.trim()) return;
    setSaving(true); setFormError('');
    try {
      if (editing) await updateVehicleDeadline(editing.id, form);
      else await createVehicleDeadline(form);
      setShowForm(false); load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  const handleDelete = async (r: VehicleDeadline) => {
    if (!window.confirm(de ? `Termin löschen?` : `Usunąć termin?`)) return;
    try { await deleteVehicleDeadline(r.id); load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const dueCell = (due: string) => {
    if (!due) return <span className="text-muted">—</span>;
    const d = daysTo(due);
    const cls = d == null ? '' : d < 0 ? 'text-danger font-bold' : d <= 30 ? 'text-danger font-semibold' : d <= 60 ? 'text-warning font-semibold' : 'text-ink';
    return (
      <span className={`inline-flex items-center gap-1 ${cls}`}>
        {d != null && d <= 30 && <AlertTriangle size={12} />}
        {due}
        {d != null && <span className="text-[11px]">({d < 0 ? (de ? `${-d} T überfällig` : `${-d} dni po`) : `${d} ${de ? 'T' : 'dni'}`})</span>}
      </span>
    );
  };

  return (
    <div className="animate-slide-up space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#fb7185] to-[#ef4444] text-white">
          <CalendarClock size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{de ? 'Fahrzeug-Termine' : 'Terminy pojazdów'}</h1>
          <p className="text-xs text-muted">{de ? 'HU/TÜV, Versicherung, ADR, Tachograph…' : 'Przegląd, ubezpieczenie, ADR, tachograf…'}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={de ? 'Termine gesamt' : 'Wszystkie terminy'} value={stats.total} icon={<CalendarClock size={20} />} color="primary" />
        <StatCard label={de ? 'Bald fällig (≤30 T)' : 'Wkrótce (≤30 dni)'} value={stats.soon} icon={<AlertTriangle size={20} />} color={stats.soon > 0 ? 'orange' : 'green'} />
        <StatCard label={de ? 'Überfällig' : 'Po terminie'} value={stats.overdue} icon={<AlertTriangle size={20} />} color={stats.overdue > 0 ? 'red' : 'green'} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={de ? 'Fahrzeug oder Typ…' : 'Pojazd lub typ…'}
            className="input w-full rounded-xl py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex-1" />
        <button onClick={openCreate} className="btn-primary btn-press inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold">
          <Plus size={15} /> {de ? 'Termin hinzufügen' : 'Dodaj termin'}
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock size={26} />}
            title={de ? 'Keine Termine' : 'Brak terminów'}
            hint={de ? 'Fügen Sie HU/TÜV, Versicherung usw. hinzu.' : 'Dodaj przegląd, ubezpieczenie itd.'}
            action={
              <button onClick={openCreate} className="btn-primary btn-press inline-flex items-center gap-2 px-4 py-2 text-sm">
                <Plus size={15} /> {de ? 'Termin hinzufügen' : 'Dodaj termin'}
              </button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border sm:hidden">
            {filtered.map((r) => (
              <div key={r.id} className="p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold">{r.vehicle_name}</span>
                  <Badge variant="gray">{r.kind}</Badge>
                </div>
                <p className="text-xs">{dueCell(r.due_date)}</p>
                {r.notes && <p className="mt-1 text-xs text-muted">{r.notes}</p>}
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => openEdit(r)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface"><Pencil size={12} className="inline" /> {de ? 'Bearbeiten' : 'Edytuj'}</button>
                  <button onClick={() => handleDelete(r)} className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-300"><Trash2 size={12} className="inline" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-black/[0.02] dark:bg-white/5">
                  {[de ? 'Fahrzeug' : 'Pojazd', de ? 'Typ' : 'Typ', de ? 'Fällig' : 'Termin', de ? 'Notiz' : 'Notatka', ''].map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="transition hover:bg-primary-50/40 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-ink">{r.vehicle_name}</td>
                    <td className="whitespace-nowrap px-4 py-3"><Badge variant="gray">{r.kind}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{dueCell(r.due_date)}</td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-xs text-muted">{r.notes || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right">
                      <button onClick={() => openEdit(r)} className="rounded-lg p-1.5 text-muted transition hover:bg-primary-50 hover:text-primary-600"><Pencil size={15} /></button>
                      <button onClick={() => handleDelete(r)} className="rounded-lg p-1.5 text-muted transition hover:bg-red-500/10 hover:text-red-500"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? (de ? 'Termin bearbeiten' : 'Edytuj termin') : (de ? 'Neuer Termin' : 'Nowy termin')}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Fahrzeug *' : 'Pojazd *'}</span>
              <input type="text" list="dl-vehicles" value={form.vehicle_name} onChange={(e) => setForm({ ...form, vehicle_name: e.target.value })} className="input w-full rounded-xl px-3 py-2 text-sm" autoFocus />
              <datalist id="dl-vehicles">{vehicles.map((v) => <option key={v.id} value={v.name}>{v.license_plate}</option>)}</datalist>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Typ *' : 'Typ *'}</span>
              <input type="text" list="dl-kinds" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="input w-full rounded-xl px-3 py-2 text-sm" placeholder="HU / TÜV" />
              <datalist id="dl-kinds">{KINDS.map((k) => <option key={k} value={k} />)}</datalist>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Fällig am' : 'Termin'}</span>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="input w-full rounded-xl px-3 py-2 text-sm dark:[color-scheme:dark]" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Notiz' : 'Notatka'}</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="input w-full rounded-xl px-3 py-2 text-sm" />
          </label>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface">{de ? 'Abbrechen' : 'Anuluj'}</button>
            <button onClick={handleSave} disabled={saving || !form.vehicle_name.trim() || !form.kind.trim()} className="btn-primary btn-press px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {saving ? <Spinner size="sm" /> : (de ? 'Speichern' : 'Zapisz')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
