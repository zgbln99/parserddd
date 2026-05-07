import type {
  EvaluationResult,
  Violation,
} from "../types/violation.js";
import type { Locale } from "../types/common.js";
import {
  groupViolations,
  summarizeViolations,
  violationToRow,
  type GroupedViolations,
  type ViolationRow,
  type ViolationSummary,
} from "./summary.js";

/**
 * Locale-bound, PDF-ready report structure. The compliance engine never
 * renders PDFs itself — it produces this stable structure, and the
 * frontend (jspdf / wkhtmltopdf / whatever) lays it out.
 *
 * Intentional design choices:
 *  - Strings are pre-localized (no MultilingualText leaking to the PDF)
 *  - Numeric values stay numeric, with `unit` carried along (so the PDF
 *    layer can format minutes vs. days however it likes)
 *  - Section ordering is stable: by category, then chronologically
 */
export interface PdfReport {
  readonly locale: Locale;
  readonly engine_version: string;
  readonly evaluated_at: string;
  readonly driver_id: string;
  readonly summary: ViolationSummary;
  readonly sections: readonly PdfSection[];
  readonly not_evaluable: readonly { rule_id: string; reason: string }[];
}

export interface PdfSection {
  readonly category: string;
  readonly heading: string;
  readonly rows: readonly ViolationRow[];
  readonly subtotal_driver_eur: number | null;
  readonly subtotal_company_eur: number | null;
}

const CATEGORY_HEADINGS: Record<Locale, Record<string, string>> = {
  de: {
    DRIVING_TIME: "Lenkzeiten",
    BREAKS: "Lenkpausen",
    REST: "Ruhezeiten",
    WORKING_TIME: "Arbeitszeit",
    TACHOGRAPH: "Tachograph",
    MANUAL_ENTRY: "Manuelle Nachträge",
    COUNTRY_ENTRY: "Ländereingaben",
    CARD: "Fahrerkarte",
    ACTIVITY_SELECTION: "Aktivitätswahl",
    DOWNLOAD: "Auslesungen",
    PRINTOUT: "Ausdrucke",
    EVENT_FAULT: "Ereignisse / Störungen",
    MANIPULATION: "Manipulationsverdacht",
    MULTI_MANNING: "Mehrfahrerbetrieb",
    NIGHT_WORK: "Nachtarbeit",
  },
  en: {
    DRIVING_TIME: "Driving time",
    BREAKS: "Breaks",
    REST: "Rest periods",
    WORKING_TIME: "Working time",
    TACHOGRAPH: "Tachograph",
    MANUAL_ENTRY: "Manual entries",
    COUNTRY_ENTRY: "Country entries",
    CARD: "Driver card",
    ACTIVITY_SELECTION: "Activity selection",
    DOWNLOAD: "Downloads",
    PRINTOUT: "Printouts",
    EVENT_FAULT: "Events / faults",
    MANIPULATION: "Manipulation indicators",
    MULTI_MANNING: "Multi-manning",
    NIGHT_WORK: "Night work",
  },
  pl: {
    DRIVING_TIME: "Czas jazdy",
    BREAKS: "Przerwy",
    REST: "Odpoczynki",
    WORKING_TIME: "Czas pracy",
    TACHOGRAPH: "Tachograf",
    MANUAL_ENTRY: "Wpisy manualne",
    COUNTRY_ENTRY: "Wpisy państw",
    CARD: "Karta kierowcy",
    ACTIVITY_SELECTION: "Wybór aktywności",
    DOWNLOAD: "Pobrania",
    PRINTOUT: "Wydruki",
    EVENT_FAULT: "Zdarzenia / usterki",
    MANIPULATION: "Wskaźniki manipulacji",
    MULTI_MANNING: "Załoga podwójna",
    NIGHT_WORK: "Praca nocna",
  },
};

export function buildPdfReport(
  result: EvaluationResult,
  locale: Locale,
): PdfReport {
  const summary = summarizeViolations(result);
  const grouped = groupViolations(result);
  const sections = buildSections(grouped, locale);

  return Object.freeze({
    locale,
    engine_version: result.engine_version,
    evaluated_at: result.evaluated_at.toISOString(),
    driver_id: result.driver_id,
    summary,
    sections,
    not_evaluable: Object.freeze([...result.not_evaluable]),
  });
}

function buildSections(
  grouped: GroupedViolations,
  locale: Locale,
): readonly PdfSection[] {
  const headings = CATEGORY_HEADINGS[locale];
  const out: PdfSection[] = [];
  const cats = Object.keys(grouped.by_category) as (keyof typeof grouped.by_category)[];
  for (const category of cats.sort()) {
    const violations = grouped.by_category[category] ?? [];
    if (violations.length === 0) continue;
    const sorted = [...violations].sort(
      (a, b) => a.start_time.getTime() - b.start_time.getTime(),
    );
    out.push({
      category,
      heading: headings[category] ?? category,
      rows: sorted.map((v: Violation) => violationToRow(v, locale)),
      subtotal_driver_eur: sumOrNull(sorted.map((v) => v.driver_fine_eur)),
      subtotal_company_eur: sumOrNull(sorted.map((v) => v.company_fine_eur)),
    });
  }
  return Object.freeze(out);
}

function sumOrNull(xs: readonly (number | null)[]): number | null {
  let total = 0;
  for (const x of xs) {
    if (x === null) return null;
    total += x;
  }
  return total;
}
