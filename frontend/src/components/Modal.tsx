import { useEffect, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-4 sm:pt-[8vh] animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`relative w-full max-w-[calc(100%-2rem)] ${wide ? 'sm:max-w-5xl' : 'sm:max-w-3xl'} mb-12 card rounded-2xl animate-scale-in`}>
        {title && (
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4 dark:border-border-dark">
            <h3 className="text-base sm:text-lg font-bold truncate mr-2 text-ink dark:text-ink-dark">{title}</h3>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-muted transition-all hover:bg-surface hover:text-ink dark:text-muted-dark dark:hover:bg-surface-dark dark:hover:text-ink-dark"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="max-h-[75vh] overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
