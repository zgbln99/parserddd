import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { clsx } from 'clsx';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

let nextId = 0;

const DURATION = 4000;
const EXIT_DURATION = 250;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_DURATION);
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismiss(id), DURATION);
  }, [dismiss]);

  const icons: Record<ToastType, ReactNode> = {
    success: <CheckCircle size={18} className="text-success shrink-0" />,
    error: <AlertCircle size={18} className="text-danger shrink-0" />,
    info: <Info size={18} className="text-info shrink-0" />,
  };

  const borderStyles: Record<ToastType, string> = {
    success: 'border-emerald-200 dark:border-emerald-800',
    error: 'border-rose-200 dark:border-rose-800',
    info: 'border-blue-200 dark:border-blue-800',
  };

  const progressColors: Record<ToastType, string> = {
    success: 'bg-success',
    error: 'bg-danger',
    info: 'bg-info',
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-20 right-4 z-[100] flex flex-col gap-2 sm:bottom-6 sm:right-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'relative flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm overflow-hidden dark:bg-card-dark',
              borderStyles[t.type],
              t.exiting ? 'animate-slide-out-right' : 'animate-slide-up',
            )}
          >
            {icons[t.type]}
            <span className="text-sm font-medium text-ink dark:text-ink-dark">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-2 shrink-0 rounded-lg p-1 text-muted transition hover:bg-surface hover:text-ink dark:text-muted-dark dark:hover:bg-surface-dark dark:hover:text-ink-dark"
            >
              <X size={14} />
            </button>
            <div className={clsx('toast-progress', progressColors[t.type])} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
