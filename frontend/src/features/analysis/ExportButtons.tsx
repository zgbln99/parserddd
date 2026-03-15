import { Download, FileText, Table2, Printer } from 'lucide-react';
import { useI18n } from '../../i18n';

interface ExportButtonsProps {
  onCsv: () => void;
  onPdf: () => void;
  onDatev: () => void;
  onPrint: () => void;
}

export function ExportButtons({ onCsv, onPdf, onDatev, onPrint }: ExportButtonsProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap justify-center gap-3 pt-2">
      <button
        onClick={onCsv}
        className="flex min-h-[44px] items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
      >
        <Download size={16} />
        {t('analysisExportCsv')}
      </button>
      <button
        onClick={onPdf}
        className="flex min-h-[44px] items-center gap-2 rounded-xl border border-primary-200 px-5 py-2.5 text-sm font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-primary-800 dark:text-primary-400 dark:hover:bg-primary-900/20"
      >
        <FileText size={16} />
        {t('analysisExportPdf')}
      </button>
      <button
        onClick={onDatev}
        className="flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
      >
        <Table2 size={16} />
        {t('analysisExportDatev')}
      </button>
      <button
        onClick={onPrint}
        className="flex min-h-[44px] items-center gap-2 rounded-xl border border-white/30 dark:border-white/10 px-5 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-black/[0.03] dark:text-gray-400 dark:hover:bg-white/5"
      >
        <Printer size={16} />
        {t('analysisPrint')}
      </button>
    </div>
  );
}
