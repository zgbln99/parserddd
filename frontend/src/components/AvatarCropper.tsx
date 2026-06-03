import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, X, ZoomIn } from 'lucide-react';
import { useI18n } from '../i18n';
import { Spinner } from './Spinner';

/**
 * Lightweight square avatar cropper — no external dependency.
 *
 * The square viewport IS the crop region: the admin pans (drag) and zooms
 * (slider) the picture inside it, and on confirm we paint exactly what's
 * visible to a canvas and hand back a JPEG blob. A faint circle guide hints
 * how it will look in the round list thumbnail.
 */

const VIEW = 288; // on-screen crop viewport (px, square)
const OUT = 512; // exported image size (px, square)

export function AvatarCropper({
  file,
  busy,
  onCancel,
  onConfirm,
}: {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const baseScale = nat ? Math.max(VIEW / nat.w, VIEW / nat.h) : 1;
  const scale = baseScale * zoom;
  const dispW = nat ? nat.w * scale : 0;
  const dispH = nat ? nat.h * scale : 0;

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(VIEW - dispW, x)),
    y: Math.min(0, Math.max(VIEW - dispH, y)),
  });

  // keep the image covering the viewport when zoom changes
  useEffect(() => {
    if (!nat) return;
    setOff((o) => clamp(o.x, o.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, nat]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const bs = Math.max(VIEW / w, VIEW / h);
    setNat({ w, h });
    setOff({ x: (VIEW - w * bs) / 2, y: (VIEW - h * bs) / 2 }); // centered
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    setOff(clamp(drag.current.ox + (e.clientX - drag.current.x), drag.current.oy + (e.clientY - drag.current.y)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const confirm = () => {
    if (!nat || !url) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const srcSize = VIEW / scale;
      ctx.drawImage(img, -off.x / scale, -off.y / scale, srcSize, srcSize, 0, 0, OUT, OUT);
      canvas.toBlob((blob) => blob && onConfirm(blob), 'image/jpeg', 0.9);
    };
    img.src = url;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-sm rounded-3xl border border-border bg-white p-5 shadow-2xl dark:bg-[#16181d]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{t('profileAvatarAdjust')}</h2>
          <button onClick={onCancel} className="rounded-lg p-1 text-muted hover:bg-surface" aria-label="close">
            <X size={18} />
          </button>
        </div>

        <div className="flex justify-center">
          <div
            className="relative touch-none overflow-hidden rounded-2xl bg-zinc-100 dark:bg-black/40"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {url && (
              <img
                src={url}
                alt=""
                draggable={false}
                onLoad={onImgLoad}
                className="absolute max-w-none cursor-grab select-none active:cursor-grabbing"
                style={{ width: dispW || undefined, height: dispH || undefined, left: off.x, top: off.y }}
              />
            )}
            {/* circular guide */}
            <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-black/10" />
            <div className="pointer-events-none absolute inset-3 rounded-full border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.04)]" />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <ZoomIn size={16} className="shrink-0 text-muted" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer accent-red-600"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted transition hover:bg-surface"
          >
            {t('cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={busy || !nat}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? <Spinner size="sm" /> : <Check size={15} />}
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
