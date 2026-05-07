const MONTHS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function formatDate(s: string | undefined, locale: string = 'pl'): string {
  if (!s) return '-';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const months = locale === 'de' ? MONTHS_DE : MONTHS_PL;
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return s;
  }
}

export function formatDateTime(s: string | undefined, locale: string = 'pl'): string {
  if (!s) return '-';
  try {
    // Handle malformed timestamps like "...+00:00Z" (both offset and Z)
    const cleaned = s.replace(/([+-]\d{2}:\d{2})Z$/, '$1');
    const d = new Date(cleaned);
    if (isNaN(d.getTime())) return s;
    const months = locale === 'de' ? MONTHS_DE : MONTHS_PL;
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${h}:${m}`;
  } catch {
    return s;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function daysLabel(days: number | null, locale: string = 'pl'): string {
  if (days === null || days === undefined) return locale === 'de' ? 'keine Daten' : 'brak danych';
  if (days === 0) return `0 ${locale === 'de' ? 'Tage' : 'dni'}`;
  if (days === 1) return `1 ${locale === 'de' ? 'Tag' : 'dzień'}`;
  return `${days} ${locale === 'de' ? 'Tage' : 'dni'}`;
}

export function daysColor(days: number | null): 'green' | 'orange' | 'red' {
  if (days === null || days === undefined) return 'red';
  if (days > 30) return 'red';
  if (days > 7) return 'orange';
  return 'green';
}

export const MONTHS_FULL_PL = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
export const MONTHS_FULL_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function monthLabel(period: string, locale: string = 'pl'): string {
  const [year, month] = period.split('-');
  const months = locale === 'de' ? MONTHS_FULL_DE : MONTHS_FULL_PL;
  const idx = parseInt(month, 10) - 1;
  return `${months[idx] || month} ${year}`;
}
