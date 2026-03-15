import { useState, useCallback, useMemo } from 'react';
import {
  Clock, AlertTriangle, CheckCircle, Play, Search, Users,
  Calendar, ChevronDown, ChevronUp, Timer, Coffee, TrendingDown,
  ShieldCheck, ShieldAlert, Truck, Bed, Home, Pause, ArrowRight,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import {
  fetchEU561Drivers, analyzeEU561Dropbox, analyzeEU561Samsara,
  type EU561Result, type EU561Driver, type EU561Day, type EU561Week,
  type EU561Compensation, type EU561Infringement,
  type EU561Schedule, type EU561ScheduleRecommendation,
  type EU561ScheduleUpcoming, type EU561WeeklyPattern,
} from '../lib/api';

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, 'red' | 'yellow' | 'blue'> = {
    very_serious: 'red',
    serious: 'yellow',
    minor: 'blue',
  };
  const labels: Record<string, string> = {
    very_serious: 'B. Poważne',
    serious: 'Poważne',
    minor: 'Drobne',
  };
  return <Badge variant={colors[severity] || 'blue'}>{labels[severity] || severity}</Badge>;
}

function ProgressBar({ value, max, color = 'blue' }: { value: number; max: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const colorClass = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <div className="h-2.5 w-full rounded-full bg-gray-100 dark:bg-white/10">
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function RemainingTimeCards({ remaining }: { remaining: EU561Result['remaining'] }) {
  const { t, locale } = useI18n();
  if (!remaining) return null;

  const cards = [
    {
      icon: Timer,
      label: locale === 'de' ? 'Kontinuierliche Lenkzeit' : 'Jazda ciągła',
      used: remaining.continuous_driving_hm,
      left: remaining.continuous_remaining_hm,
      usedMin: remaining.continuous_driving_minutes,
      maxMin: 270,
      alert: remaining.break_needed,
      alertText: locale === 'de' ? 'Pause erforderlich!' : 'Wymagana przerwa!',
    },
    {
      icon: Clock,
      label: locale === 'de' ? 'Tageslenkzeit' : 'Dzienna jazda',
      used: remaining.daily_driving_hm,
      left: remaining.can_extend_today
        ? `${remaining.daily_remaining_extended_hm} (10h)`
        : remaining.daily_remaining_hm,
      usedMin: remaining.daily_driving_minutes,
      maxMin: remaining.can_extend_today ? 600 : 540,
    },
    {
      icon: Calendar,
      label: locale === 'de' ? 'Wochenlenkzeit' : 'Tygodniowa jazda',
      used: remaining.weekly_driving_hm,
      left: remaining.weekly_remaining_hm,
      usedMin: remaining.weekly_driving_minutes,
      maxMin: 3360,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c, i) => (
        <Card key={i}>
          <div className="flex items-start gap-3">
            <div className={`rounded-lg p-2 ${c.alert ? 'bg-red-50 dark:bg-red-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
              <c.icon size={18} className={c.alert ? 'text-red-500' : 'text-blue-500'} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-gray-500 dark:text-slate-400">{c.label}</div>
              <div className="mt-0.5 text-lg font-bold text-gray-900 dark:text-white">{c.left}</div>
              {c.alert && (
                <div className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{c.alertText}</div>
              )}
              <div className="mt-2">
                <ProgressBar value={c.usedMin} max={c.maxMin} />
              </div>
              <div className="mt-1 text-[11px] text-gray-400">{c.used} / {Math.floor(c.maxMin / 60)}:{String(c.maxMin % 60).padStart(2, '0')}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function WeeklyTable({ weeks, locale }: { weeks: EU561Week[]; locale: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-white/10">
            <th className="py-2 pl-3 text-left font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Woche' : 'Tydzień'}</th>
            <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Lenkzeit' : 'Jazda'}</th>
            <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Arbeitszeit' : 'Praca'}</th>
            <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Wochenruhe' : 'Odp. tyg.'}</th>
            <th className="py-2 text-center font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Kompensation' : 'Kompensacja'}</th>
            <th className="py-2 pr-3 text-center font-medium text-gray-500 dark:text-slate-400">Status</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => {
            const hasIssues = week.infringements.length > 0 || week.weekly_rest_reduced;
            return (
              <tr
                key={week.week}
                className={`border-b border-gray-100 dark:border-white/5 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 ${hasIssues ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}
                onClick={() => setExpanded(expanded === week.week ? null : week.week)}
              >
                <td className="py-2.5 pl-3 font-medium text-gray-900 dark:text-white">
                  <div className="flex items-center gap-1.5">
                    {expanded === week.week ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {week.week}
                  </div>
                  {expanded === week.week && week.day_dates.length > 0 && (
                    <div className="mt-1 text-[11px] text-gray-400">{week.day_dates.join(', ')}</div>
                  )}
                </td>
                <td className="py-2.5 text-right tabular-nums text-gray-900 dark:text-white">
                  <span className={week.driving_minutes > 3360 ? 'text-red-600 font-bold' : ''}>
                    {week.driving_hm}
                  </span>
                  <span className="text-gray-400 dark:text-slate-500"> / 56:00</span>
                </td>
                <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-slate-300">{week.work_hm}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {week.weekly_rest_hm ? (
                    <span className={week.weekly_rest_reduced ? 'text-amber-600 font-medium' : 'text-green-600'}>
                      {week.weekly_rest_hm}
                    </span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="py-2.5 text-center">
                  {week.weekly_rest_reduced ? (
                    <span className="text-amber-600 font-medium">{week.compensation_hm}</span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-center">
                  {week.infringements.length > 0 ? (
                    <Badge variant="red">{week.infringements.length}</Badge>
                  ) : (
                    <CheckCircle size={16} className="mx-auto text-green-500" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DailyTable({ days, locale }: { days: EU561Day[]; locale: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-white/10">
            <th className="py-2 pl-3 text-left font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Datum' : 'Data'}</th>
            <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Lenkzeit' : 'Jazda'}</th>
            <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Arbeitszeit' : 'Praca'}</th>
            <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Tagesruhe' : 'Odp. dzienny'}</th>
            <th className="py-2 pr-3 text-center font-medium text-gray-500 dark:text-slate-400">Status</th>
          </tr>
        </thead>
        <tbody>
          {days.map(day => {
            const hasIssues = day.infringements.length > 0;
            const drivingOverLimit = day.driving_minutes > 540;
            return (
              <tr
                key={day.date}
                className={`border-b border-gray-100 dark:border-white/5 ${hasIssues ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}
              >
                <td className="py-2 pl-3 font-medium text-gray-900 dark:text-white">{day.date}</td>
                <td className="py-2 text-right tabular-nums">
                  <span className={drivingOverLimit ? 'text-amber-600 font-medium' : 'text-gray-900 dark:text-white'}>
                    {day.driving_hm}
                  </span>
                  {day.is_extended && <span className="ml-1 text-[10px] text-amber-500">10h</span>}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-700 dark:text-slate-300">{day.work_hm}</td>
                <td className="py-2 text-right tabular-nums">
                  {day.daily_rest_minutes > 0 ? (
                    <span className={day.daily_rest_minutes < 660 ? (day.daily_rest_minutes < 540 ? 'text-red-600 font-bold' : 'text-amber-600') : 'text-green-600'}>
                      {day.daily_rest_hm}
                    </span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-center">
                  {hasIssues ? (
                    <AlertTriangle size={16} className="mx-auto text-red-500" />
                  ) : (
                    <CheckCircle size={16} className="mx-auto text-green-500" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompensationTable({ compensations, locale }: { compensations: EU561Compensation[]; locale: string }) {
  if (!compensations.length) return null;

  const statusColors: Record<string, string> = {
    fulfilled: 'text-green-600',
    pending: 'text-amber-600',
    overdue: 'text-red-600 font-bold',
  };
  const statusLabels: Record<string, Record<string, string>> = {
    pl: { fulfilled: 'Odebrana', pending: 'Do odebrania', overdue: 'Przeterminowana!' },
    de: { fulfilled: 'Erfüllt', pending: 'Ausstehend', overdue: 'Überfällig!' },
  };

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Coffee size={18} className="text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {locale === 'de' ? 'Kompensation verkürzte Wochenruhe' : 'Kompensacja skróconych weekendów'}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-white/10">
              <th className="py-2 text-left font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Woche' : 'Tydzień'}</th>
              <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Verkürzte Ruhe' : 'Skrócony odp.'}</th>
              <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Kompensation' : 'Do odebrania'}</th>
              <th className="py-2 text-left font-medium text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Frist' : 'Termin'}</th>
              <th className="py-2 text-left font-medium text-gray-500 dark:text-slate-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {compensations.map((c, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-white/5">
                <td className="py-2 font-medium text-gray-900 dark:text-white">{c.week}</td>
                <td className="py-2 text-right tabular-nums text-gray-700 dark:text-slate-300">{c.reduced_rest_hm}</td>
                <td className="py-2 text-right tabular-nums font-medium text-amber-600">{c.compensation_hm}</td>
                <td className="py-2 text-gray-700 dark:text-slate-300">{c.deadline_week}</td>
                <td className={`py-2 font-medium ${statusColors[c.status] || ''}`}>
                  {(statusLabels[locale] || statusLabels['pl'])[c.status] || c.status}
                  {c.fulfilled_week && <span className="ml-1 text-xs text-gray-400">({c.fulfilled_week})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function InfringementsList({ infringements, locale }: { infringements: EU561Infringement[]; locale: string }) {
  if (!infringements.length) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert size={18} className="text-red-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {locale === 'de' ? 'Alle Verstöße' : 'Wszystkie naruszenia'} ({infringements.length})
        </h3>
      </div>
      <div className="space-y-2">
        {infringements.map((inf, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-white/[0.02]"
          >
            <SeverityBadge severity={inf.severity} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-gray-900 dark:text-white">
                {locale === 'de' ? (inf.detail_de || inf.detail) : inf.detail}
              </div>
              <div className="mt-0.5 text-xs text-gray-400">
                {inf.date || inf.week} {inf.time && `${inf.time}`}
                <span className="ml-2 text-gray-300">{inf.type}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecommendationIcon({ icon }: { icon: string }) {
  const cls = "flex-shrink-0";
  switch (icon) {
    case 'pause': return <Pause size={16} className={`${cls} text-amber-500`} />;
    case 'bed': return <Bed size={16} className={`${cls} text-blue-500`} />;
    case 'calendar': return <Calendar size={16} className={`${cls} text-purple-500`} />;
    case 'home': return <Home size={16} className={`${cls} text-green-500`} />;
    case 'alert': return <AlertTriangle size={16} className={`${cls} text-red-500`} />;
    case 'clock': return <Clock size={16} className={`${cls} text-amber-500`} />;
    default: return <ArrowRight size={16} className={`${cls} text-gray-400`} />;
  }
}

function RestScheduleView({ schedule, locale }: { schedule: EU561Schedule; locale: string }) {
  const priorityColors: Record<string, string> = {
    critical: 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-900/20',
    high: 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-900/20',
    normal: 'border-blue-200 bg-blue-50/50 dark:border-blue-500/20 dark:bg-blue-900/10',
    info: 'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.02]',
  };

  const priorityLabels: Record<string, Record<string, string>> = {
    pl: { critical: 'PILNE', high: 'Ważne', normal: 'Info', info: 'Hint' },
    de: { critical: 'DRINGEND', high: 'Wichtig', normal: 'Info', info: 'Hinweis' },
  };

  const restTypeLabels: Record<string, Record<string, string>> = {
    pl: {
      regular: '45h regularny',
      reduced: '24h skrócony',
      missing: 'Brak!',
      regular_required: '45h WYMAGANY',
      regular_with_compensation: '45h + kompensacja',
      flexible: '45h lub 24h',
      regular_or_reduced: '45h lub 24h',
    },
    de: {
      regular: '45h regulär',
      reduced: '24h verkürzt',
      missing: 'Fehlt!',
      regular_required: '45h PFLICHT',
      regular_with_compensation: '45h + Kompensation',
      flexible: '45h oder 24h',
      regular_or_reduced: '45h oder 24h',
    },
  };

  const labels = restTypeLabels[locale] || restTypeLabels['pl'];
  const pLabels = priorityLabels[locale] || priorityLabels['pl'];

  return (
    <div className="space-y-4">
      {/* Recommendations */}
      {schedule.recommendations.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {locale === 'de' ? 'Empfehlungen' : 'Zalecenia'}
            </h3>
          </div>
          <div className="space-y-2">
            {schedule.recommendations.map((rec, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-lg border p-3 ${priorityColors[rec.priority] || priorityColors['info']}`}
              >
                <RecommendationIcon icon={rec.icon} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {locale === 'de' ? (rec.text_de || rec.text) : rec.text}
                  </div>
                </div>
                <Badge variant={rec.priority === 'critical' ? 'red' : rec.priority === 'high' ? 'yellow' : 'blue'}>
                  {pLabels[rec.priority] || rec.priority}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Upcoming obligations */}
      {schedule.upcoming.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Calendar size={18} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {locale === 'de' ? 'Nächste Pflichten' : 'Nadchodzące obowiązki'}
            </h3>
          </div>
          <div className="space-y-3">
            {schedule.upcoming.map(item => (
              <div
                key={item.id}
                className={`rounded-lg border p-4 ${priorityColors[item.priority] || priorityColors['normal']}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.type === 'daily_rest' && <Bed size={16} className="text-blue-500" />}
                      {item.type === 'weekly_rest' && <Calendar size={16} className="text-purple-500" />}
                      {item.type === 'compensation' && <Coffee size={16} className="text-amber-500" />}
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {item.type === 'daily_rest' && (locale === 'de' ? 'Tagesruhe' : 'Odpoczynek dzienny')}
                        {item.type === 'weekly_rest' && (locale === 'de' ? 'Wochenruhe' : 'Odpoczynek tygodniowy')}
                        {item.type === 'compensation' && (locale === 'de' ? 'Kompensation' : 'Kompensacja')}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700 dark:text-slate-300">
                      {locale === 'de' ? (item.description_de || item.description) : item.description}
                    </div>

                    {/* Extra details for each type */}
                    {item.type === 'daily_rest' && item.reduced_daily_count !== undefined && (
                      <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                        {locale === 'de' ? 'Verkürzte Tagesruhe genutzt' : 'Skrócone odpoczynki dzienne wykorzystane'}:{' '}
                        <span className="font-medium">{item.reduced_daily_count}/{item.reduced_daily_limit}</span>
                        {item.can_reduce && (
                          <span className="ml-2 text-green-600">
                            ({locale === 'de' ? '9h möglich' : '9h możliwe'})
                          </span>
                        )}
                      </div>
                    )}

                    {item.type === 'weekly_rest' && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="font-medium text-gray-700 dark:text-slate-300">
                          Min: {item.min_duration_hm}
                        </span>
                        {item.can_reduce ? (
                          <Badge variant="green">{locale === 'de' ? 'Verkürzung möglich' : 'Skrócenie możliwe'}</Badge>
                        ) : (
                          <Badge variant="red">{locale === 'de' ? 'Nur regulär!' : 'Tylko regularny!'}</Badge>
                        )}
                      </div>
                    )}

                    {item.type === 'compensation' && (
                      <div className="mt-2 text-xs">
                        <span className="font-medium text-amber-600">
                          {item.compensation_hm} {locale === 'de' ? 'en bloc an Ruhezeit anhängen' : 'en bloc dołączyć do odpoczynku'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div className="text-[11px] font-medium text-gray-500 dark:text-slate-400">
                      {locale === 'de' ? 'Frist' : 'Termin'}
                    </div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">{item.deadline}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Weekly pattern timeline */}
      {schedule.weekly_pattern.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <TrendingDown size={18} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {locale === 'de' ? 'Wochenrhythmus — Ruhezeiten' : 'Wzorzec tygodniowy — odpoczynki'}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  <th className="py-2 pl-3 text-left font-medium text-gray-500 dark:text-slate-400">
                    {locale === 'de' ? 'Woche' : 'Tydzień'}
                  </th>
                  <th className="py-2 text-center font-medium text-gray-500 dark:text-slate-400">
                    {locale === 'de' ? 'Wochenruhe' : 'Odp. tygodniowy'}
                  </th>
                  <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">
                    {locale === 'de' ? 'Dauer' : 'Czas'}
                  </th>
                  <th className="py-2 text-right font-medium text-gray-500 dark:text-slate-400">
                    {locale === 'de' ? 'Lenkzeit' : 'Jazda'}
                  </th>
                  <th className="py-2 pr-3 text-center font-medium text-gray-500 dark:text-slate-400">
                    {locale === 'de' ? 'Kompensation' : 'Kompensacja'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.weekly_pattern.map((wp, i) => {
                  const isProjected = wp.status === 'projected';
                  const restColor: Record<string, string> = {
                    regular: 'text-green-600',
                    reduced: 'text-amber-600',
                    missing: 'text-red-600 font-bold',
                    regular_required: 'text-red-600 font-bold',
                    regular_with_compensation: 'text-purple-600 font-bold',
                    flexible: 'text-blue-500',
                    regular_or_reduced: 'text-blue-500',
                  };

                  return (
                    <tr
                      key={wp.week}
                      className={`border-b border-gray-100 dark:border-white/5 ${
                        isProjected ? 'bg-blue-50/30 dark:bg-blue-900/5' : ''
                      }`}
                    >
                      <td className="py-2.5 pl-3 font-medium text-gray-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          {wp.week}
                          {isProjected && (
                            <Badge variant="blue">
                              {locale === 'de' ? 'Plan' : 'Plan'}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className={`py-2.5 text-center font-medium ${restColor[wp.rest_type] || 'text-gray-500'}`}>
                        {labels[wp.rest_type] || wp.rest_type}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-slate-300">
                        {wp.rest_hm}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-slate-300">
                        {wp.driving_hm}
                      </td>
                      <td className="py-2.5 pr-3 text-center">
                        {wp.compensation_minutes > 0 ? (
                          <span className="font-medium text-amber-600">{wp.compensation_hm}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[11px] text-gray-400 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {locale === 'de' ? '45h regulär' : '45h regularny'}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              {locale === 'de' ? '24h verkürzt' : '24h skrócony'}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
              {locale === 'de' ? 'Geplant' : 'Planowany'}
            </span>
          </div>
        </Card>
      )}

      {/* Status summary */}
      {schedule.status && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={18} className="text-green-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {locale === 'de' ? 'Regelstatus' : 'Status reguł'}
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-100 p-3 dark:border-white/5">
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {locale === 'de' ? 'Verkürzte Tagesruhe verbraucht' : 'Skrócone dzienne wykorzystane'}
              </div>
              <div className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
                {schedule.status.reduced_daily_count} / {schedule.status.reduced_daily_count + schedule.status.reduced_daily_remaining}
              </div>
              <div className="mt-1">
                <ProgressBar
                  value={schedule.status.reduced_daily_count}
                  max={schedule.status.reduced_daily_count + schedule.status.reduced_daily_remaining}
                />
              </div>
            </div>
            <div className="rounded-lg border border-gray-100 p-3 dark:border-white/5">
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {locale === 'de' ? 'Nächster Wochenruhe-Typ' : 'Następny odp. tygodniowy'}
              </div>
              <div className={`mt-1 text-lg font-bold ${schedule.status.can_reduce_next_weekly ? 'text-blue-600' : 'text-red-600'}`}>
                {schedule.status.can_reduce_next_weekly
                  ? (locale === 'de' ? '24h oder 45h' : '24h lub 45h')
                  : (locale === 'de' ? '45h PFLICHT' : '45h WYMAGANY')
                }
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {locale === 'de' ? 'Aufeinander verkürzt' : 'Z rzędu skrócone'}: {schedule.status.consecutive_reduced_weekly}
              </div>
            </div>
            <div className="rounded-lg border border-gray-100 p-3 dark:border-white/5">
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {locale === 'de' ? 'Offene Kompensationen' : 'Otwarte kompensacje'}
              </div>
              <div className={`mt-1 text-lg font-bold ${schedule.status.pending_compensations > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {schedule.status.pending_compensations}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function DriverResult({ result, locale }: { result: EU561Result; locale: string }) {
  const [tab, setTab] = useState<'overview' | 'daily' | 'weekly' | 'schedule'>('schedule');

  const summary = result.summary;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20">
          <Truck size={20} className="text-blue-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{result.driver_name || result.card_number}</h2>
          <div className="text-xs text-gray-400">{result.period_start} — {result.period_end}</div>
        </div>
        <div className="ml-auto flex gap-2">
          {summary.very_serious > 0 && <Badge variant="red">{summary.very_serious} {locale === 'de' ? 'sehr schwer' : 'b. poważne'}</Badge>}
          {summary.serious > 0 && <Badge variant="yellow">{summary.serious} {locale === 'de' ? 'schwer' : 'poważne'}</Badge>}
          {summary.minor > 0 && <Badge variant="blue">{summary.minor} {locale === 'de' ? 'leicht' : 'drobne'}</Badge>}
          {summary.total_infringements === 0 && (
            <Badge variant="green">
              <ShieldCheck size={14} className="mr-1" />
              {locale === 'de' ? 'Keine Verstöße' : 'Brak naruszeń'}
            </Badge>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Gesamte Lenkzeit' : 'Łączna jazda'}</div>
          <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{summary.total_driving_hm}</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Gesamte Arbeitszeit' : 'Łączna praca'}</div>
          <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{summary.total_work_hm}</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Tage / Wochen' : 'Dni / Tygodnie'}</div>
          <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{summary.days_analyzed}d / {summary.weeks_analyzed}w</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500 dark:text-slate-400">{locale === 'de' ? 'Verstöße gesamt' : 'Naruszenia'}</div>
          <div className={`mt-1 text-xl font-bold ${summary.total_infringements > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {summary.total_infringements}
          </div>
        </Card>
      </div>

      {/* Remaining time */}
      {result.remaining && result.remaining.daily_remaining_minutes !== undefined && (
        <RemainingTimeCards remaining={result.remaining} />
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/10">
        {(['schedule', 'overview', 'daily', 'weekly'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t
                ? 'bg-white text-gray-900 shadow-sm dark:bg-white/20 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {t === 'schedule' && (locale === 'de' ? 'Harmonogram' : 'Harmonogram')}
            {t === 'overview' && (locale === 'de' ? 'Übersicht' : 'Podsumowanie')}
            {t === 'daily' && (locale === 'de' ? 'Täglich' : 'Dziennie')}
            {t === 'weekly' && (locale === 'de' ? 'Wöchentlich' : 'Tygodniowo')}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'schedule' && result.schedule && (
        <RestScheduleView schedule={result.schedule} locale={locale} />
      )}

      {tab === 'overview' && (
        <div className="space-y-4">
          <CompensationTable compensations={result.compensations} locale={locale} />
          <InfringementsList infringements={result.all_infringements} locale={locale} />
          {result.all_infringements.length === 0 && (
            <Card>
              <div className="flex items-center gap-3 py-6 justify-center">
                <ShieldCheck size={32} className="text-green-500" />
                <span className="text-lg font-medium text-green-600">
                  {locale === 'de' ? 'Alle Vorschriften eingehalten' : 'Wszystkie przepisy spełnione'}
                </span>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'daily' && (
        <Card>
          <DailyTable days={result.days} locale={locale} />
        </Card>
      )}

      {tab === 'weekly' && (
        <Card>
          <WeeklyTable weeks={result.weeks} locale={locale} />
        </Card>
      )}
    </div>
  );
}

export function EU561Page() {
  const { t, locale } = useI18n();
  const { toast } = useToast();

  const [drivers, setDrivers] = useState<EU561Driver[]>([]);
  const [samsaraAvailable, setSamsaraAvailable] = useState(false);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driversLoaded, setDriversLoaded] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [mode, setMode] = useState<'dropbox' | 'samsara'>('dropbox');

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<EU561Result[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' });

  // Load drivers
  const loadDrivers = useCallback(async () => {
    if (driversLoaded) return;
    setDriversLoading(true);
    try {
      const data = await fetchEU561Drivers();
      setDrivers(data.drivers);
      setSamsaraAvailable(data.samsara_available);
      setDriversLoaded(true);
    } catch {
      toast(locale === 'de' ? 'Fehler beim Laden' : 'Błąd ładowania', 'error');
    } finally {
      setDriversLoading(false);
    }
  }, [driversLoaded, locale, toast]);

  if (!driversLoaded && !driversLoading) {
    loadDrivers();
  }

  const filteredDrivers = useMemo(() => {
    if (!searchQuery) return drivers;
    const q = searchQuery.toLowerCase();
    return drivers.filter(d =>
      d.name.toLowerCase().includes(q) || d.card_number.toLowerCase().includes(q)
    );
  }, [drivers, searchQuery]);

  const toggleDriver = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredDrivers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredDrivers.map(d => d.name)));
    }
  };

  const handleAnalyze = useCallback(async () => {
    if (selected.size === 0) return;
    setLoading(true);
    setResults([]);

    if (mode === 'samsara' && samsaraAvailable) {
      // Samsara live mode - one API call for all drivers
      try {
        const data = await analyzeEU561Samsara([]);
        setResults(data.drivers);
      } catch (e: any) {
        toast(e.message || 'Error', 'error');
      }
    } else {
      // Dropbox mode - analyze each driver individually
      const selectedDrivers = drivers.filter(d => selected.has(d.name));
      setProgress({ current: 0, total: selectedDrivers.length, name: '' });

      const allResults: EU561Result[] = [];

      for (let i = 0; i < selectedDrivers.length; i++) {
        const driver = selectedDrivers[i];
        setProgress({ current: i + 1, total: selectedDrivers.length, name: driver.name });

        try {
          const files = driver.files.map(f => ({ path: f.path }));
          if (files.length === 0) continue;

          const result = await analyzeEU561Dropbox(driver.name, driver.card_number, files);
          allResults.push(result);
        } catch {
          // Skip failed drivers
        }
      }

      setResults(allResults);
    }

    setLoading(false);
  }, [selected, drivers, mode, samsaraAvailable, toast]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <ShieldCheck size={24} className="text-blue-500" />
          EU 561/2006
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          {locale === 'de'
            ? 'Lenk- und Ruhezeiten, Pausen, Wochenruhe, Kompensation'
            : 'Czas jazdy i odpoczynku, przerwy, weekendy, kompensacja'
          }
        </p>
      </div>

      {/* Source mode selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode('dropbox')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            mode === 'dropbox'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-300'
          }`}
        >
          {locale === 'de' ? 'DDD-Dateien (Dropbox)' : 'Pliki DDD (Dropbox)'}
        </button>
        <button
          onClick={() => setMode('samsara')}
          disabled={!samsaraAvailable}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            mode === 'samsara'
              ? 'bg-blue-600 text-white'
              : samsaraAvailable
                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-300'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed dark:bg-white/5 dark:text-slate-600'
          }`}
        >
          Samsara Live
          {!samsaraAvailable && <span className="ml-1 text-xs">(brak tokenu)</span>}
        </button>
      </div>

      {/* Driver selection */}
      {mode === 'dropbox' && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Users size={16} />
              {locale === 'de' ? 'Fahrer auswählen' : 'Wybierz kierowców'}
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={locale === 'de' ? 'Suchen...' : 'Szukaj...'}
                  className="w-48 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </div>
              <button
                onClick={toggleAll}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
              >
                {selected.size === filteredDrivers.length
                  ? (locale === 'de' ? 'Keine' : 'Odznacz')
                  : (locale === 'de' ? 'Alle' : 'Wszystkie')
                }
              </button>
            </div>
          </div>

          {driversLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 max-h-60 overflow-y-auto">
              {filteredDrivers.map(d => (
                <label
                  key={d.name}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition ${
                    selected.has(d.name)
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-900/20'
                      : 'border-gray-100 hover:border-gray-200 dark:border-white/5 dark:hover:border-white/10'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(d.name)}
                    onChange={() => toggleDriver(d.name)}
                    className="rounded border-gray-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{d.name}</div>
                    <div className="text-[11px] text-gray-400">
                      {d.file_count} {locale === 'de' ? 'Dateien' : 'plików'}
                      {d.latest_date && <span className="ml-1">| {d.latest_date}</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {selected.size} {locale === 'de' ? 'ausgewählt' : 'wybranych'}
            </span>
            <button
              onClick={handleAnalyze}
              disabled={loading || selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? <Spinner size="sm" /> : <Play size={16} />}
              {locale === 'de' ? 'Analysieren' : 'Analizuj'}
            </button>
          </div>

          {loading && progress.total > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span>{progress.name}</span>
                <span>{progress.current}/{progress.total}</span>
              </div>
              <ProgressBar value={progress.current} max={progress.total} />
            </div>
          )}
        </Card>
      )}

      {/* Samsara mode - just a button */}
      {mode === 'samsara' && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {locale === 'de' ? 'Samsara Live-Analyse' : 'Analiza Samsara Live'}
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                {locale === 'de'
                  ? 'Holt Tachograph-Aktivitätsdaten der letzten 28 Tage von Samsara'
                  : 'Pobiera dane aktywności tachografu z ostatnich 28 dni z Samsary'
                }
              </p>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? <Spinner size="sm" /> : <Play size={16} />}
              {locale === 'de' ? 'Jetzt analysieren' : 'Analizuj teraz'}
            </button>
          </div>
        </Card>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-8">
          {/* Summary across all drivers */}
          {results.length > 1 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                {locale === 'de' ? 'Zusammenfassung alle Fahrer' : 'Podsumowanie wszystkich kierowców'}
              </h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-gray-500">{locale === 'de' ? 'Fahrer' : 'Kierowcy'}</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">{results.length}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{locale === 'de' ? 'Verstöße gesamt' : 'Naruszenia łącznie'}</div>
                  <div className={`text-xl font-bold ${results.reduce((s, r) => s + r.summary.total_infringements, 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {results.reduce((s, r) => s + r.summary.total_infringements, 0)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{locale === 'de' ? 'Ohne Verstöße' : 'Bez naruszeń'}</div>
                  <div className="text-xl font-bold text-green-600">
                    {results.filter(r => r.summary.total_infringements === 0).length}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{locale === 'de' ? 'Kompensationen offen' : 'Kompensacje otwarte'}</div>
                  <div className="text-xl font-bold text-amber-600">
                    {results.reduce((s, r) => s + r.compensations.filter(c => c.status !== 'fulfilled').length, 0)}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Individual driver results */}
          {results.map((result, i) => (
            <DriverResult key={i} result={result} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
