import { useRef, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { Download, FileText, Printer, Table2, Sheet, Scale, Clock, CalendarClock, ChevronDown } from 'lucide-react';

export interface ExportDropdownProps {
  onXlsx: () => void;
  onCsv: () => void;
  onArbeitszeitenCsv: () => void;
  onPdf: () => void;
  onArbeitszeitPdf: () => void;
  onDatev: () => void;
  onGoogleSheets: () => void;
  onStundenzettel: () => void;
  onPrint: () => void;
  fv: (feature: string) => boolean;
}

export function ExportDropdown({
  onXlsx,
  onCsv,
  onArbeitszeitenCsv,
  onPdf,
  onArbeitszeitPdf,
  onDatev,
  onGoogleSheets,
  onStundenzettel,
  onPrint,
  fv,
}: ExportDropdownProps) {
  const { t, locale } = useI18n();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

  return (
    <div className="flex justify-end" ref={exportRef}>
      <div className="relative">
        <button
          onClick={() => setExportOpen(!exportOpen)}
          className="flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          <Download size={14} />
          {locale === 'de' ? 'Exportieren' : 'Eksportuj'}
          <ChevronDown size={13} className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
        </button>
        {exportOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-xl bg-white dark:bg-[#1f2a37] border border-border py-1 animate-scale-in" style={{ boxShadow: 'rgba(0,0,0,0.12) 0px 4px 24px' }}>
            {fv('export_xlsx') && <button onClick={() => { onXlsx(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <Download size={14} className="text-[#5750f1]" /> {t('analysisExportXlsx')}
            </button>}
            {fv('export_csv') && <button onClick={() => { onCsv(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <Download size={14} className="text-muted" /> {t('analysisExportCsv')}
            </button>}
            {fv('export_arbeitszeiten_csv') && <button onClick={() => { onArbeitszeitenCsv(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <CalendarClock size={14} className="text-sky-500" /> {t('analysisExportArbeitszeiten')}
            </button>}
            {fv('export_pdf') && <button onClick={() => { onPdf(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <FileText size={14} className="text-muted" /> {t('analysisExportPdf')}
            </button>}
            {fv('export_arbeitszeitnachweis') && <button onClick={() => { onArbeitszeitPdf(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <Scale size={14} className="text-indigo-500" /> {t('analysisExportArbeitszeitnachweis')}
            </button>}
            {fv('export_datev') && <button onClick={() => { onDatev(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <Table2 size={14} className="text-emerald-500" /> {t('analysisExportDatev')}
            </button>}
            {fv('export_gsheets') && <button onClick={() => { onGoogleSheets(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <Sheet size={14} className="text-green-500" /> {t('analysisExportGSheets')}
            </button>}
            {fv('export_stundenzettel') && <button onClick={() => { onStundenzettel(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <Clock size={14} className="text-amber-500" /> Stundenzettel
            </button>}
            <div className="mx-3 my-1 h-px bg-border" />
            {fv('print') && <button onClick={() => { onPrint(); setExportOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-[#f7f9fc] dark:hover:bg-white/5 transition">
              <Printer size={14} className="text-muted" /> {t('analysisPrint')}
            </button>}
          </div>
        )}
      </div>
    </div>
  );
}
