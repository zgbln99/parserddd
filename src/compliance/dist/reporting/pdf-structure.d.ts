import type { EvaluationResult } from "../types/violation.js";
import type { Locale } from "../types/common.js";
import { type ViolationRow, type ViolationSummary } from "./summary.js";
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
    readonly not_evaluable: readonly {
        rule_id: string;
        reason: string;
    }[];
}
export interface PdfSection {
    readonly category: string;
    readonly heading: string;
    readonly rows: readonly ViolationRow[];
    readonly subtotal_driver_eur: number | null;
    readonly subtotal_company_eur: number | null;
}
export declare function buildPdfReport(result: EvaluationResult, locale: Locale): PdfReport;
//# sourceMappingURL=pdf-structure.d.ts.map