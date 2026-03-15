import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { clsx } from 'clsx';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const icons: Record<ToastType, ReactNode> = {
    success: <CheckCircle size={18} className="text-emerald-500 shrink-0" />,
    error: <AlertCircle size={18} className="text-rose-500 shrink-0" />,
    info: <Info size={18} className="text-blue-500 shrink-0" />,
  };

  const styles: Record<ToastType, string> = {
    success: 'border-emerald-200 dark:border-emerald-800',
    error: 'border-rose-200 dark:border-rose-800',
    info: 'border-blue-200 dark:border-blue-800',
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-20 right-4 z-[100] flex flex-col gap-2 sm:bottom-6 sm:right-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'flex items-center gap-3 rounded-xl border bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm dark:bg-slate-800/95 animate-slide-up',
              styles[t.type],
            )}
          >
            {icons[t.type]}
            <span className="text-sm font-medium">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-2 shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
