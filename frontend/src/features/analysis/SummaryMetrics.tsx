import { useI18n } from '../../i18n';

function fmtNight(minutes: number, hm: string) {
  const decimal = (minutes / 60).toFixed(2);
  return `${decimal} (${hm})`;
}

interface SummaryMetricsProps {
  summary: {
    total_work_hm: string;
    total_work_decimal: number;
    night_25_minutes: number;
    night_25_hm: string;
    night_40_minutes: number;
    night_40_hm: string;
    diet_count: number;
    total_driving_hm: string;
    total_break_hm: string;
    total_avail_hm: string;
    total_shifts: number;
    total_night_hm: string;
  };
  vma: { amount: number; ratePerDay: number; doubleDiet: boolean };
  locale: string;
}

export function SummaryMetrics({ summary: s, vma, locale }: SummaryMetricsProps) {
  const { t } = useI18n();

  return (
    <>
      {/* Key metrics - highlighted */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-center dark:border-primary-800 dark:bg-primary-900/30">
          <p className="text-xs font-bold uppercase tracking-wider text-primary-500 dark:text-primary-400">{t('analysisWorkTime')}</p>
          <p className="mt-1 text-2xl font-extrabold text-primary-700 dark:text-primary-300">{s.total_work_hm}</p>
          <p className="mt-0.5 text-xs text-primary-500/70 dark:text-primary-400/70">{s.total_work_decimal}h</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center dark:border-violet-800 dark:bg-violet-900/30" title={locale === 'de' ? 'Arbeit 22:00-06:00 unter 2h = 25% Zuschlag' : 'Praca w godz. 22:00-06:00 poniżej 2h = 25% dodatku'}>
          <p className="text-xs font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400">{t('analysisNight25')}</p>
          <p className="mt-1 text-2xl font-extrabold text-violet-700 dark:text-violet-300">{(s.night_25_minutes / 60).toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-violet-500/70 dark:text-violet-400/70">{s.night_25_hm}</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center dark:border-indigo-800 dark:bg-indigo-900/30" title={locale === 'de' ? 'Arbeit 22:00-06:00 über 2h = 40% Zuschlag' : 'Praca w godz. 22:00-06:00 powyżej 2h = 40% dodatku'}>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">{t('analysisNight40')}</p>
          <p className="mt-1 text-2xl font-extrabold text-indigo-700 dark:text-indigo-300">{(s.night_40_minutes / 60).toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-indigo-500/70 dark:text-indigo-400/70">{s.night_40_hm}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-800 dark:bg-emerald-900/30" title="Verpflegungsmehraufwand - dieta za podróż służbową">
          <p className="text-xs font-bold uppercase tracking-wider text-success dark:text-emerald-400">{t('analysisDietCount')}</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">{s.diet_count}</p>
          <p className="mt-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {vma.amount.toFixed(2).replace('.', ',')} €
            {vma.doubleDiet && <span className="ml-1 text-xs font-normal opacity-70">(2×{vma.ratePerDay / 2}€)</span>}
          </p>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: t('analysisDriving'), value: s.total_driving_hm },
          { label: t('analysisBreaks'), value: s.total_break_hm },
          { label: t('analysisAvailability'), value: s.total_avail_hm },
          { label: t('analysisTotalShifts'), value: String(s.total_shifts) },
          { label: t('analysisNight25') + ' + ' + t('analysisNight40'), value: fmtNight(s.night_25_minutes + s.night_40_minutes, s.total_night_hm) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-black/[0.02] p-3 text-center dark:bg-white/5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted dark:text-muted-dark">{label}</p>
            <p className="mt-0.5 text-xl font-extrabold">{value}</p>
          </div>
        ))}
      </div>
    </>
  );
}
