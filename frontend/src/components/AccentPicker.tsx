import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';

interface AccentPreset {
  name: string;
  // primary-500, primary-600, primary-700 + primary-50
  colors: {
    '50': string;
    '100': string;
    '200': string;
    '300': string;
    '400': string;
    '500': string;
    '600': string;
    '700': string;
    '800': string;
    '900': string;
  };
}

const presets: AccentPreset[] = [
  {
    name: 'Olive',
    colors: {
      '50': '#F2F5EF', '100': '#E3EAD9', '200': '#C8D6B5', '300': '#A7BD88',
      '400': '#86A35E', '500': '#5B6F4B', '600': '#4A5D3A', '700': '#3D4E30',
      '800': '#2F3C24', '900': '#1F2818',
    },
  },
  {
    name: 'Ocean',
    colors: {
      '50': '#EFF6FF', '100': '#DBEAFE', '200': '#BFDBFE', '300': '#93C5FD',
      '400': '#60A5FA', '500': '#3B82F6', '600': '#2563EB', '700': '#1D4ED8',
      '800': '#1E40AF', '900': '#1E3A8A',
    },
  },
  {
    name: 'Berry',
    colors: {
      '50': '#FDF2F8', '100': '#FCE7F3', '200': '#FBCFE8', '300': '#F9A8D4',
      '400': '#F472B6', '500': '#EC4899', '600': '#DB2777', '700': '#BE185D',
      '800': '#9D174D', '900': '#831843',
    },
  },
  {
    name: 'Amber',
    colors: {
      '50': '#FFFBEB', '100': '#FEF3C7', '200': '#FDE68A', '300': '#FCD34D',
      '400': '#FBBF24', '500': '#D97706', '600': '#B45309', '700': '#92400E',
      '800': '#78350F', '900': '#451A03',
    },
  },
  {
    name: 'Teal',
    colors: {
      '50': '#F0FDFA', '100': '#CCFBF1', '200': '#99F6E4', '300': '#5EEAD4',
      '400': '#2DD4BF', '500': '#14B8A6', '600': '#0D9488', '700': '#0F766E',
      '800': '#115E59', '900': '#134E4A',
    },
  },
  {
    name: 'Violet',
    colors: {
      '50': '#F5F3FF', '100': '#EDE9FE', '200': '#DDD6FE', '300': '#C4B5FD',
      '400': '#A78BFA', '500': '#8B5CF6', '600': '#7C3AED', '700': '#6D28D9',
      '800': '#5B21B6', '900': '#4C1D95',
    },
  },
  {
    name: 'Slate',
    colors: {
      '50': '#F8FAFC', '100': '#F1F5F9', '200': '#E2E8F0', '300': '#CBD5E1',
      '400': '#94A3B8', '500': '#64748B', '600': '#475569', '700': '#334155',
      '800': '#1E293B', '900': '#0F172A',
    },
  },
  {
    name: 'Rose',
    colors: {
      '50': '#FFF1F2', '100': '#FFE4E6', '200': '#FECDD3', '300': '#FDA4AF',
      '400': '#FB7185', '500': '#F43F5E', '600': '#E11D48', '700': '#BE123C',
      '800': '#9F1239', '900': '#881337',
    },
  },
];

const STORAGE_KEY = 'ddd-accent';

function getSavedAccent(): string {
  return localStorage.getItem(STORAGE_KEY) || 'Olive';
}

function applyAccent(preset: AccentPreset) {
  const root = document.documentElement;
  for (const [shade, color] of Object.entries(preset.colors)) {
    root.style.setProperty(`--color-primary-${shade}`, color);
  }
  localStorage.setItem(STORAGE_KEY, preset.name);
}

// Apply saved accent on app load
export function initAccent() {
  const name = getSavedAccent();
  const preset = presets.find((p) => p.name === name);
  if (preset && preset.name !== 'Olive') {
    applyAccent(preset);
  }
}

export function AccentPicker({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState(getSavedAccent);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleSelect = (preset: AccentPreset) => {
    setSelected(preset.name);
    applyAccent(preset);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative z-10 w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Kolor motywu</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {presets.map((preset) => (
            <button
              key={preset.name}
              onClick={() => handleSelect(preset)}
              className="group flex flex-col items-center gap-2"
            >
              <div
                className="relative flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
                style={{ backgroundColor: preset.colors['600'] }}
              >
                {selected === preset.name && (
                  <Check size={18} className="text-white" />
                )}
              </div>
              <span className="text-[11px] font-medium text-muted">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
