import { useI18n } from '../../i18n';
import type { MonthlyDays } from '../../lib/api';
import type { MindestlohnResult } from '../../lib/mindestlohn';

function fmtNight(minutes: number, hm: string) {
  const decimal = (minutes / 60).toFixed(2);
  return `${decimal} (${hm})`;
}

export interface MetricCardsProps {
  s: {
    total_work_hm: string;
    total_work_decimal: number;
    total_work_minutes: number;
    total_driving_hm: string;
    total_driving_minutes: number;
    total_break_hm: string;
    total_break_minutes: number;
    total_avail_hm: string;
    total_avail_minutes: number;
    night_25_hm: string;
    night_25_minutes: number;
    night_40_hm: string;
    night_40_minutes: number;
    total_night_hm: string;
    total_night_minutes: number;
    diet_count: number;
    total_shifts: number;
    total_duration_hm?: string;
    total_duration_minutes?: number;
  };
  nightH: number;
  totalKm: number;
  vma: { amount: number; ratePerDay: number; doubleDiet: boolean };
  monthlyDays: MonthlyDays | null;
  mindestlohn?: MindestlohnResult | null;
  fv: (feature: string) => boolean;
}

export function MetricCards({ s, nightH, totalKm, vma, monthlyDays, mindestlohn, fv }: MetricCardsProps) {
  const { t, locale } = useI18n();

  const fmtNum = (n: number) => n.toLocaleString(locale === 'de' ? 'de-DE' : 'pl-PL');

  return (
    <>
      {/* Key metrics - highlighted */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[10px] bg-[#5750f1] p-5 shadow-1 text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-white/70">{t('analysisWorkTime')}</p>
          <p className="mt-1.5 text-3xl font-semibold text-white" style={{ letterSpacing: '-0.28px' }}>{monthlyDays?.override_work_hm || s.total_work_hm}</p>
          <p className="mt-1 text-[12px] text-white/50">{monthlyDays?.override_work_hm ? '' : `${s.total_work_decimal}h`}</p>
        </div>
        {fv('night_hours_cards') && <div className="rounded-[10px] bg-white p-5 shadow-1 text-center dark:bg-[#1f2a37]" title={locale === 'de' ? `Nachtarbeit ab ${nightH}:00 (25%)` : `Nocne od ${nightH}:00 (25%)`}>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('analysisNight25')}</p>
          <p className="mt-1.5 text-3xl font-semibold text-ink" style={{ letterSpacing: '-0.28px' }}>{monthlyDays?.override_n25 || (s.night_25_minutes / 60).toFixed(2)}</p>
          <p className="mt-1 text-[12px] text-muted">{monthlyDays?.override_n25 ? '' : s.night_25_hm}</p>
          <p className="mt-0.5 text-[11px] text-muted/50">{locale === 'de' ? 'ab' : 'od'} {nightH}:00</p>
        </div>}
        {fv('night_hours_cards') && <div className="rounded-[10px] bg-white p-5 shadow-1 text-center dark:bg-[#1f2a37]" title={locale === 'de' ? `Nachtarbeit ab ${nightH}:00 (40%)` : `Nocne od ${nightH}:00 (40%)`}>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('analysisNight40')}</p>
          <p className="mt-1.5 text-3xl font-semibold text-ink" style={{ letterSpacing: '-0.28px' }}>{monthlyDays?.override_n40 || (s.night_40_minutes / 60).toFixed(2)}</p>
          <p className="mt-1 text-[12px] text-muted">{monthlyDays?.override_n40 ? '' : s.night_40_hm}</p>
        </div>}
        <div className="rounded-[10px] bg-white p-5 shadow-1 text-center dark:bg-[#1f2a37]" title="Verpflegungsmehraufwand - dieta za podróż służbową">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('analysisDietCount')}</p>
          <p className="mt-1.5 text-3xl font-semibold text-ink" style={{ letterSpacing: '-0.28px' }}>{s.diet_count}</p>
          <p className="mt-1 text-[12px] font-medium text-muted">
            {vma.amount.toFixed(2).replace('.', ',')} €
            {vma.doubleDiet && <span className="ml-1 text-[11px] font-normal opacity-60">(2×{vma.ratePerDay / 2}€)</span>}
          </p>
        </div>
      </div>

      {/* Mindestlohn (MiLoG) — slim line when ok, loud alert when below */}
      {mindestlohn && (mindestlohn.ok ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-emerald-50 px-4 py-2 text-sm dark:bg-emerald-900/20">
          <span className="font-semibold text-emerald-800 dark:text-emerald-300">
            {locale === 'de' ? 'Mindestlohn' : 'Płaca minimalna'} · {mindestlohn.effectiveHourlyEur.toFixed(2).replace('.', ',')} €/h
            <span className="ml-1.5 font-normal text-emerald-700/70 dark:text-emerald-400/70">
              ({fmtNum(Math.round(mindestlohn.monthlyGrossEur))} € / {mindestlohn.workHours.toFixed(1)} h)
            </span>
          </span>
          <span className="font-bold text-emerald-700 dark:text-emerald-400">≥ {mindestlohn.minHourlyEur} €/h ✓</span>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-[10px] border-2 border-rose-400 bg-rose-50 px-4 py-3 dark:border-rose-600 dark:bg-rose-900/25">
          <span className="text-xl leading-none">⚠</span>
          <span className="text-sm font-bold text-rose-800 dark:text-rose-200">
            {locale === 'de'
              ? `Stundenlohn ${mindestlohn.effectiveHourlyEur.toFixed(2).replace('.', ',')} €/h liegt unter dem Mindestlohn (${mindestlohn.minHourlyEur} €/h)! Es fehlen ${mindestlohn.shortfallEur.toFixed(2).replace('.', ',')} € brutto im Zeitraum (${fmtNum(Math.round(mindestlohn.monthlyGrossEur))} € / ${mindestlohn.workHours.toFixed(1)} h).`
              : `Stawka ${mindestlohn.effectiveHourlyEur.toFixed(2).replace('.', ',')} €/h jest poniżej płacy minimalnej (${mindestlohn.minHourlyEur} €/h)! Brakuje ${mindestlohn.shortfallEur.toFixed(2).replace('.', ',')} € brutto w tym okresie (${fmtNum(Math.round(mindestlohn.monthlyGrossEur))} € / ${mindestlohn.workHours.toFixed(1)} h).`}
          </span>
        </div>
      ))}

      {/* Duration breakdown + total km */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-3 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{locale === 'de' ? 'Gesamtzeit mit Pausen' : 'Czas łącznie z przerwami'}</p>
          <p className="mt-0.5 text-xl font-extrabold">{(s as any).total_duration_hm || '—'}</p>
        </div>
        <div className="rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-3 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{locale === 'de' ? 'Arbeitszeit ohne Pausen' : 'Czas pracy bez przerw'}</p>
          <p className="mt-0.5 text-xl font-extrabold">{monthlyDays?.override_work_hm || s.total_work_hm}</p>
        </div>
        <div className="rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-3 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{locale === 'de' ? 'Pausen gesamt' : 'Przerwy łącznie'}</p>
          <p className="mt-0.5 text-xl font-extrabold">{s.total_break_hm}</p>
        </div>
        <div className="rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-3 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{locale === 'de' ? 'Kilometer' : 'Kilometry'}</p>
          <p className="mt-0.5 text-xl font-extrabold">{fmtNum(totalKm)} km</p>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: t('analysisDriving'), value: s.total_driving_hm },
          { label: t('analysisBreaks'), value: s.total_break_hm },
          { label: t('analysisAvailability'), value: s.total_avail_hm },
          { label: t('analysisTotalShifts'), value: String(s.total_shifts) },
          { label: t('analysisNight25') + ' + ' + t('analysisNight40'), value: (monthlyDays?.override_n25 || monthlyDays?.override_n40) ? `${monthlyDays?.override_n25 || (s.night_25_minutes / 60).toFixed(2)} + ${monthlyDays?.override_n40 || (s.night_40_minutes / 60).toFixed(2)}` : fmtNight(s.night_25_minutes + s.night_40_minutes, s.total_night_hm) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-3 text-center ">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-0.5 text-xl font-extrabold">{value}</p>
          </div>
        ))}
      </div>
    </>
  );
}
