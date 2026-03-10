export const pl = {
  // General
  appName: 'Portal DDD',
  appSubtitle: 'Pobieranie plików z tachografu',
  loading: 'Wczytywanie...',
  error: 'Błąd',
  close: 'Zamknij',
  save: 'Zapisz',
  cancel: 'Anuluj',
  search: 'Szukaj',
  refresh: 'Odśwież',
  clear: 'Wyczyść',
  noData: 'Brak danych',
  days: 'dni',
  day: 'dzień',
  files: 'plików',
  file: 'plik',
  yes: 'TAK',
  no: 'NIE',
  back: 'Wróć',

  // Auth
  login: 'Zaloguj się',
  logout: 'Wyloguj',
  password: 'Hasło',
  loginTitle: 'Portal DDD',
  loginSubtitle: 'Pobieranie plików z tachografu',
  loginError: 'Nieprawidłowe hasło',
  loginPlaceholder: 'Wprowadź hasło',

  // Navigation
  navDashboard: 'Pulpit',
  navDrivers: 'Kierowcy',
  navReader: 'Czytnik kart',
  navSync: 'Monitor sync',
  navSettings: 'Ustawienia',

  // Dashboard
  dashTitle: 'Pulpit',
  dashDrivers: 'Kierowcy',
  dashFiles: 'Pliki',
  dashLastSync: 'Ostatnia synchronizacja',
  dashSyncStatus: 'Status sync',
  dashSyncErrors: 'Błędy sync',
  dashNewFiles: 'Nowe pliki',
  dashTotalSynced: 'Łącznie zsynchronizowanych',
  dashQuickActions: 'Szybkie akcje',
  dashViewDrivers: 'Przeglądaj kierowców',
  dashOpenReader: 'Otwórz czytnik kart',
  dashViewSync: 'Historia synchronizacji',

  // Drivers
  driversTitle: 'Kierowcy',
  driversSearch: 'Szukaj kierowców...',
  driversName: 'Nazwa',
  driversCardNumber: 'Numer karty kierowcy',
  driversFileStart: 'Początek ostatniego pliku',
  driversFileEnd: 'Koniec ostatniego pliku',
  driversLastDownload: 'Ostatnio pobrane',
  driversDaysSince: 'Od ostatniego pobrania',
  driversFileCount: 'Pliki',
  driversNoData: 'Brak danych. Upewnij się, że synchronizacja Samsara-Dropbox działa poprawnie.',
  driversNoDays: 'brak danych',

  // Driver detail
  detailFiles: 'Pliki kierowcy',
  detailFrom: 'Od',
  detailTo: 'Do',
  detailAnalyze: 'Analizuj',
  detailNoFiles: 'Brak plików w wybranym zakresie',

  // Analysis
  analysisTitle: 'Analiza pliku',
  analysisLoading: 'Analizowanie pliku...',
  analysisWorkTime: 'Czas pracy',
  analysisDriving: 'Jazda',
  analysisNight25: 'Nocne 25%',
  analysisNight40: 'Nocne 40%',
  analysisBreaks: 'Przerwy',
  analysisAvailability: 'Dyspozycyjność',
  analysisDiet: 'Dieta',
  analysisDuration: 'Czas trwania',
  analysisVehicle: 'Pojazd',
  analysisStart: 'Start',
  analysisEnd: 'Koniec',
  analysisTime: 'Czas',
  analysisWork: 'Praca',
  analysisIssued: 'Wydano',
  analysisValidUntil: 'Ważna do',
  analysisShifts: 'Zmiany',
  analysisExportCsv: 'Eksport CSV',
  analysisTotalShifts: 'Łącznie zmian',
  analysisDietCount: 'Diety',
  analysisDateFilter: 'Filtruj zmiany',

  // Reader
  readerTitle: 'Czytnik kart DDD',
  readerUpload: 'Przeciągnij plik .ddd lub kliknij, aby wybrać',
  readerUploadBtn: 'Wybierz plik',
  readerAnalyzing: 'Analizowanie...',
  readerDropHint: 'Upuść plik .ddd tutaj',
  readerSelectFile: 'lub kliknij, aby wybrać z dysku',

  // Sync monitor
  syncTitle: 'Monitor synchronizacji',
  syncLastStatus: 'Ostatni status',
  syncLastRun: 'Ostatnia synchronizacja',
  syncTotalUploaded: 'Łącznie pobranych',
  syncTotalRuns: 'Uruchomień',
  syncDate: 'Data',
  syncStatus: 'Status',
  syncFound: 'Znalezione',
  syncUploaded: 'Pobrane',
  syncErrors: 'Błędy',
  syncFiles: 'Pliki',
  syncOk: 'OK',
  syncPartial: 'Częściowy',
  syncErrorLabel: 'Błąd',
  syncNoHistory: 'Brak historii synchronizacji. Cron jeszcze nie uruchomił synchronizacji.',
  syncFilesFrom: 'Pliki z',
  syncHourlyCron: 'Synchronizacja co godzinę',

  // Theme
  lightMode: 'Jasny',
  darkMode: 'Ciemny',

  // Language
  langPolish: 'Polski',
  langGerman: 'Deutsch',

  // Pagination
  pageOf: 'z',
  pageNext: 'Następna',
  pagePrev: 'Poprzednia',

  // Time
  timeAgo: 'temu',
  timeJustNow: 'przed chwilą',
  timeMinutes: 'min',
  timeHours: 'godz.',
} as const;

export type TranslationKey = keyof typeof pl;
