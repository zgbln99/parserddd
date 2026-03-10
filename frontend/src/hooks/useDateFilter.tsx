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

export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [dateFrom, setDateFromState] = useState(() => localStorage.getItem('ddd-date-from') || '');
  const [dateTo, setDateToState] = useState(() => localStorage.getItem('ddd-date-to') || '');

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
