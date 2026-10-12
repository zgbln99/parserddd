/**
 * Diacritics-insensitive text matching: "pieta" finds "Pięta", "muller"
 * finds "Müller", "lodz" finds "Łódź". NFD decomposition strips the
 * combining marks; the few letters that do not decompose (ł, ß, ø…) are
 * mapped by hand.
 */
const SPECIAL: Record<string, string> = {
  'ł': 'l', 'Ł': 'l', 'ß': 'ss', 'ø': 'o', 'Ø': 'o', 'đ': 'd', 'Đ': 'd', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe',
};

export function foldText(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[łŁßøØđĐæÆœŒ]/g, (c) => SPECIAL[c] ?? c)
    .toLowerCase();
}

/** True when every whitespace-separated word of `query` occurs in `text` (both folded). */
export function matchesText(text: string, query: string): boolean {
  const q = foldText(query).trim();
  if (!q) return true;
  const hay = foldText(text);
  return q.split(/\s+/).every((w) => hay.includes(w));
}
