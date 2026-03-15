import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning';
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, variant = 'danger' }: ConfirmDialogProps) {
  const { t } = useI18n();
  if (!open) return null;

  const btnClass = variant === 'danger'
    ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/20'
    : 'bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-500/20';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800 animate-scale-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
            <AlertTriangle size={20} className="text-rose-600 dark:text-rose-400" />
          </div>
          <h3 className="text-lg font-bold">{title}</h3>
        </div>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 transition hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5"
          >
            {t('cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${btnClass}`}
          >
            {confirmLabel || t('yes')}
          </button>
        </div>
      </div>
    </div>
  );
}
