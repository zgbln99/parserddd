import { groupViolations, summarizeViolations, violationToRow, } from "./summary.js";
const CATEGORY_HEADINGS = {
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
export function buildPdfReport(result, locale) {
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
function buildSections(grouped, locale) {
    const headings = CATEGORY_HEADINGS[locale];
    const out = [];
    const cats = Object.keys(grouped.by_category);
    for (const category of cats.sort()) {
        const violations = grouped.by_category[category] ?? [];
        if (violations.length === 0)
            continue;
        const sorted = [...violations].sort((a, b) => a.start_time.getTime() - b.start_time.getTime());
        out.push({
            category,
            heading: headings[category] ?? category,
            rows: sorted.map((v) => violationToRow(v, locale)),
            subtotal_driver_eur: sumOrNull(sorted.map((v) => v.driver_fine_eur)),
            subtotal_company_eur: sumOrNull(sorted.map((v) => v.company_fine_eur)),
        });
    }
    return Object.freeze(out);
}
function sumOrNull(xs) {
    let total = 0;
    for (const x of xs) {
        if (x === null)
            return null;
        total += x;
    }
    return total;
}
//# sourceMappingURL=pdf-structure.js.map