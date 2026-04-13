import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface DateFilterContextValue {
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  clear: () => void;
}

const DateFilterContext = createContext<DateFilterContextValue>({
  dateFrom: '',
  dateTo: '',
  setDateFrom: () => {},
  setDateTo: () => {},
  clear: () => {},
});

function lastFullMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last) };
}

export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [dateFrom, setDateFromState] = useState(() => {
    const saved = localStorage.getItem('ddd-date-from');
    if (saved) return saved;
    return lastFullMonth().from;
  });
  const [dateTo, setDateToState] = useState(() => {
    const saved = localStorage.getItem('ddd-date-to');
    if (saved) return saved;
    return lastFullMonth().to;
  });

  const setDateFrom = useCallback((v: string) => {
    setDateFromState(v);
    if (v) localStorage.setItem('ddd-date-from', v);
    else localStorage.removeItem('ddd-date-from');
  }, []);

  const setDateTo = useCallback((v: string) => {
    setDateToState(v);
    if (v) localStorage.setItem('ddd-date-to', v);
    else localStorage.removeItem('ddd-date-to');
  }, []);

  const clear = useCallback(() => {
    setDateFrom('');
    setDateTo('');
  }, [setDateFrom, setDateTo]);

  return (
    <DateFilterContext.Provider value={{ dateFrom, dateTo, setDateFrom, setDateTo, clear }}>
      {children}
    </DateFilterContext.Provider>
  );
}

export function useDateFilter() {
  return useContext(DateFilterContext);
}
