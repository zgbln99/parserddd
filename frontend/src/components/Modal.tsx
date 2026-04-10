import { useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
  fullscreen?: boolean;
}

export function Modal({ open, onClose, title, children, wide, fullscreen }: ModalProps) {
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-4 sm:pt-[8vh] animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`relative w-full card rounded-2xl animate-scale-in ${
        fullscreen
          ? 'max-w-[calc(100%-2rem)] sm:max-w-[calc(100%-4rem)] h-[calc(100vh-4rem)]'
          : `max-w-[calc(100%-2rem)] ${wide ? 'sm:max-w-5xl' : 'sm:max-w-3xl'} mb-12`
      }`}>
        {title && (
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4">
            <h3 className="text-base sm:text-lg font-bold truncate mr-2 text-ink">{title}</h3>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-muted transition-all hover:bg-surface hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className={`overflow-y-auto p-4 sm:p-6 ${fullscreen ? 'h-[calc(100%-60px)]' : 'max-h-[75vh]'}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
