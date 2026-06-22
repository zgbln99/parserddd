import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CreditCard, Search, Plus, Pencil, Trash2, AlertTriangle, Fuel, Truck, PackageOpen,
  ListPlus, CheckCircle2, UserCog, MapPin, X, FileSpreadsheet,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import {
  fetchFuelCards, createFuelCard, updateFuelCard, deleteFuelCard, bulkCreateFuelCards,
  bulkAssignFuelCards, fetchSamsaraVehicles,
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
  manager: '',
  location: '',
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

// --- XLSX import ------------------------------------------------------------
// Column-header keywords (PL / DE / EN, matched as substrings) so an uploaded
// sheet maps its columns automatically regardless of exact wording.
const XLSX_CARD_KW = ['kart', 'card'];
const XLSX_NUM_KW = ['numer', 'nummer', 'nr'];
const XLSX_VEH_KW = ['pojazd', 'fahrzeug', 'vehicle', 'tablic', 'rejestr', 'plate', 'kennzeich', 'auto', 'samoch'];
const XLSX_PROV_KW = ['dostawc', 'provider', 'anbieter', 'operator'];

/**
 * Turn raw sheet rows (array of arrays) into bulk-import text + a detected
 * provider. Detects a header row by keyword; otherwise assumes column 0 =
 * card number, column 1 = vehicle. Output lines are "card<TAB>vehicle", so
 * they feed straight into the existing bulk textarea / preview / dedup.
 */
function rowsToBulkImport(rows: unknown[][]): { lines: string; provider: string; count: number } {
  const cells = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (cells.length === 0) return { lines: '', provider: '', count: 0 };

  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const has = (cell: string, kws: string[]) => kws.some((k) => cell.includes(k));
  const first = cells[0].map(norm);
  const isHeader = first.some((c) => has(c, [...XLSX_CARD_KW, ...XLSX_VEH_KW, ...XLSX_PROV_KW, ...XLSX_NUM_KW]));

  let cardIdx = 0;
  let vehIdx = 1;
  let provIdx = -1;
  let start = 0;
  if (isHeader) {
    start = 1;
    const findCol = (kws: string[]) => first.findIndex((c) => has(c, kws));
    cardIdx = findCol(XLSX_CARD_KW);
    if (cardIdx < 0) cardIdx = findCol(XLSX_NUM_KW);
    if (cardIdx < 0) cardIdx = 0;
    vehIdx = findCol(XLSX_VEH_KW);
    if (vehIdx < 0) vehIdx = cardIdx === 0 ? 1 : 0;
    provIdx = findCol(XLSX_PROV_KW);
  }

  const lines: string[] = [];
  const providers = new Set<string>();
  for (let r = start; r < cells.length; r++) {
    const row = cells[r];
    const card = String(row[cardIdx] ?? '').trim();
    if (!card) continue;
    const veh = String(row[vehIdx] ?? '').trim();
    lines.push(veh ? `${card}\t${veh}` : card);
    if (provIdx >= 0) {
      const p = String(row[provIdx] ?? '').trim();
      if (p) providers.add(p);
    }
  }
  return { lines: lines.join('\n'), provider: providers.size === 1 ? [...providers][0] : '', count: lines.length };
}

// --- Bulk import draft autosave -------------------------------------------
// The bulk textarea can hold 100+ cards; losing it to a logout/crash/closed
// tab is painful. We persist the whole form to localStorage on every change
// and restore it when the modal is reopened, so typed cards survive anything.
const BULK_DRAFT_KEY = 'fuelCardsBulkDraft.v1';

function loadBulkDraft(): BulkForm | null {
  try {
    const raw = localStorage.getItem(BULK_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.cardsText !== 'string') return null;
    return { ...BULK_EMPTY, ...d };
  } catch {
    return null;
  }
}

function saveBulkDraft(form: BulkForm) {
  try {
    localStorage.setItem(BULK_DRAFT_KEY, JSON.stringify(form));
  } catch {
    /* private mode / quota — autosave just becomes a no-op */
  }
}

function clearBulkDraft() {
  try {
    localStorage.removeItem(BULK_DRAFT_KEY);
  } catch {
    /* ignore */
  }
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
  // Autosaved draft of the bulk import (survives logout / crash / closed tab).
  const [bulkDraft, setBulkDraft] = useState<BulkForm | null>(() => loadBulkDraft());
  const [bulkSavedAt, setBulkSavedAt] = useState<number | null>(null);
  const [xlsxError, setXlsxError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkDraftCount = useMemo(
    () => (bulkDraft ? parseBulkRows(bulkDraft.cardsText).length : 0),
    [bulkDraft],
  );

  // row selection + bulk-assign (manager / location)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const [assignManager, setAssignManager] = useState('');
  const [assignLocation, setAssignLocation] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState('');
  const selectAllRef = useRef<HTMLInputElement>(null);

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

  // Background autosave of the bulk import draft, while the modal is open.
  useEffect(() => {
    if (!showBulk) return;
    const t = setTimeout(() => {
      if (bulkForm.cardsText.trim()) {
        saveBulkDraft(bulkForm);
        setBulkDraft(bulkForm);
        setBulkSavedAt(Date.now());
      } else {
        clearBulkDraft();
        setBulkDraft(null);
        setBulkSavedAt(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [bulkForm, showBulk]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return cards.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.card_number.toLowerCase().includes(q) ||
        c.provider.toLowerCase().includes(q) ||
        c.vehicle_name.toLowerCase().includes(q) ||
        c.driver_name.toLowerCase().includes(q) ||
        c.manager.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q)
      );
    });
  }, [cards, search, statusFilter]);

  // Suggestions for the manager / location inputs, built from existing values.
  const managers = useMemo(
    () => [...new Set(cards.map((c) => c.manager).filter(Boolean))].sort(),
    [cards],
  );
  const locations = useMemo(
    () => [...new Set(cards.map((c) => c.location).filter(Boolean))].sort(),
    [cards],
  );

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
      manager: c.manager,
      location: c.location,
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
    const draft = loadBulkDraft();
    setBulkForm(draft ?? BULK_EMPTY);
    setBulkSavedAt(draft ? Date.now() : null);
    setBulkError('');
    setXlsxError('');
    setBulkResult(null);
    setShowBulk(true);
  };

  // Read an uploaded .xlsx/.xls and append its cards to the import textarea.
  const handleXlsxFile = async (file: File) => {
    setXlsxError('');
    try {
      const buf = await file.arrayBuffer();
      const mod = await import('xlsx-js-style');
      const XLSX = mod.default ?? mod;
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false }) as unknown[][];
      const { lines, provider, count } = rowsToBulkImport(rows);
      if (count === 0) {
        setXlsxError(de ? 'Keine Karten in der Datei gefunden.' : 'Nie znaleziono kart w pliku.');
        return;
      }
      setBulkForm((f) => ({
        ...f,
        cardsText: f.cardsText.trim() ? `${f.cardsText.trim()}\n${lines}` : lines,
        provider: f.provider.trim() || provider,
      }));
    } catch {
      setXlsxError(de ? 'Datei konnte nicht gelesen werden (XLSX/XLS erwartet).' : 'Nie udało się odczytać pliku (oczekiwano XLSX/XLS).');
    }
  };

  const discardBulkDraft = () => {
    clearBulkDraft();
    setBulkDraft(null);
    setBulkSavedAt(null);
  };

  // Persist immediately on close so the last keystrokes (within the debounce
  // window) can never be lost.
  const closeBulk = () => {
    if (bulkForm.cardsText.trim()) {
      saveBulkDraft(bulkForm);
      setBulkDraft(bulkForm);
      setBulkSavedAt(Date.now());
    }
    setShowBulk(false);
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
      // Nothing skipped → batch is clean, close right away and drop the draft.
      // Otherwise keep the modal open and refill it with just the skipped rows
      // (vehicle kept) — the autosave effect re-persists those.
      if (res.skipped.length === 0) {
        setShowBulk(false);
        setBulkForm(BULK_EMPTY);
        discardBulkDraft();
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

  // ----- row selection + bulk-assign -----
  const allVisibleSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
  const someVisibleSelected = filtered.some((c) => selectedIds.has(c.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openAssign = () => {
    setAssignManager('');
    setAssignLocation('');
    setAssignError('');
    setShowAssign(true);
  };

  const handleAssign = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const manager = assignManager.trim();
    const location = assignLocation.trim();
    if (!manager && !location) {
      setAssignError(de ? 'Manager oder Standort angeben.' : 'Podaj kierownika lub lokalizację.');
      return;
    }
    setAssignSaving(true);
    setAssignError('');
    try {
      await bulkAssignFuelCards({
        ids,
        ...(manager ? { manager } : {}),
        ...(location ? { location } : {}),
      });
      setShowAssign(false);
      clearSelection();
      load();
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssignSaving(false);
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

      {/* Recovered bulk-import draft — shown when a saved draft exists and the modal is closed */}
      {!showBulk && bulkDraftCount > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-50/70 px-4 py-2.5 dark:bg-amber-500/10 sm:flex-row sm:items-center">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-200">
            <ListPlus size={15} />
            {de
              ? `Nicht gespeicherter Import-Entwurf: ${bulkDraftCount} Karte(n).`
              : `Niezapisany szkic importu: ${bulkDraftCount} kart.`}
          </span>
          <div className="flex-1" />
          <button
            onClick={openBulk}
            className="btn-primary btn-press inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold"
          >
            {de ? 'Fortsetzen' : 'Wznów'}
          </button>
          <button
            onClick={discardBulkDraft}
            className="btn-press inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface"
          >
            {de ? 'Verwerfen' : 'Odrzuć'}
          </button>
        </div>
      )}

      {/* Bulk-assign action bar — appears when rows are selected */}
      {selectedIds.size > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary-600/30 bg-primary-50/60 px-4 py-2.5 dark:bg-primary-600/10 sm:flex-row sm:items-center">
          <span className="text-sm font-semibold text-ink">
            {de ? `${selectedIds.size} ausgewählt` : `Zaznaczono: ${selectedIds.size}`}
          </span>
          <div className="flex-1" />
          <button
            onClick={openAssign}
            className="btn-primary btn-press inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold"
          >
            <UserCog size={15} />
            {de ? 'Manager / Standort zuweisen' : 'Przypisz kierownika / lokalizację'}
          </button>
          <button
            onClick={clearSelection}
            className="btn-press inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface"
          >
            <X size={15} />
            {de ? 'Auswahl aufheben' : 'Wyczyść'}
          </button>
        </div>
      )}

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
              <div key={c.id} className={`flex gap-3 p-4 ${selectedIds.has(c.id) ? 'bg-primary-50/50 dark:bg-primary-600/10' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleSelect(c.id)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary-600"
                  aria-label={de ? 'Auswählen' : 'Zaznacz'}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold">{c.card_number}</span>
                    {statusBadge(c.status)}
                  </div>
                  <div className="space-y-0.5 text-xs text-muted">
                    {c.provider && <p>{c.provider}</p>}
                    {c.vehicle_name && <p>🚛 {c.vehicle_name}{c.driver_name ? ` · ${c.driver_name}` : ''}</p>}
                    {(c.manager || c.location) && (
                      <p>👤 {c.manager || '—'}{c.location ? ` · 📍 ${c.location}` : ''}</p>
                    )}
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
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-black/[0.02] dark:bg-white/5">
                  <th className="w-10 px-4 py-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-border accent-primary-600"
                      aria-label={de ? 'Alle auswählen' : 'Zaznacz wszystkie'}
                    />
                  </th>
                  {[
                    de ? 'Kartennummer' : 'Numer karty',
                    de ? 'Anbieter' : 'Dostawca',
                    de ? 'Fahrzeug' : 'Pojazd',
                    de ? 'Fahrer' : 'Kierowca',
                    de ? 'Manager' : 'Kierownik',
                    de ? 'Standort' : 'Lokalizacja',
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
                  <tr key={c.id} className={`transition hover:bg-primary-50/40 dark:hover:bg-white/5 ${selectedIds.has(c.id) ? 'bg-primary-50/60 dark:bg-primary-600/10' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="h-4 w-4 rounded border-border accent-primary-600"
                        aria-label={de ? 'Auswählen' : 'Zaznacz'}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-ink">{c.card_number}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{c.provider || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{c.vehicle_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{c.driver_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{c.manager || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{c.location || '—'}</td>
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
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Manager' : 'Kierownik'}</span>
              <input
                type="text"
                list="fuel-managers"
                value={form.manager}
                onChange={(e) => setForm({ ...form, manager: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
              />
              <datalist id="fuel-managers">
                {managers.map((m) => <option key={m} value={m} />)}
              </datalist>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{de ? 'Standort' : 'Lokalizacja'}</span>
              <input
                type="text"
                list="fuel-locations"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="input w-full rounded-xl px-3 py-2 text-sm"
              />
              <datalist id="fuel-locations">
                {locations.map((l) => <option key={l} value={l} />)}
              </datalist>
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
        onClose={closeBulk}
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

          {/* XLSX upload — fills the textarea below */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleXlsxFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-press inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-primary-50 dark:hover:bg-white/5"
            >
              <FileSpreadsheet size={15} />
              {de ? 'XLSX hochladen' : 'Wgraj plik XLSX'}
            </button>
            <span className="text-[11px] text-muted">
              {de
                ? 'Spalten: Kartennummer, Fahrzeug (optional Anbieter). Erste Zeile darf eine Überschrift sein.'
                : 'Kolumny: numer karty, pojazd (opcjonalnie dostawca). Pierwszy wiersz może być nagłówkiem.'}
            </span>
          </div>
          {xlsxError && <p className="text-sm text-danger">{xlsxError}</p>}

          <label className="block text-sm">
            <span className="mb-1 flex items-center justify-between gap-2">
              <span className="block text-xs font-medium text-muted">
                {de ? 'Kartennummer + Fahrzeug' : 'Numer karty + pojazd'}
              </span>
              <span className="inline-flex items-center gap-2 text-[11px] font-medium text-muted">
                {bulkSavedAt && (
                  <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400" title={new Date(bulkSavedAt).toLocaleTimeString()}>
                    <CheckCircle2 size={12} />
                    {de ? 'Entwurf gespeichert' : 'Szkic zapisany'}
                  </span>
                )}
                <span>{bulkRows.length} {de ? 'Karten' : 'kart'}</span>
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
            <button onClick={closeBulk} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface">
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

      {/* Bulk-assign modal — manager (Kierownik) + location (Lokalizacja) */}
      <Modal
        open={showAssign}
        onClose={() => setShowAssign(false)}
        title={de ? 'Manager / Standort zuweisen' : 'Przypisz kierownika / lokalizację'}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {de
              ? `Wird auf ${selectedIds.size} ausgewählte Karte(n) angewendet.`
              : `Zostanie zastosowane do ${selectedIds.size} zaznaczonych kart.`}
          </p>
          <label className="block text-sm">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <UserCog size={13} /> {de ? 'Manager' : 'Kierownik'}
            </span>
            <input
              type="text"
              list="fuel-managers-assign"
              value={assignManager}
              onChange={(e) => setAssignManager(e.target.value)}
              className="input w-full rounded-xl px-3 py-2 text-sm"
              placeholder={de ? 'z. B. Kowalski' : 'np. Kowalski'}
              autoFocus
            />
            <datalist id="fuel-managers-assign">
              {managers.map((m) => <option key={m} value={m} />)}
            </datalist>
          </label>
          <label className="block text-sm">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <MapPin size={13} /> {de ? 'Standort' : 'Lokalizacja'}
            </span>
            <input
              type="text"
              list="fuel-locations-assign"
              value={assignLocation}
              onChange={(e) => setAssignLocation(e.target.value)}
              className="input w-full rounded-xl px-3 py-2 text-sm"
              placeholder={de ? 'z. B. Lager Wrocław' : 'np. Magazyn Wrocław'}
            />
            <datalist id="fuel-locations-assign">
              {locations.map((l) => <option key={l} value={l} />)}
            </datalist>
          </label>
          <p className="text-[11px] text-muted">
            {de ? 'Leeres Feld = unverändert lassen.' : 'Puste pole = bez zmian.'}
          </p>
          {assignError && <p className="text-sm text-danger">{assignError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowAssign(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface">
              {de ? 'Abbrechen' : 'Anuluj'}
            </button>
            <button
              onClick={handleAssign}
              disabled={assignSaving || (!assignManager.trim() && !assignLocation.trim())}
              className="btn-primary btn-press px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {assignSaving ? <Spinner size="sm" /> : (de ? 'Zuweisen' : 'Przypisz')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
