import { useState, useCallback, useRef, useMemo, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import {
  Upload, FileText, AlertCircle, Clock, Moon, UtensilsCrossed,
  CalendarDays, Thermometer, Palmtree, Star, ClipboardCopy, Check,
  Plus, Trash2, FileDown, CloudUpload, Users, Shuffle,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { parseStundenzettel, parseLohnAns, listStundenzettelFiles, cleanStundenzettelPdf, cleanStundenzettelXlsx, fetchConfig, type StundenzettelDay, type LohnEmployee, type LohnMonth } from '../lib/api';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { MonthSelect } from '../components/MonthSelect';
import { getHolidayMap } from '../lib/holidays';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('StundenzettelPage crash:', error, info); }
  render() {
    if (this.state.error) return (
      <div className="rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
        <strong>Render error:</strong> {this.state.error}
      </div>
    );
    return this.props.children;
  }
}

interface EditableDay {
  day: number;
  start: string;
  end: string;
  pause: number;
  code: string;
}

const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const CODE_OPTIONS = ['', 'K', 'U', 'F', 'UU', 'SA', 'SU'];
const CODE_COLORS: Record<string, string> = {
  K: 'bg-red-50/50 dark:bg-red-900/10',
  U: 'bg-emerald-50/50 dark:bg-emerald-900/10',
  F: 'bg-blue-50/50 dark:bg-blue-900/10',
};

