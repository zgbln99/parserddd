import type { TranslationKey } from './pl';

export const de: Record<TranslationKey, string> = {
  // General
  appName: 'DDD-Portal',
  appSubtitle: 'Tachographen-Dateien herunterladen',
  loading: 'Wird geladen...',
  error: 'Fehler',
  close: 'Schließen',
  save: 'Speichern',
  cancel: 'Abbrechen',
  search: 'Suchen',
  refresh: 'Aktualisieren',
  clear: 'Löschen',
  noData: 'Keine Daten',
  days: 'Tage',
  day: 'Tag',
  files: 'Dateien',
  file: 'Datei',
  yes: 'JA',
  no: 'NEIN',
  back: 'Zurück',

  // Auth
  login: 'Anmelden',
  logout: 'Abmelden',
  password: 'Passwort',
  loginTitle: 'DDD-Portal',
  loginSubtitle: 'Tachographen-Dateien herunterladen',
  loginError: 'Falsches Passwort',
  loginPlaceholder: 'Passwort eingeben',

  // Navigation
  navDashboard: 'Übersicht',
  navDrivers: 'Fahrer',
  navReader: 'Kartenleser',
  navSync: 'Sync-Monitor',
  navSettings: 'Einstellungen',

  // Dashboard
  dashTitle: 'Übersicht',
  dashDrivers: 'Fahrer',
  dashFiles: 'Dateien',
  dashLastSync: 'Letzte Synchronisierung',
  dashSyncStatus: 'Sync-Status',
  dashSyncErrors: 'Sync-Fehler',
  dashNewFiles: 'Neue Dateien',
  dashTotalSynced: 'Gesamt synchronisiert',
  dashQuickActions: 'Schnellzugriff',
  dashViewDrivers: 'Fahrer anzeigen',
  dashOpenReader: 'Kartenleser öffnen',
  dashViewSync: 'Synchronisierungsverlauf',

  // Drivers
  driversTitle: 'Fahrer',
  driversSearch: 'Fahrer suchen...',
  driversName: 'Name',
  driversCardNumber: 'Fahrerkartennummer',
  driversFileStart: 'Beginn der letzten Datei',
  driversFileEnd: 'Ende der letzten Datei',
  driversLastDownload: 'Zuletzt heruntergeladen',
  driversDaysSince: 'Seit letztem Download',
  driversFileCount: 'Dateien',
  driversNoData: 'Keine Daten. Stellen Sie sicher, dass die Samsara-Dropbox-Synchronisierung funktioniert.',
  driversNoDays: 'keine Daten',

  // Driver detail
  detailFiles: 'Fahrerdateien',
  detailFrom: 'Von',
  detailTo: 'Bis',
  detailAnalyze: 'Analysieren',
  detailNoFiles: 'Keine Dateien im ausgewählten Zeitraum',

  // Analysis
  analysisTitle: 'Dateianalyse',
  analysisLoading: 'Datei wird analysiert...',
  analysisWorkTime: 'Arbeitszeit',
  analysisDriving: 'Fahren',
  analysisNight25: 'Nacht 25 %',
  analysisNight40: 'Nacht 40 %',
  analysisBreaks: 'Pausen',
  analysisAvailability: 'Bereitschaft',
  analysisDiet: 'Verpflegung',
  analysisDuration: 'Dauer',
  analysisVehicle: 'Fahrzeug',
  analysisStart: 'Start',
  analysisEnd: 'Ende',
  analysisTime: 'Zeit',
  analysisWork: 'Arbeit',
  analysisIssued: 'Ausgestellt',
  analysisValidUntil: 'Gültig bis',
  analysisShifts: 'Schichten',
  analysisExportCsv: 'CSV-Export',
  analysisTotalShifts: 'Schichten gesamt',
  analysisDietCount: 'Verpflegungspauschalen',
  analysisDateFilter: 'Schichten filtern',
  analysisWeekday: 'Tag',
  analysisChart: 'Stundendiagramm',
  analysisPrint: 'Drucken',
  dietReport: 'Verpflegungsbericht',

  // Reader
  readerTitle: 'DDD-Kartenleser',
  readerUpload: '.ddd-Datei hierher ziehen oder klicken, um auszuwählen',
  readerUploadBtn: 'Datei auswählen',
  readerAnalyzing: 'Wird analysiert...',
  readerDropHint: '.ddd-Datei hier ablegen',
  readerSelectFile: 'oder klicken, um eine Datei auszuwählen',

  // Sync monitor
  syncTitle: 'Synchronisierungsmonitor',
  syncLastStatus: 'Letzter Status',
  syncLastRun: 'Letzte Synchronisierung',
  syncTotalUploaded: 'Gesamt heruntergeladen',
  syncTotalRuns: 'Ausführungen',
  syncDate: 'Datum',
  syncStatus: 'Status',
  syncFound: 'Gefunden',
  syncUploaded: 'Heruntergeladen',
  syncErrors: 'Fehler',
  syncFiles: 'Dateien',
  syncOk: 'OK',
  syncPartial: 'Teilweise',
  syncErrorLabel: 'Fehler',
  syncNoHistory: 'Kein Synchronisierungsverlauf. Der Cron-Job wurde noch nicht ausgeführt.',
  syncFilesFrom: 'Dateien vom',
  syncHourlyCron: 'Stündliche Synchronisierung',

  // Quick date filters
  filterThisMonth: 'Dieser Monat',
  filterLastMonth: 'Letzter Monat',
  filterLast30: 'Letzte 30 Tage',

  // PDF export
  analysisExportPdf: 'PDF-Export',

  // Driver alerts
  driversOverdueAlert: 'Überfälliger Download (>28 Tage)',
  driversOverdueCount: 'Fahrer mit überfälligem Download',

  // Connections
  dropboxConnected: 'Dropbox verbunden',
  dropboxDisconnected: 'Dropbox getrennt',
  samsaraConnected: 'Samsara verbunden',
  samsaraDisconnected: 'Samsara getrennt',
  globalDateFilter: 'Datumsfilter',

  // Theme
  lightMode: 'Hell',
  darkMode: 'Dunkel',

  // Language
  langPolish: 'Polski',
  langGerman: 'Deutsch',

  // Pagination
  pageOf: 'von',
  pageNext: 'Nächste',
  pagePrev: 'Vorherige',

  // Time
  timeAgo: 'her',
  timeJustNow: 'gerade eben',
  timeMinutes: 'Min.',
  timeHours: 'Std.',
};
