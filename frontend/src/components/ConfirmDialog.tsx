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
    ? 'bg-danger hover:bg-danger/90 text-white'
    : 'bg-warning hover:bg-warning/90 text-white';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in">
      <div className="fixed inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl card p-6 shadow-xl animate-scale-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
            <AlertTriangle size={20} className="text-rose-600 dark:text-rose-400" />
          </div>
          <h3 className="text-lg font-bold">{title}</h3>
        </div>
        <p className="mb-6 text-sm text-muted dark:text-muted-dark">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-muted dark:text-muted-dark transition hover:bg-surface dark:hover:bg-surface-dark"
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