function hm(minutes: number): string {
  if (!minutes || minutes <= 0) return '0:00';
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseTimeToMin(t: string): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function calcDay(d: EditableDay, isSunday = false, _weekendDiet = false) {
  const startMin = parseTimeToMin(d.start);
  const endMin = parseTimeToMin(d.end);
  if (startMin === null || endMin === null) return { work: 0, night25: 0, night40: 0, diet: false };

  let end = endMin;
  if (end <= startMin) end += 1440;

  const gross = end - startMin;
  const work = Math.max(0, gross - d.pause);

  let night25 = 0, night40 = 0;
  for (let m = startMin; m < startMin + work && m < end; m++) {
    const h = (m % 1440) / 60 | 0;
    if (h >= 22 || (h >= 4 && h < 6)) night25++;
    else if (h >= 0 && h < 4) {
      if (startMin < 1440) night40++; else night25++;
    }
  }

  // Diet: Mon-Sat (>=8h gross). Sunday never gets diet.
  return { work, night25, night40, diet: !isSunday && gross >= 480 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function makeEmptyDays(year: number, month: number): EditableDay[] {
  const count = daysInMonth(year, month);
  return Array.from({ length: count }, (_, i) => ({
    day: i + 1, start: '', end: '', pause: 0, code: '',
  }));
}

function getWeekday(year: number, month: number, day: number): string {
  try { return WEEKDAYS_SHORT[new Date(year, month - 1, day).getDay()] || ''; } catch { return ''; }
}

function isWeekend(year: number, month: number, day: number): boolean {
  try { const d = new Date(year, month - 1, day).getDay(); return d === 0 || d === 6; } catch { return false; }
}

function isSunday(year: number, month: number, day: number): boolean {
  try { return new Date(year, month - 1, day).getDay() === 0; } catch { return false; }
}

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Inclusive list of {year, month} from one 'YYYY-MM' to another (capped 60). */
function monthsBetween(fromYM: string, toYM: string): { year: number; month: number }[] {
  const [fy, fm] = fromYM.split('-').map(Number);
  const [ty, tm] = toYM.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return [];
  const out: { year: number; month: number }[] = [];
  let y = fy, m = fm, guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 60) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Build a month's day grid from a shift pattern (weekdays, optionally Sat).
 *  When markHolidays is set, working days that are German (Berlin) public
 *  holidays are marked 'F' instead of getting work hours. */
function buildMonthDaysPattern(
  year: number, month: number, start: string, end: string, pause: number,
  includeSat: boolean, markHolidays: boolean,
): EditableDay[] {
  const count = daysInMonth(year, month);
  const holidays = markHolidays ? getHolidayMap(year) : null;
  return Array.from({ length: count }, (_, i) => {
    const day = i + 1;
    const dow = new Date(year, month - 1, day).getDay();
    const work = (dow >= 1 && dow <= 5) || (includeSat && dow === 6);
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (work && holidays?.has(key)) return { day, start: '', end: '', pause: 0, code: 'F' };
    return { day, start: work ? start : '', end: work ? end : '', pause: work ? pause : 0, code: '' };
  });
}

const _toClock = (m: number) => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

/** Apply a payslip to an already-built month: scatter `uCount` U and `kCount` K
 *  onto random working days, then realise `t25min` minutes of 25% night by
 *  pulling each remaining work day's START earlier into the 04:00–06:00 window
 *  (END is kept — the shift just starts earlier, so the total hours grow to
 *  include the night, matching how the driver actually worked). Even split,
 *  max 120 min/day. Returns the new days plus how much 25% was actually placed
 *  and the number of eligible work days. */
function distributePayslip(
  base: EditableDay[], uCount: number, kCount: number, t25min: number,
  uuRanges: number[][] = [],
): { days: EditableDay[]; placed25: number; workCount: number } {
  const eligible = (arr: EditableDay[]) => arr
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.code === '' && (d.start || d.end))
    .map(({ i }) => i);

  const next = base.map(d => ({ ...d }));
  const used = new Set<number>();

  // Unbezahlter Urlaub (UU) — exact dates from the payslip note. Mark working
  // days in each range as UU (clear the hours); weekends/holidays inside the
  // range are left as they are.
  for (const [s, e] of uuRanges) {
    for (let day = s; day <= e; day++) {
      const idx = day - 1;
      const d = next[idx];
      if (d && d.code === '' && (d.start || d.end)) {
        next[idx] = { ...d, code: 'UU', start: '', end: '', pause: 0 };
        used.add(idx);
      }
    }
  }

  const workIdx = eligible(next); // eligible days left after UU (calendar order)

  // Place `count` absence days of `code` as ONE consecutive run of eligible
  // working days — the way a person actually takes leave. Weekends/holidays in
  // between aren't eligible, so the run naturally bridges them (a Thursday
  // holiday makes two days land on Wed + Fri). When possible, prefer a run that
  // spans a public holiday (F), so the leave brackets the Feiertag. A single
  // day (count 1) just lands anywhere.
  const placeBlock = (count: number, code: string) => {
    const avail = workIdx.filter(i => !used.has(i));
    const n = Math.min(Math.max(0, count), avail.length);
    if (n <= 0) return;
    const maxStart = avail.length - n;
    const bridgesHoliday = (s: number) => {
      const first = next[avail[s]].day;
      const last = next[avail[s + n - 1]].day;
      for (let dd = first + 1; dd < last; dd++) {
        if (next[dd - 1]?.code === 'F') return true;
      }
      return false;
    };
    const tierA: number[] = [];
    const tierB: number[] = [];
    for (let s = 0; s <= maxStart; s++) (bridgesHoliday(s) ? tierA : tierB).push(s);
    const pool = tierA.length ? tierA : tierB;
    const start = pool[Math.floor(Math.random() * pool.length)] ?? 0;
    for (let j = 0; j < n; j++) {
      const idx = avail[start + j];
      next[idx] = { ...next[idx], code, start: '', end: '', pause: 0 };
      used.add(idx);
    }
  };

  placeBlock(uCount, 'U');
  placeBlock(kCount, 'K');

  const remWork = eligible(next);
  const W = remWork.length;
  let placed25 = 0;
  if (t25min > 0 && W > 0) {
    let toPlace = Math.min(t25min, 120 * W);
    placed25 = toPlace;
    const perDay = new Array(W).fill(0);
    const baseEach = Math.min(120, Math.floor(toPlace / W));
    for (let i = 0; i < W; i++) perDay[i] = baseEach;
    toPlace -= baseEach * W;
    for (let i = 0; i < W && toPlace > 0; i++) { if (perDay[i] < 120) { perDay[i]++; toPlace--; } }
    remWork.forEach((idx, k) => {
      const nm = perDay[k];
      if (nm <= 0) return;
      // Start at 06:00 − nm so exactly nm minutes fall in [04:00, 06:00) = 25%;
      // keep the end where it is.
      next[idx] = { ...next[idx], start: _toClock(360 - nm) };
    });
  }
  return { days: next, placed25, workCount: workIdx.length };
}

/** Clear work days outside the employment period, so a mid-month Eintritt only
 *  starts on the entry day and an Austritt stops on the exit day. Dates are
 *  YYYY-MM-DD; either may be null. */
function boundByEmployment(
  days: EditableDay[], year: number, month: number,
  eintritt?: string | null, austritt?: string | null,
): EditableDay[] {
  const toNum = (iso?: string | null) => {
    const m = iso ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
    return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : null;
  };
  const ein = toNum(eintritt);
  const aus = toNum(austritt);
  if (ein == null && aus == null) return days;
  return days.map(d => {
    const n = year * 10000 + month * 100 + d.day;
    if ((ein != null && n < ein) || (aus != null && n > aus)) {
      return { day: d.day, start: '', end: '', pause: 0, code: '' };
    }
    return d;
  });
}

export function StundenzettelPage() {
  const { t, locale } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [period, setPeriod] = useState(getCurrentPeriod);
  const year = parseInt(period.slice(0, 4)) || new Date().getFullYear();
  const month = parseInt(period.slice(5, 7)) || (new Date().getMonth() + 1);

  const [weekendDiet, setWeekendDiet] = useState(false);

  useEffect(() => {
    fetchConfig().then(cfg => setWeekendDiet(!!cfg.weekend_diet)).catch(() => {});
  }, []);

  const [name, setName] = useState('');
  const [days, setDays] = useState<EditableDay[]>(() => makeEmptyDays(
    parseInt(getCurrentPeriod().slice(0, 4)),
    parseInt(getCurrentPeriod().slice(5, 7)),
  ));
  // Per-month grids so edits to each month survive when switching months
  // (needed for multi-month generation where you tweak individual months).
  const [monthGrids, setMonthGrids] = useState<Record<string, EditableDay[]>>({});

  // "Match payslip" inputs for the open month (U/K days, 25% night hours).
  const [absU, setAbsU] = useState(0);
  const [absK, setAbsK] = useState(0);
  const [absN25, setAbsN25] = useState(''); // decimal hours, e.g. "10,50"

  // DATEV LohnViewer (.ans) import → per-employee, per-month 25% night hours.
  const lohnRef = useRef<HTMLInputElement>(null);
  const [lohnBusy, setLohnBusy] = useState(false);
  const [lohnEmp, setLohnEmp] = useState<LohnEmployee | null>(null);
  const [lohnAll, setLohnAll] = useState<LohnEmployee[]>([]);

  // Batch-clean stored PDFs (remove Vorlage/logo/signatures on MEGA S4).
  const [cleaning, setCleaning] = useState(false);
  const [cleanProgress, setCleanProgress] = useState({ done: 0, total: 0, current: '' });
  const [cleanResult, setCleanResult] = useState<{ changed: number; total: number; errors: number } | null>(null);
  const cleanCancelRef = useRef(false);
  const lohnFor = (p: string): LohnMonth | undefined => lohnEmp?.months.find(m => m.period === p);
  const fmtHoursDe = (h: number) => h.toFixed(2).replace('.', ',');
  // Prefill the "match payslip" fields (U/K days, 25% night) from a Lohn month.
  const applyLohnMonth = (lm: LohnMonth | undefined) => {
    if (!lm) return;
    setAbsN25(lm.night25 ? fmtHoursDe(lm.night25) : '');
    setAbsU(Math.round(lm.urlaub) || 0);
    setAbsK(Math.round(lm.krank) || 0);
  };

  const handlePeriodChange = (newPeriod: string) => {
    if (newPeriod === period) return;
    const y = parseInt(newPeriod.slice(0, 4)) || year;
    const m = parseInt(newPeriod.slice(5, 7)) || month;
    // Snapshot the current month, then load the target month (or a fresh grid).
    setMonthGrids(prev => ({ ...prev, [period]: days }));
    setPeriod(newPeriod);
    const existing = monthGrids[newPeriod];
    setDays(existing ? existing.map(d => ({ ...d })) : makeEmptyDays(y, m));
    // Prefill U/K + 25% night from the imported Lohn export for this month.
    applyLohnMonth(lohnFor(newPeriod));
  };

  // Load pre-filled data from analysis page (via localStorage)
  useEffect(() => {
    const raw = localStorage.getItem('stz_prefill');
    if (!raw) return;
    localStorage.removeItem('stz_prefill');
    try {
      const prefill = JSON.parse(raw);
      if (prefill.period) {
        setPeriod(prefill.period);
      }
      if (prefill.name) {
        setName(prefill.name);
      }
      if (prefill.days && Array.isArray(prefill.days)) {
        const y = parseInt((prefill.period || '').slice(0, 4)) || year;
        const m = parseInt((prefill.period || '').slice(5, 7)) || month;
        const count = daysInMonth(y, m);
        const prefillMap = new Map<number, { start: string; end: string; pause: number; code: string }>();
        for (const d of prefill.days) {
          prefillMap.set(d.day, d);
        }
        const result: EditableDay[] = [];
        for (let i = 1; i <= count; i++) {
          const p = prefillMap.get(i);
          result.push(p ? { day: i, start: p.start || '', end: p.end || '', pause: p.pause || 0, code: p.code || '' } : { day: i, start: '', end: '', pause: 0, code: '' });
        }
        setDays(result);
      }
    } catch { /* ignore parse errors */ }
  }, []);

  const handleOcrUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await parseStundenzettel(file);
      const r = res.results?.[0];
      if (!r) { setError('Brak danych'); return; }
      if (r.error) { setError(r.error); return; }
      if (r.name) setName(r.name);

      // Merge OCR results into existing days
      // Handle both old format (start/end/code) and new format (start_time/end_time/notes)
      setDays(prev => {
        const ocrMap = new Map<number, any>();
        for (const d of (r.days || [])) ocrMap.set(d.day, d);
        return prev.map(existing => {
          const ocr = ocrMap.get(existing.day);
          if (!ocr) return existing;
          const startTime = ocr.start_time || ocr.start || '';
          const endTime = ocr.end_time || ocr.end || '';
          const breakMin = ocr.break_minutes ?? ocr.pause_minutes ?? 0;
          const notes = (ocr.notes || '').trim();
          // Detect code from notes or code field
          let code = ocr.code || '';
          if (!code && notes) {
            const upper = notes.toUpperCase();
            if (upper === 'FEIERTAG' || upper === 'F') code = 'F';
            else if (upper === 'KRANK' || upper === 'K') code = 'K';
            else if (upper === 'URLAUB' || upper === 'U') code = 'U';
          }
          return {
            day: existing.day,
            start: code ? '' : (startTime || ''),
            end: code ? '' : (endTime || ''),
            pause: code ? 0 : (typeof breakMin === 'number' ? breakMin : parseInt(breakMin) || 0),
            code,
          };
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, []);

  const updateDay = (idx: number, field: keyof EditableDay, value: string | number) => {
    setDays(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const clearAll = () => {
    setDays(makeEmptyDays(year, month));
    setName('');
  };

  // Mark German (Berlin) public holidays in the current month as F.
  const applyHolidays = () => {
    const hol = getHolidayMap(year);
    setDays(prev => prev.map(d => {
      const dow = new Date(year, month - 1, d.day).getDay();
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      // Mon–Fri holidays always; a Saturday only if it was actually worked.
      if (hol.has(key) && ((dow >= 1 && dow <= 5) || (dow === 6 && (d.start || d.end)))) {
        return { ...d, code: 'F', start: '', end: '', pause: 0 };
      }
      return d;
    }));
  };

  // "Match the payslip": scatter U (Urlaub) and K (Krank) onto random working
  // days so their counts match the Lohnabrechnung, and pull work-day start
  // times earlier into the 04:00–06:00 window so the computed 25% night hours
  // equal the payslip's Nachtzuschlag (decimal, e.g. "10,50" = 10.5 h). The end
  // stays put, so the shift simply starts earlier and the total hours grow to
  // include the night — matching how the driver actually worked.
  const matchPayslip = () => {
    const uCount = Math.max(0, Math.floor(absU) || 0);
    const kCount = Math.max(0, Math.floor(absK) || 0);
    const t25 = Math.max(0, Math.round((parseFloat((absN25 || '').replace(',', '.')) || 0) * 60)); // target 25% minutes
    const hasPattern = !!(massStart && massEnd);

    // Baseline. With a pattern (mass flow) every eligible weekday is reset to a
    // clean work day so the result is exact and re-runnable; without one (single
    // month) the day's own times are kept.
    const base = days.map(d => {
      if (d.code === 'F') return { ...d };
      const dow = new Date(year, month - 1, d.day).getDay();
      const weekend = dow === 0 || dow === 6;
      if (weekend && !(d.start || d.end)) return { ...d };
      if (hasPattern) return { ...d, code: '', start: massStart, end: massEnd, pause: massPause };
      return { ...d };
    });

    const bounded = boundByEmployment(base, year, month, lohnEmp?.eintritt, lohnEmp?.austritt);
    const uu = lohnFor(period)?.uu ?? [];
    const { days: next, placed25, workCount } = distributePayslip(bounded, uCount, kCount, t25, uu);
    setDays(next);

    // Feedback when the month can't hold what was requested.
    const warnings: string[] = [];
    if (uCount + kCount > workCount) {
      warnings.push(locale === 'de'
        ? `Nur ${workCount} Arbeitstage — ${uCount + kCount} U/K angefordert.`
        : `Tylko ${workCount} dni roboczych — zażądano ${uCount + kCount} U/K.`);
    }
    if (t25 > placed25) {
      warnings.push(locale === 'de'
        ? `25% auf ${(placed25 / 60).toFixed(2).replace('.', ',')} h begrenzt (max. 2 h/Tag).`
        : `25% ograniczone do ${(placed25 / 60).toFixed(2).replace('.', ',')} h (maks. 2 h/dzień).`);
    }
    setError(warnings.join(' '));
  };

  const stzPayload = () => ({
    name,
    year,
    month,
    days: days.map(d => ({ day: d.day, start: d.start, end: d.end, pause: d.pause, code: d.code })),
  });

  // Fill the ORIGINAL DATEV Excel template (1:1 with the source file)
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const handleDatevXlsx = async () => {
    setXlsxBusy(true);
    setError('');
    try {
      const { downloadStundenzettelXlsx } = await import('../lib/stundenzettel-xlsx');
      await downloadStundenzettelXlsx(stzPayload());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setXlsxBusy(false);
    }
  };

  // Same filled template, converted to PDF 1:1 on the server (LibreOffice)
  const [pdfBusy, setPdfBusy] = useState(false);
  const handleDatevPdf = async () => {
    setPdfBusy(true);
    setError('');
    try {
      const { downloadStundenzettelPdf } = await import('../lib/stundenzettel-xlsx');
      await downloadStundenzettelPdf(stzPayload());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  // Archive to the server storage (MEGA S4), like MAUT / driver cards
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const handleSaveToStorage = async () => {
    setSaveBusy(true);
    setError('');
    setSaveOk(false);
    try {
      const { saveStundenzettelToStorage } = await import('../lib/stundenzettel-xlsx');
      await saveStundenzettelToStorage(stzPayload());
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  // Mass generation: many months for ONE employee. "Prepare" fills each month
  // in the range from a shift pattern into monthGrids; you can then open any
  // month above and tweak it (e.g. add U = Urlaub); "Save all" writes one file
  // per month into the employee's folder (<Name>/XLSX, <Name>/PDF).
  const [massFrom, setMassFrom] = useState(period);
  const [massTo, setMassTo] = useState(period);
  const [massStart, setMassStart] = useState('06:00');
  const [massEnd, setMassEnd] = useState('15:00');
  const [massPause, setMassPause] = useState(45);
  const [massSat, setMassSat] = useState(false);
  const [massHolidays, setMassHolidays] = useState(true);
  const [massPrepared, setMassPrepared] = useState(false);
  const [massBusy, setMassBusy] = useState(false);
  const [massProgress, setMassProgress] = useState('');
  const [massResult, setMassResult] = useState<{ ok: number; errors: { label: string; error: string }[] } | null>(null);
  const massMonths = useMemo(() => monthsBetween(massFrom, massTo), [massFrom, massTo]);
  const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
  const resetPrepared = () => setMassPrepared(false);

  // Fill every month in the range with the pattern, then open the first month
  // for editing. Snapshots the currently-open month first.
  const handleMassPrepare = () => {
    if (!name.trim()) { setError(locale === 'de' ? 'Bitte Mitarbeiternamen oben eingeben.' : 'Wpisz nazwisko pracownika u góry.'); return; }
    if (!massStart || !massEnd) { setError(locale === 'de' ? 'Bitte Start und Ende angeben.' : 'Podaj godziny start i koniec.'); return; }
    if (massMonths.length === 0) { setError(locale === 'de' ? 'Ungültiger Monatsbereich.' : 'Zły zakres miesięcy.'); return; }
    setError('');
    setMassResult(null);
    const grids: Record<string, EditableDay[]> = { ...monthGrids, [period]: days };
    for (const { year: y, month: m } of massMonths) {
      let pat = buildMonthDaysPattern(y, m, massStart, massEnd, massPause, massSat, massHolidays);
      // Respect the employment period (mid-month Eintritt / Austritt).
      pat = boundByEmployment(pat, y, m, lohnEmp?.eintritt, lohnEmp?.austritt);
      // Auto-apply the payslip for this month if a Lohn export was imported:
      // scatter its U/K days and pull starts earlier to hit the 25% night hours.
      const lm = lohnEmp?.months.find(x => x.period === ymKey(y, m));
      const u = Math.round(lm?.urlaub || 0);
      const k = Math.round(lm?.krank || 0);
      const t25 = Math.round((lm?.night25 || 0) * 60);
      const uu = lm?.uu ?? [];
      grids[ymKey(y, m)] = (u || k || t25 || uu.length) ? distributePayslip(pat, u, k, t25, uu).days : pat;
    }
    setMonthGrids(grids);
    const [fy, fm] = massFrom.split('-').map(Number);
    setPeriod(massFrom);
    setDays((grids[massFrom] || makeEmptyDays(fy, fm)).map(d => ({ ...d })));
    applyLohnMonth(lohnFor(massFrom));
    setMassPrepared(true);
  };

  // Save every month in the range from monthGrids (live edits of the open
  // month included), each into the employee's folder.
  const handleMassSaveAll = async () => {
    if (!name.trim() || massMonths.length === 0) return;
    setMassBusy(true);
    setError('');
    setMassResult(null);
    try {
      const grids: Record<string, EditableDay[]> = { ...monthGrids, [period]: days };
      const items = massMonths.map(({ year: y, month: m }) => ({
        name,
        year: y,
        month: m,
        days: grids[ymKey(y, m)] || buildMonthDaysPattern(y, m, massStart, massEnd, massPause, massSat, massHolidays),
      }));
      const { saveManyStundenzettelToStorage } = await import('../lib/stundenzettel-xlsx');
      const res = await saveManyStundenzettelToStorage(
        items,
        (done, total, current) => setMassProgress(current ? `${done}/${total} — ${current}` : `${done}/${total}`),
      );
      setMassResult(res);
      if (res.errors.length) setError(res.errors.map(e => `${e.label}: ${e.error}`).join(' | '));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMassBusy(false);
      setMassProgress('');
    }
  };

  // Import a DATEV LohnViewer .ans export → 25% night hours per month. Picks the
  // employee matching the typed name (else the only/first), sets the name and
  // month range, and prefills the open month's 25% field.
  const handleLohnAns = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLohnBusy(true);
    setError('');
    try {
      const res = await parseLohnAns(file);
      const emps = res.employees || [];
      setLohnAll(emps);
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim();
      let pick: LohnEmployee | null = null;
      if (name.trim()) {
        const want = new Set(norm(name).split(/\s+/).filter(w => w.length >= 3));
        pick = emps.find(emp => norm(emp.name).split(/\s+/).some(w => w.length >= 3 && want.has(w))) || null;
      }
      if (!pick) pick = emps[0] || null;
      setLohnEmp(pick);
      if (pick) {
        if (!name.trim()) setName(pick.name);
        const ps = pick.months.map(m => m.period).sort();
        if (ps.length) { setMassFrom(ps[0]); setMassTo(ps[ps.length - 1]); resetPrepared(); }
        applyLohnMonth(pick.months.find(m => m.period === period));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLohnBusy(false);
      if (lohnRef.current) lohnRef.current.value = '';
    }
  }, [name, period]);

  // Batch-clean every stored Stundenzettel PDF on MEGA S4: remove the Vorlage
  // title, DATEV logo and signature labels (right → "Kontrolle durch").
  const handleCleanPdfs = useCallback(async () => {
    if (!window.confirm(locale === 'de'
      ? 'Alle gespeicherten Stundenzettel (PDF + Excel) bereinigen (Vorlage-Titel, DATEV-Logo und Unterschriften entfernen, auf eine Seite)? Die Dateien werden überschrieben.'
      : 'Wyczyścić wszystkie zapisane pliki (PDF + Excel) — usunąć napis Vorlage, logo DATEV i podpisy, zmieścić na jednej stronie? Pliki zostaną nadpisane.')) return;
    setCleaning(true);
    cleanCancelRef.current = false;
    setCleanResult(null);
    setError('');
    try {
      const { pdfs, xlsx } = await listStundenzettelFiles();
      const jobs = [
        ...pdfs.map(p => ({ path: p, kind: 'pdf' as const })),
        ...xlsx.map(p => ({ path: p, kind: 'xlsx' as const })),
      ];
      let changed = 0, errors = 0, done = 0;
      for (const j of jobs) {
        if (cleanCancelRef.current) break;
        done++;
        setCleanProgress({ done, total: jobs.length, current: j.path.split('/').pop() || j.path });
        try {
          const r = j.kind === 'pdf' ? await cleanStundenzettelPdf(j.path) : await cleanStundenzettelXlsx(j.path);
          if (r.changed) changed++;
        } catch {
          errors++;
        }
      }
      setCleanResult({ changed, total: jobs.length, errors });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
      setCleanProgress({ done: 0, total: 0, current: '' });
    }
  }, [locale]);

  // Calculate totals
  const totals = useMemo(() => {
    let workMin = 0, n25 = 0, n40 = 0, diets = 0, workDays = 0;
    let sick = 0, vacation = 0, holidays = 0;
    for (const d of days) {
      if (d.code === 'K') { sick++; continue; }
      if (d.code === 'U') { vacation++; continue; }
      if (d.code === 'F') { holidays++; continue; }
      if (d.code) continue;
      const c = calcDay(d, isSunday(year, month, d.day), weekendDiet);
      if (c.work > 0) {
        workMin += c.work; n25 += c.night25; n40 += c.night40; workDays++;
        if (c.diet) diets++;
      }
    }
    return { workMin, n25, n40, diets, workDays, sick, vacation, holidays };
  }, [days]);

  // Bulk fill state
  const [bulkStart, setBulkStart] = useState('');
  const [bulkEnd, setBulkEnd] = useState('');
  const [bulkPause, setBulkPause] = useState(0);
  const [bulkRange, setBulkRange] = useState<'month' | 'week' | 'custom'>('month');
  const [bulkWeek, setBulkWeek] = useState(1);
  const [bulkOnlyEmpty, setBulkOnlyEmpty] = useState(true);
  const [bulkSelectedDays, setBulkSelectedDays] = useState<Set<number>>(new Set());

  const toggleBulkDay = (day: number) => {
    setBulkSelectedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const weeksInMonth = useMemo(() => {
    const count = daysInMonth(year, month);
    const weeks: { num: number; label: string }[] = [];
    let weekStart = 1;
    for (let d = 1; d <= count; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      // End of week (Sunday) or last day of month
      if (dow === 0 || d === count) {
        weeks.push({ num: weeks.length + 1, label: `${weekStart}–${d}` });
        weekStart = d + 1;
      }
    }
    return weeks;
  }, [year, month]);

  // Map each day to its week number
  const dayToWeek = useMemo(() => {
    const map: Record<number, number> = {};
    let wk = 1;
    const count = daysInMonth(year, month);
    for (let d = 1; d <= count; d++) {
      map[d] = wk;
      if (new Date(year, month - 1, d).getDay() === 0 && d < count) wk++;
    }
    return map;
  }, [year, month]);

  const applyBulkFill = () => {
    if (!bulkStart && !bulkEnd) return;
    if (bulkRange === 'custom' && bulkSelectedDays.size === 0) return;
    setDays(prev => prev.map(d => {
      if (d.code) return d;
      if (bulkOnlyEmpty && (d.start || d.end)) return d;
      if (bulkRange === 'custom') {
        if (!bulkSelectedDays.has(d.day)) return d;
      } else {
        const dow = new Date(year, month - 1, d.day).getDay();
        if (dow === 0 || dow === 6) return d;
        if (bulkRange === 'week' && dayToWeek[d.day] !== bulkWeek) return d;
      }
      return { ...d, start: bulkStart || d.start, end: bulkEnd || d.end, pause: bulkPause };
    }));
  };

  const hasAnyData = days.some(d => d.start || d.end || d.code);

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Header with period picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('stzTitle')}</h1>
          <p className="text-sm text-muted mt-1">{t('stzSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelect
            value={period}
            onChange={handlePeriodChange}
            className="input rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Name + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('stzNamePlaceholder')}
          className="input rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] max-w-sm"
        />
        <label className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm cursor-pointer rounded-lg">
          <Upload size={14} />
          {t('stzOcrFill')}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleOcrUpload} />
        </label>
        <button onClick={handleDatevXlsx} disabled={xlsxBusy}
          className="btn-primary inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50">
          {xlsxBusy ? <Spinner size="sm" /> : <FileDown size={14} />} Excel (DATEV)
        </button>
        <button onClick={handleDatevPdf} disabled={pdfBusy}
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50">
          {pdfBusy ? <Spinner size="sm" /> : <FileDown size={14} />} PDF (DATEV)
        </button>
        <button onClick={handleSaveToStorage} disabled={saveBusy}
          title={locale === 'de' ? 'Auf dem Server-Speicher ablegen (MEGA S4)' : 'Zapisz w magazynie serwera (MEGA S4)'}
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50">
          {saveBusy ? <Spinner size="sm" /> : saveOk ? <Check size={14} className="text-emerald-600" /> : <CloudUpload size={14} />}
          {saveOk ? (locale === 'de' ? 'Gespeichert' : 'Zapisano') : (locale === 'de' ? 'Auf Server speichern' : 'Zapisz na dysku')}
        </button>
        {loading && <Spinner />}
        {hasAnyData && (
          <button onClick={clearAll} className="text-xs text-muted hover:text-red-500 flex items-center gap-1">
            <Trash2 size={13} /> {t('stzClear')}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Bulk fill */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t('stzBulkFill')}</span>
          <input type="time" value={bulkStart} onChange={e => setBulkStart(e.target.value)}
            placeholder={t('stzStart')} className="input rounded px-2 py-1 text-xs font-mono w-24" />
          <input type="time" value={bulkEnd} onChange={e => setBulkEnd(e.target.value)}
            placeholder={t('stzEnd')} className="input rounded px-2 py-1 text-xs font-mono w-24" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted">{t('stzPause')}</span>
            <input type="number" min={0} max={120} value={bulkPause || ''} placeholder="0"
              onChange={e => setBulkPause(parseInt(e.target.value) || 0)}
              className="input rounded px-2 py-1 text-xs font-mono w-14 text-center" />
          </div>
          <select value={bulkRange} onChange={e => setBulkRange(e.target.value as 'month' | 'week' | 'custom')}
            className="input rounded px-2 py-1 text-xs">
            <option value="month">{t('stzBulkWholeMonth')}</option>
            <option value="week">{t('stzBulkWeek')}</option>
            <option value="custom">{t('stzBulkCustom')}</option>
          </select>
          {bulkRange === 'week' && (
            <select value={bulkWeek} onChange={e => setBulkWeek(parseInt(e.target.value))}
              className="input rounded px-2 py-1 text-xs">
              {weeksInMonth.map(w => (
                <option key={w.num} value={w.num}>{t('stzBulkWeek')} {w.num} ({w.label})</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={bulkOnlyEmpty} onChange={e => setBulkOnlyEmpty(e.target.checked)}
              className="rounded" />
            {t('stzBulkOnlyEmpty')}
          </label>
          <button onClick={applyBulkFill} disabled={(!bulkStart && !bulkEnd) || (bulkRange === 'custom' && bulkSelectedDays.size === 0)}
            className="btn-primary px-3 py-1 text-xs rounded-lg disabled:opacity-40">
            {t('stzBulkApply')}
          </button>
          <button onClick={applyHolidays}
            title={locale === 'de' ? 'Feiertage (Berlin) als F markieren' : 'Oznacz święta (Berlin) jako F'}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted hover:bg-surface">
            <CalendarDays size={12} /> {locale === 'de' ? 'Feiertage BE' : 'Święta BE'}
          </button>
          {/* Match the Lohnabrechnung: U/K day counts + 25% night hours */}
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-900/10 px-2 py-1"
            title={locale === 'de'
              ? 'An die Lohnabrechnung anpassen: U/K zufällig verteilen und Start früher legen, bis die 25%-Stunden passen'
              : 'Dopasuj do listy płac: rozłóż U/K losowo i przesuń start wcześniej, aż zgodzą się godziny 25%'}>
            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{locale === 'de' ? 'Lohnabr.' : 'Lista płac'}</span>
            <label className="flex items-center gap-0.5 text-[11px] text-muted">U
              <input type="number" min={0} value={absU || ''} onChange={e => setAbsU(parseInt(e.target.value) || 0)}
                className="input w-10 rounded px-1 py-0.5 text-xs" />
            </label>
            <label className="flex items-center gap-0.5 text-[11px] text-muted">K
              <input type="number" min={0} value={absK || ''} onChange={e => setAbsK(parseInt(e.target.value) || 0)}
                className="input w-10 rounded px-1 py-0.5 text-xs" />
            </label>
            <label className="flex items-center gap-0.5 text-[11px] text-muted">{locale === 'de' ? '25%-Std' : '25% godz'}
              <input type="text" inputMode="decimal" value={absN25} onChange={e => setAbsN25(e.target.value)} placeholder="10,50"
                className="input w-14 rounded px-1 py-0.5 text-xs" />
            </label>
            {(() => {
              const lm = lohnFor(period);
              if (!lm) return null;
              return (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
                  title={locale === 'de' ? 'Aus Lohn-Export (.ans)' : 'Z listy płac (.ans)'}>
                  <Check size={11} />
                  {`25%:${fmtHoursDe(lm.night25)}${lm.via_nb ? ' NB' : ''}`}
                  {lm.urlaub > 0 ? ` · U:${Math.round(lm.urlaub)}` : ''}
                  {lm.krank > 0 ? ` · K:${Math.round(lm.krank)}` : ''}
                  {lm.uu.length > 0 ? ` · UU:${lm.uu.map(r => r[0] === r[1] ? `${r[0]}.` : `${r[0]}.–${r[1]}.`).join(',')}` : ''}
                </span>
              );
            })()}
            <button onClick={matchPayslip} disabled={absU + absK === 0 && !absN25.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-amber-600 text-white px-2 py-0.5 text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
              <Shuffle size={12} /> {locale === 'de' ? 'Anpassen' : 'Dopasuj'}
            </button>
          </div>
        </div>
        {bulkRange === 'custom' && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {days.map(d => {
              const wd = getWeekday(year, month, d.day);
              const weekend = isWeekend(year, month, d.day);
              const selected = bulkSelectedDays.has(d.day);
              return (
                <button key={d.day} onClick={() => toggleBulkDay(d.day)}
                  className={`w-8 h-8 rounded text-[10px] font-medium border transition-colors ${
                    selected
                      ? 'bg-primary-600 text-white border-primary-600'
                      : weekend
                      ? 'bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-500'
                      : 'bg-white text-ink border-gray-300 hover:border-primary-400 dark:bg-gray-900 dark:border-gray-600'
                  }`}
                  title={`${d.day} ${wd}`}
                >
                  {d.day}
                </button>
              );
            })}
            {bulkSelectedDays.size > 0 && (
              <button onClick={() => setBulkSelectedDays(new Set())}
                className="text-[10px] text-muted hover:text-red-500 ml-1">
                {t('stzClear')}
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Mass generation — one sheet per employee, saved into per-name folders */}
      <Card className="p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Users size={15} className="text-primary-600" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              {locale === 'de' ? 'Massengenerierung — mehrere Monate' : 'Masowe generowanie — wiele miesięcy'}
            </span>
            <span className="text-[11px] text-muted">
              {locale === 'de' ? 'Mitarbeiter: ' : 'Pracownik: '}
              <b className="text-ink">{name || (locale === 'de' ? '— oben eintragen —' : '— wpisz u góry —')}</b>
            </span>
            <label className="ml-auto btn-secondary inline-flex items-center gap-2 px-2.5 py-1 text-xs cursor-pointer"
              title={locale === 'de' ? 'DATEV LohnViewer .ans importieren — füllt die 25%-Nachtstunden je Monat' : 'Importuj DATEV LohnViewer .ans — uzupełnia godziny 25% na miesiąc'}>
              {lohnBusy ? <Spinner size="sm" /> : <FileDown size={13} />}
              {locale === 'de' ? 'Lohn (.ans)' : 'Lohn (.ans)'}
              <input ref={lohnRef} type="file" accept=".ans,.txt" className="hidden" onChange={handleLohnAns} />
            </label>
            {lohnEmp && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400" title={lohnEmp.months.map(m => `${m.period}: ${fmtHoursDe(m.night25)}${m.via_nb ? ' (NB)' : ''}`).join('\n')}>
                <Check size={12} /> {lohnEmp.name} · {lohnEmp.months.length} {locale === 'de' ? 'Monate (25%)' : 'mies. (25%)'}
              </span>
            )}
          </div>
          {lohnAll.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted">{locale === 'de' ? 'Mitarbeiter im Export:' : 'Pracownicy w eksporcie:'}</span>
              {lohnAll.map(emp => (
                <button key={emp.pers_nr}
                  onClick={() => {
                    setLohnEmp(emp);
                    if (!name.trim()) setName(emp.name);
                    const ps = emp.months.map(m => m.period).sort();
                    if (ps.length) { setMassFrom(ps[0]); setMassTo(ps[ps.length - 1]); resetPrepared(); }
                    applyLohnMonth(emp.months.find(m => m.period === period));
                  }}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium border ${lohnEmp?.pers_nr === emp.pers_nr ? 'bg-primary-600 text-white border-primary-600' : 'border-border text-muted hover:bg-surface'}`}>
                  {emp.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted">{locale === 'de' ? 'Von' : 'Od'}</span>
            <MonthSelect value={massFrom} onChange={(v) => { setMassFrom(v); resetPrepared(); }} className="input rounded-lg px-2 py-1 text-sm" />
            <span className="text-xs text-muted">{locale === 'de' ? 'bis' : 'do'}</span>
            <MonthSelect value={massTo} onChange={(v) => { setMassTo(v); resetPrepared(); }} className="input rounded-lg px-2 py-1 text-sm" />
            <span className="ml-2 text-xs text-muted">{locale === 'de' ? 'Zeiten' : 'Godziny'}</span>
            <input type="time" value={massStart} onChange={e => { setMassStart(e.target.value); resetPrepared(); }}
              className="input rounded px-2 py-1 text-xs font-mono w-24" />
            <input type="time" value={massEnd} onChange={e => { setMassEnd(e.target.value); resetPrepared(); }}
              className="input rounded px-2 py-1 text-xs font-mono w-24" />
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted">{t('stzPause')}</span>
              <input type="number" min={0} max={180} value={massPause || ''} placeholder="0"
                onChange={e => { setMassPause(parseInt(e.target.value) || 0); resetPrepared(); }}
                className="input rounded px-2 py-1 text-xs font-mono w-14 text-center" />
            </div>
            <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={massSat} onChange={e => { setMassSat(e.target.checked); resetPrepared(); }} className="rounded" />
              {locale === 'de' ? 'inkl. Sa' : 'z sobotą'}
            </label>
            <label className="flex items-center gap-1 text-xs text-muted cursor-pointer" title={locale === 'de' ? 'Feiertage Berlin automatisch als F markieren' : 'Automatycznie oznacz święta (Berlin) jako F'}>
              <input type="checkbox" checked={massHolidays} onChange={e => { setMassHolidays(e.target.checked); resetPrepared(); }} className="rounded" />
              {locale === 'de' ? 'Feiertage (Berlin)' : 'Święta (Berlin)'}
            </label>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={handleMassPrepare} disabled={massBusy || massMonths.length === 0 || !name.trim() || !massStart || !massEnd}
              className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50">
              <CalendarDays size={14} />
              {locale === 'de' ? `${massMonths.length} Monate vorbereiten` : `Przygotuj (${massMonths.length} mies.)`}
            </button>
            <button onClick={handleMassSaveAll} disabled={massBusy || !massPrepared || massMonths.length === 0}
              className="btn-primary inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50">
              {massBusy ? <Spinner size="sm" /> : <CloudUpload size={14} />}
              {locale === 'de' ? `Alle speichern (${massMonths.length})` : `Zapisz wszystkie (${massMonths.length})`}
            </button>
            {massBusy && massProgress && <span className="text-xs text-muted">{massProgress}</span>}
            {!massBusy && massResult && (
              <span className="text-xs">
                <span className="font-medium text-emerald-600">{massResult.ok} OK</span>
                {massResult.errors.length > 0 && (
                  <span className="text-red-500"> · {massResult.errors.length} {locale === 'de' ? 'Fehler' : 'błędów'}</span>
                )}
              </span>
            )}
          </div>
          {massPrepared && (
            <p className="text-[11px] text-muted">
              {locale === 'de'
                ? '✏️ Monate vorbereitet — oben den Monat wählen und in der Tabelle anpassen (z. B. U = Urlaub, K = Krank), dann „Alle speichern". Gespeichert je in …/Name/XLSX und …/Name/PDF.'
                : '✏️ Miesiące przygotowane — wybierz miesiąc u góry i popraw w tabeli (np. U = urlop, K = chory), potem „Zapisz wszystkie". Zapis do …/Nazwisko/XLSX i …/Nazwisko/PDF.'}
            </p>
          )}
        </div>
      </Card>

      {/* Batch-clean stored PDFs: strip Vorlage title / DATEV logo / signatures */}
      <Card className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <FileDown size={15} className="text-primary-600" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            {locale === 'de' ? 'Gespeicherte Dateien bereinigen' : 'Wyczyść zapisane pliki'}
          </span>
          <span className="text-[11px] text-muted">
            {locale === 'de'
              ? 'Entfernt Vorlage-Titel, DATEV-Logo und Unterschriften (rechts → „Kontrolle durch") aus allen PDFs und Excel-Dateien auf MEGA S4 und legt sie auf eine Seite.'
              : 'Usuwa napis Vorlage, logo DATEV i podpisy (prawy → „Kontrolle durch") ze wszystkich PDF-ów i Exceli na MEGA S4 i mieści na jednej stronie.'}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {cleaning ? (
              <>
                <Spinner size="sm" />
                <span className="text-xs text-muted">{cleanProgress.done}/{cleanProgress.total} — {cleanProgress.current}</span>
                <button onClick={() => { cleanCancelRef.current = true; }} className="text-danger text-xs font-medium">Stop</button>
              </>
            ) : (
              <button onClick={handleCleanPdfs}
                className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg">
                <FileDown size={14} />
                {locale === 'de' ? 'Alle Dateien bereinigen' : 'Wyczyść wszystkie pliki'}
              </button>
            )}
            {!cleaning && cleanResult && (
              <span className="text-xs">
                <span className="font-medium text-emerald-600">{cleanResult.changed} {locale === 'de' ? 'bereinigt' : 'wyczyszczone'}</span>
                <span className="text-muted"> / {cleanResult.total}</span>
                {cleanResult.errors > 0 && <span className="text-red-500"> · {cleanResult.errors} {locale === 'de' ? 'Fehler' : 'błędów'}</span>}
              </span>
            )}
          </div>
        </div>
      </Card>

      <ErrorBoundary>
        {/* Stats - only show when there's data */}
        {hasAnyData && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<Clock size={20} />} label={t('stzWorkHours')} value={hm(totals.workMin)} color="primary" />
              <StatCard icon={<Moon size={20} />} label={t('stzNightHours')} value={hm(totals.n25 + totals.n40)} color="blue" />
              <StatCard icon={<UtensilsCrossed size={20} />} label={t('stzDiets')} value={totals.diets} color="green" />
              <StatCard icon={<CalendarDays size={20} />} label={t('stzWorkDays')} value={totals.workDays} color="primary" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<Thermometer size={20} />} label={t('stzSickDays')} value={totals.sick} color="red" />
              <StatCard icon={<Palmtree size={20} />} label={t('stzVacationDays')} value={totals.vacation} color="green" />
              <StatCard icon={<Star size={20} />} label={t('stzHolidays')} value={totals.holidays} color="blue" />
              <StatCard icon={<Moon size={20} />} label="Nacht 25% / 40%" value={`${hm(totals.n25)} / ${hm(totals.n40)}`} color="blue" />
            </div>

            {/* Copy grid */}
            <StzCopyGrid days={days} year={year} month={month} totals={totals} weekendDiet={weekendDiet} />
          </>
        )}

        {/* Editable table - always visible */}
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-1 sm:px-2 py-2 text-left font-semibold text-muted w-8 sm:w-10">{t('stzDay')}</th>
                <th className="px-1 py-2 text-left font-semibold text-muted w-6 sm:w-8"></th>
                <th className="px-0.5 sm:px-1 py-2 text-center font-semibold text-muted w-16 sm:w-24">{t('stzStart')}</th>
                <th className="px-0.5 sm:px-1 py-2 text-center font-semibold text-muted w-16 sm:w-24">{t('stzEnd')}</th>
                <th className="px-0.5 sm:px-1 py-2 text-center font-semibold text-muted w-12 sm:w-16">{t('stzPause')}</th>
                <th className="px-0.5 sm:px-1 py-2 text-center font-semibold text-muted w-10 sm:w-16 hidden xs:table-cell">{t('stzCode')}</th>
                <th className="px-1 sm:px-2 py-2 text-center font-semibold text-muted w-14 sm:w-16">{t('stzWork')}</th>
                <th className="px-2 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzNight')}</th>
                <th className="px-2 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzDiet')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, idx) => {
                const wd = getWeekday(year, month, day.day);
                const weekend = isWeekend(year, month, day.day);
                const c = calcDay(day, isSunday(year, month, day.day), weekendDiet);
                const hasCode = !!day.code;
                const rowColor = day.code ? (CODE_COLORS[day.code] || '') : weekend ? 'bg-gray-50/50 dark:bg-gray-800/20' : '';

                return (
                  <tr key={day.day} className={`border-b border-border ${rowColor}`}>
                    <td className="px-2 py-1 font-medium text-ink">{day.day}</td>
                    <td className={`px-2 py-1 text-xs ${weekend ? 'font-bold text-red-500' : 'text-muted'}`}>{wd}</td>
                    <td className="px-1 py-1">
                      <input type="time" value={day.start} onChange={e => updateDay(idx, 'start', e.target.value)}
                        disabled={hasCode} className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-30" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="time" value={day.end} onChange={e => updateDay(idx, 'end', e.target.value)}
                        disabled={hasCode} className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-30" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" min={0} max={120} value={day.pause || ''} placeholder="0"
                        onChange={e => updateDay(idx, 'pause', parseInt(e.target.value) || 0)}
                        disabled={hasCode} className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-30" />
                    </td>
                    <td className="px-1 py-1">
                      <select value={day.code} onChange={e => {
                        updateDay(idx, 'code', e.target.value);
                        if (e.target.value) { updateDay(idx, 'start', ''); updateDay(idx, 'end', ''); updateDay(idx, 'pause', 0); }
                      }} className="input w-full text-xs px-1 py-0.5 rounded">
                        {CODE_OPTIONS.map(c => <option key={c} value={c}>{c || '—'}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center font-mono text-xs font-medium">
                      {c.work > 0 ? hm(c.work) : ''}
                    </td>
                    <td className="px-2 py-1 text-center text-xs hidden sm:table-cell">
                      {(c.night25 + c.night40) > 0 && <span className="text-blue-600 dark:text-blue-400 font-medium">{hm(c.night25 + c.night40)}</span>}
                    </td>
                    <td className="px-2 py-1 text-center hidden sm:table-cell">
                      {c.diet && <Badge variant="green">D</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface font-semibold">
                <td className="px-2 py-3" colSpan={2}>{t('stzTotal')}</td>
                <td className="px-1 py-3" colSpan={4}></td>
                <td className="px-2 py-3 text-center font-mono">{hm(totals.workMin)}</td>
                <td className="px-2 py-3 text-center font-mono text-blue-600 hidden sm:table-cell">{hm(totals.n25 + totals.n40)}</td>
                <td className="px-2 py-3 text-center hidden sm:table-cell"><Badge variant="green">{totals.diets}</Badge></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </ErrorBoundary>
    </div>
  );
}

// --- Copy Grid ---

function StzCopyGrid({ days, year, month, totals, weekendDiet = false }: {
  days: EditableDay[]; year: number; month: number;
  totals: { workMin: number; n25: number; n40: number; diets: number; sick: number; vacation: number; holidays: number; workDays: number };
  weekendDiet?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const dayValues = useMemo(() => {
    return days.map(d => {
      if (d.code === 'K') return 'Kr';
      if (d.code === 'U') return 'Ur';
      if (d.code === 'F') return 'F';
      if (d.code) return d.code;
      const c = calcDay(d, isSunday(year, month, d.day), weekendDiet);
      return c.work > 0 ? hm(c.work) : '';
    });
  }, [days]);

  const weekdays = days.map(d => {
    try { return WEEKDAYS_SHORT[new Date(year, month - 1, d.day).getDay()]; } catch { return ''; }
  });

  const n25 = (totals.n25 / 60).toFixed(2).replace('.', ',');
  const n40 = (totals.n40 / 60).toFixed(2).replace('.', ',');
  const az = hm(totals.workMin);
  const vma = String(totals.diets);
  const ur = totals.vacation > 0 ? String(totals.vacation) : '';
  const kr = totals.sick > 0 ? String(totals.sick) : '';

  const summaryHeaders = ['25%', '40%', 'Ü', 'Ur', 'Kr', 'VMA', 'AZ'];
  const summaryValues = [n25, n40, '', ur, kr, vma, az];

  const handleCopy = useCallback(() => {
    const tsv = [...dayValues, ...summaryValues].join('\t');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [dayValues, summaryValues]);

  const thCls = 'border border-gray-300 bg-gray-200/60 px-1 py-0.5 text-center text-[10px] font-bold text-muted dark:border-gray-600 dark:bg-gray-700';
  const tdCls = 'border border-gray-300 bg-white px-1 py-0.5 text-center font-mono text-[10px] dark:border-gray-600 dark:bg-gray-900';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {String(month).padStart(2, '0')}/{year}
        </span>
        <button onClick={handleCopy}
          className="flex items-center gap-1 rounded-lg bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-200 dark:bg-primary-900/30 dark:hover:bg-primary-900/50">
          {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
          {copied ? 'OK!' : t('stzCopy')}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {days.map(d => <th key={d.day} className={thCls}>{d.day}</th>)}
              {summaryHeaders.map(h => <th key={h} className={thCls}>{h}</th>)}
            </tr>
            <tr>
              {weekdays.map((wd, i) => (
                <th key={i} className={`${thCls} ${wd === 'So' || wd === 'Sa' ? '!text-red-400 !bg-red-50 dark:!bg-red-900/20' : ''}`}>{wd}</th>
              ))}
              {summaryHeaders.map(h => <th key={`e-${h}`} className="w-1" />)}
            </tr>
          </thead>
          <tbody>
            <tr>
              {dayValues.map((val, i) => {
                let cls = tdCls;
                if (val === 'Ur') cls += ' !bg-blue-100 !text-blue-700 font-bold dark:!bg-blue-900/40';
                else if (val === 'Kr') cls += ' !bg-orange-100 !text-orange-700 font-bold dark:!bg-orange-900/40';
                else if (val === 'F') cls += ' !bg-blue-50 !text-blue-500 font-bold';
                else if (val) cls += ' font-semibold text-gray-800 dark:text-gray-200';
                return <td key={i} className={cls}>{val}</td>;
              })}
              {summaryValues.map((val, i) => <td key={i} className={`${tdCls} font-bold`}>{val}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
