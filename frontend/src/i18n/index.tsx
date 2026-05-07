import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { pl, type TranslationKey } from './pl';
import { de } from './de';

export type Locale = 'pl' | 'de';

const translations: Record<Locale, Record<TranslationKey, string>> = { pl, de };

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'pl',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('ddd-locale');
    return (saved === 'de' ? 'de' : 'pl') as Locale;
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('ddd-locale', l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: TranslationKey) => translations[locale][key] ?? key,
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export type { TranslationKey };
