/**
 * German public holidays (Feiertage) calculator.
 * Covers all nationwide holidays + configurable state-level ones.
 */

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  namePl: string;
}

/** Easter Sunday via Anonymous Gregorian algorithm */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get all German public holidays for a given year */
export function getGermanHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);

  const holidays: Holiday[] = [
    // Fixed holidays (nationwide)
    { date: `${year}-01-01`, name: 'Neujahr', namePl: 'Nowy Rok' },
    { date: `${year}-05-01`, name: 'Tag der Arbeit', namePl: 'Dzień Pracy' },
    { date: `${year}-10-03`, name: 'Tag der Dt. Einheit', namePl: 'Dzień Jedn. Niemiec' },
    { date: `${year}-12-25`, name: '1. Weihnachtstag', namePl: 'Boże Narodzenie' },
    { date: `${year}-12-26`, name: '2. Weihnachtstag', namePl: '2. dzień Świąt' },

    // Easter-based (nationwide)
    { date: toISO(addDays(easter, -2)), name: 'Karfreitag', namePl: 'Wielki Piątek' },
    { date: toISO(addDays(easter, 1)), name: 'Ostermontag', namePl: 'Poniedziałek Wielkanocny' },
    { date: toISO(addDays(easter, 39)), name: 'Christi Himmelfahrt', namePl: 'Wniebowstąpienie' },
    { date: toISO(addDays(easter, 50)), name: 'Pfingstmontag', namePl: 'Poniedziałek Zesł. Ducha Św.' },
  ];

  return holidays;
}

/** Build a map: "YYYY-MM-DD" → Holiday for quick lookup */
export function getHolidayMap(year: number): Map<string, Holiday> {
  const map = new Map<string, Holiday>();
  for (const h of getGermanHolidays(year)) {
    map.set(h.date, h);
  }
  return map;
}
