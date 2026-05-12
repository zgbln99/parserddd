const BASE = '';

function friendlyError(status: number, serverMsg?: string): string {
  if (serverMsg) return serverMsg;
  switch (status) {
    case 403: return 'Brak uprawnień / Keine Berechtigung';
    case 404: return 'Nie znaleziono / Nicht gefunden';
    case 429: return 'Zbyt wiele prób / Zu viele Versuche';
    case 500: case 502: case 503: return 'Błąd serwera / Serverfehler';
    default: return `HTTP ${status}`;
  }
}

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${url}`, {
      credentials: 'include',
      ...opts,
      headers: {
        ...(opts?.headers || {}),
      },
    });
  } catch {
    throw new Error('Brak połączenia z serwerem / Keine Verbindung zum Server');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(friendlyError(res.status));
  }
  if (!res.ok) throw new Error(data.error || friendlyError(res.status));
  return data as T;
}

// Auth
export const authLogin = (password: string) =>
  request<{ ok: boolean; role: string }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

export const authLogout = () =>
  request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });

export const authStatus = () =>
  request<{ logged_in: boolean; role: string }>('/api/auth/status');

// Dashboard
export interface StaleDriver {
  name: string;
  card_number: string;
  days_since: number | null;
  latest_download: string;
  file_count: number;
  latest_file_path: string;
  latest_file_name: string;
}

export interface ExpiringCard {
  card_number: string;
  driver_name: string;
  card_expiry_date: string;
  days_left: number;
}

export const fetchDashboard = () =>
  request<{
    driver_count: number;
    total_files: number;
    last_sync: string;
    synced_count: number;
    last_sync_status: string;
    last_sync_errors: number;
    last_sync_uploaded: number;
    stale_drivers: StaleDriver[];
    expiring_cards: ExpiringCard[];
  }>('/api/dashboard');

export const scanCardExpiry = () =>
  request<{ scanned: number; results: { driver: string; card_number: string; card_expiry_date: string }[] }>(
    '/api/dashboard/scan-expiry',
    { method: 'POST' },
  );

export interface MonthlyDays {
  card_number: string;
  period: string;
  vacation_days: number;
  sick_days: number;
  overtime_hm: string;
  notes: string;
  absence_days: Record<string, 'Ur' | 'Kr'>;
  override_n25?: string;
  override_n40?: string;
  override_work_hm?: string;
}

export const fetchMonthlyDays = (cardNumber: string, period: string) =>
  request<MonthlyDays>(`/api/driver-monthly/${encodeURIComponent(cardNumber)}/${encodeURIComponent(period)}`);

export const saveMonthlyDays = (cardNumber: string, period: string, data: Partial<MonthlyDays>) =>
  request<{ ok: boolean }>(`/api/driver-monthly/${encodeURIComponent(cardNumber)}/${encodeURIComponent(period)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

// Payroll status
export type PayrollStatusValue = '' | 'policzony' | 'stundenzettel';

export const fetchPayrollStatus = (period: string) =>
  request<{ period: string; statuses: Record<string, PayrollStatusValue> }>(
    `/api/payroll-status/${encodeURIComponent(period)}`,
  );

export const setPayrollStatus = (period: string, cardNumber: string, status: PayrollStatusValue) =>
  request<{ ok: boolean }>(`/api/payroll-status/${encodeURIComponent(period)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_number: cardNumber, status }),
  });

// Drivers
export const fetchDrivers = (refresh = false) =>
  request<{ drivers: import('../types').Driver[]; cached?: boolean }>(
    `/api/drivers${refresh ? '?refresh=1' : ''}`,
  );

// Add driver manually
export const addDriver = (name: string) =>
  request<{ ok: boolean; path: string }>('/api/drivers/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

// Save reader file to Dropbox
export async function saveReaderFileToDropbox(file: File, driverName: string, cardNumber: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('driver_name', driverName);
  form.append('card_number', cardNumber);
  return request<{ ok: boolean; path: string; filename: string }>('/api/reader/save-to-dropbox', {
    method: 'POST',
    body: form,
  });
}

// Analysis
export const analyzeDropboxFile = (path: string) =>
  request<import('../types').AnalysisResult>(
    `/api/analyze/dropbox?path=${encodeURIComponent(path)}`,
  );

export const analyzeUploadedFile = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<import('../types').AnalysisResult>('/api/analyze', {
    method: 'POST',
    body: form,
  });
};

export const analyzeMergedFiles = async (file1: File, file2: File) => {
  const form = new FormData();
  form.append('files', file1);
  form.append('files', file2);
  return request<import('../types').AnalysisResult & { merged?: boolean; merged_files?: string[]; merged_days?: number }>('/api/analyze/merge', {
    method: 'POST',
    body: form,
  });
};

export const analyzeMergedDropboxFiles = (paths: string[]) =>
  request<import('../types').AnalysisResult & { merged?: boolean; merged_files?: string[]; merged_days?: number }>('/api/analyze/merge-dropbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });

// Fahrerliste — the accountant's monthly driver-list Excel
export interface FahrerlisteStatus {
  exists: boolean;
  period?: string;
  count?: number;
  drivers?: string[];
  sheets?: string[];
  updated_at?: string;
  error?: string;
}

export interface FahrerlisteFillPayload {
  period: string;
  driver_name: string;
  driver_card?: string;
  days?: Record<string, string>;
  absences?: Record<string, string>;
  n25?: number | string;
  n40?: number | string;
  vma?: number;
  az?: string;
  ur?: number;
  kr?: number;
}

export const uploadFahrerliste = (period: string, file: File) => {
  const form = new FormData();
  form.append('period', period);
  form.append('file', file);
  return request<{ period: string; count: number; drivers: string[]; sheets: string[] }>('/api/fahrerliste/upload', {
    method: 'POST',
    body: form,
  });
};

export const fahrerlisteStatus = (period: string) =>
  request<FahrerlisteStatus>(`/api/fahrerliste/status?period=${encodeURIComponent(period)}`);

export const fahrerlisteFill = (payload: FahrerlisteFillPayload) =>
  request<{ ok: boolean; filled: { sheet: string; row: number }[]; matched_name: string }>('/api/fahrerliste/fill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const fahrerlisteDownloadUrl = (period: string) =>
  `/api/fahrerliste/download?period=${encodeURIComponent(period)}`;

// ---------------------------------------------------------------------------
// Compliance (activity-based violation detection on the current analysis
// result). The endpoint never re-parses the file — it consumes whatever
// the frontend already has in memory.
// ---------------------------------------------------------------------------

export type ComplianceSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ComplianceViolation {
  id?: string;
  driverId: string;
  vehicleId?: string | null;
  countryProfile: string;
  ruleCode: string;
  title: string;
  titlePl?: string | null;
  titleDe?: string | null;
  description: string;
  legalBasis: string;
  severity: ComplianceSeverity;
  start: string;
  end: string;
  actualMinutes?: number | null;
  limitMinutes?: number | null;
  excessMinutes?: number | null;
  evidence?: unknown[];
  recommendedAction?: string | null;
  status?: string;
  extra?: Record<string, unknown>;
}

export interface ComplianceWebhookEvent {
  event: string;
  driverId: string;
  vehicleId?: string | null;
  countryProfile: string;
  ruleCode: string;
  severity: ComplianceSeverity;
  start: string;
  end: string;
  violation: ComplianceViolation;
}

export interface ComplianceResponse {
  countryProfile: string;
  violations: ComplianceViolation[];
  events: ComplianceWebhookEvent[];
}

export const evaluateParserAnalysis = (
  parserAnalysis: unknown,
  countryProfile: string = 'DE',
) =>
  request<ComplianceResponse>(
    '/api/compliance/evaluate-parser-analysis',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryProfile, parserAnalysis }),
    },
  );

// ---------------------------------------------------------------------------
// Range-based compliance — server-side: fetches Dropbox DDD files for the
// requested driver + range, parses them, runs the activity-based engine,
// merges per-violation status from violation_statuses.
// ---------------------------------------------------------------------------

export interface ComplianceRangeViolation extends ComplianceViolation {
  statusNote?: string;
  signedToken?: string;
  statusUpdatedAt?: string;
}

export interface ComplianceRangeResponse {
  driver_card: string;
  driver_name: string;
  vehicle: string | null;
  period: { from: string; to: string };
  countryProfile: string;
  violations: ComplianceRangeViolation[];
  summary: {
    count: number;
    bySeverity: Record<string, number>;
    byRule: Record<string, number>;
  };
}

export const evaluateComplianceRange = (body: {
  driver_card: string;
  driver_name?: string;
  date_from: string;
  date_to: string;
  file_paths: string[];
  locale?: 'de' | 'en' | 'pl';
  country_profile?: string;
}) =>
  request<ComplianceRangeResponse>(
    '/api/compliance/violations/evaluate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

export type ViolationStatus =
  | 'NEW' | 'REVIEWED' | 'EXPLAINED' | 'DRIVER_NOTIFIED'
  | 'TRAINING_REQUIRED' | 'DISMISSED_FALSE_POSITIVE' | 'SIGNED';

export const setViolationStatus = (body: {
  violation_id: string;
  status: ViolationStatus;
  note?: string;
  rule_code?: string;
  driver_card?: string;
}) =>
  request<{ ok: boolean; violation_id: string; status: string }>(
    '/api/compliance/violations/status',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

export interface ComplianceSignLinkResponse {
  token: string;
  url: string;
  expires_at: string;
  payload_hash: string;
}

export const createComplianceSignLink = (body: {
  driver_card: string;
  driver_name?: string;
  locale?: 'de' | 'en' | 'pl';
  period_label?: string;
  violations: ComplianceViolation[];
}) =>
  request<ComplianceSignLinkResponse>(
    '/api/compliance/violations/sign-link',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );


// Stundenzettel OCR parsing
export interface StundenzettelDay {
  day: number;
  start: string | null;
  end: string | null;
  pause_minutes: number;
  code: string | null;
  remarks: string | null;
  work_minutes: number;
  night_25_minutes: number;
  night_40_minutes: number;
  has_diet: boolean;
}

export interface StundenzettelTotals {
  work_minutes: number;
  work_hm: string;
  work_decimal: number;
  night_25_minutes: number;
  night_25_hm: string;
  night_40_minutes: number;
  night_40_hm: string;
  total_night_minutes: number;
  total_night_hm: string;
  diet_count: number;
  sick_days: number;
  vacation_days: number;
  holiday_days: number;
  work_days: number;
}

export interface StundenzettelResult {
  name: string;
  personal_nr: string;
  month: number;
  year: number;
  period: string;
  days: StundenzettelDay[];
  totals: StundenzettelTotals;
  error?: string;
  page?: number;
}

export const parseStundenzettel = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<{ results: StundenzettelResult[]; pages: number }>('/api/stundenzettel/parse', {
    method: 'POST',
    body: form,
  });
};

// Vacation PDF parsing
export interface VacationEntry {
  name: string;
  ranges: { von: string; bis: string; tage: number }[];
  total_tage: number;
}

export const parseVacationPdf = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<{ entries: VacationEntry[]; count: number }>('/api/vacation/parse', {
    method: 'POST',
    body: form,
  });
};

// DDD file preview (hex dump + decoded structure)
export const previewDddFile = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<import('../types').DddPreviewData>('/api/preview-ddd', {
    method: 'POST',
    body: form,
  });
};

// Connection status
export const fetchConnectionStatus = () =>
  request<{ dropbox: boolean; samsara: boolean }>('/api/status/connections');

// Samsara live HOS status
export interface LiveDriverStatus {
  id: string;
  name: string;
  status: 'driving' | 'work' | 'rest' | 'unknown';
  hos_status: string;
  vehicle: string;
  drive_remaining_min: number;
  shift_remaining_min: number;
  break_in_min: number;
}

export const fetchLiveStatus = () =>
  request<{ drivers: LiveDriverStatus[]; timestamp: string }>('/api/samsara/live-status');

// Sync
export const fetchSyncStatus = () =>
  request<{ last_sync: string; synced_count: number }>('/api/sync/status');

export const fetchSyncLog = () =>
  request<{ history: import('../types').SyncHistoryEntry[] }>('/api/sync/log');

// Admin
export interface LoginHistoryEntry {
  timestamp: string;
  role: string;
  username?: string;
  ip: string;
  user_agent: string;
}

export const fetchLoginHistory = () =>
  request<{ history: LoginHistoryEntry[] }>('/api/admin/login-history');

// Activity log
export interface ActivityLogEntry {
  timestamp: string;
  role: string;
  username: string;
  ip: string;
  action: string;
  detail: string;
}

export const fetchActivityLog = () =>
  request<{ log: ActivityLogEntry[] }>('/api/admin/activity-log');

// User management
export interface UserEntry {
  id: number;
  name: string;
  role: string;
  permissions: string[];
  created: string;
}

export const fetchUsers = () =>
  request<{ users: UserEntry[] }>('/api/admin/users');

export const createUser = (name: string, password: string, role: string, permissions?: string[]) =>
  request<{ ok: boolean; id: number }>('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password, role, permissions }),
  });

export const deleteUser = (id: number) =>
  request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' });

// Password change
export const changePassword = (target: 'portal' | 'admin', newPassword: string) =>
  request<{ ok: boolean }>('/api/admin/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, new_password: newPassword }),
  });

// Sync config
export interface SyncConfig {
  samsara_api_token: string;
  samsara_api_token_set: boolean;
  dropbox_refresh_token_set: boolean;
  sync_dest_folder: string;
  night_start_hour: number;
  parser_engine: string;
  pause_cap_enabled: boolean;
  weekend_diet: boolean;
  night_includes_breaks: boolean;
  hidden_features: string[];
  company_name: string;
  mindestlohn_default_monthly_gross_eur: number;
  mindestlohn_min_hourly_eur: number;
}

export const fetchConfig = () =>
  request<SyncConfig>('/api/admin/config');

// MiLoG minimum-wage parameters (login-only, not admin-only)
export interface MindestlohnSettings {
  default_monthly_gross_eur: number;
  min_hourly_eur: number;
}

export const fetchMindestlohnSettings = () =>
  request<MindestlohnSettings>('/api/mindestlohn/settings');

export const updateConfig = (data: Record<string, string | number | string[]>) =>
  request<{ ok: boolean }>('/api/admin/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

// Driver config
export interface DriverConfig {
  id?: number;
  card_number: string;
  driver_name: string;
  personal_nr: string;
  double_diet: number; // 0 or 1
  diet_rate: number;
  monthly_gross_eur: number; // 0 = use the global default from admin config (MiLoG check)
  night_40_enabled: number; // 0 or 1 — 40% night premium for pre-midnight shifts
  pause_cap_enabled: number; // 0 or 1 — cap break at 45min when driving < 4.5h
  notes: string;
  created_at?: string;
  updated_at?: string;
}

export const fetchDriverConfigs = () =>
  request<{ configs: DriverConfig[] }>('/api/driver-config');

export const fetchDriverConfig = (cardNumber: string) =>
  request<DriverConfig>(`/api/driver-config/${encodeURIComponent(cardNumber)}`);

export const saveDriverConfig = (data: Partial<DriverConfig> & { card_number: string }) =>
  request<{ ok: boolean }>('/api/driver-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

export const deleteDriverConfig = (id: number) =>
  request<{ ok: boolean }>(`/api/driver-config/${id}`, { method: 'DELETE' });

export const bulkUpdateDriverConfig = (cardNumbers: string[], updates: Partial<DriverConfig>) =>
  request<{ ok: boolean; updated: number }>('/api/driver-config/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_numbers: cardNumbers, updates }),
  });

// Config audit log
export interface ConfigAuditEntry {
  id: number;
  card_number: string;
  driver_name: string;
  action: string;
  field_name: string;
  old_value: string;
  new_value: string;
  changed_by: string;
  changed_at: string;
}

export const fetchConfigHistory = (cardNumber?: string) =>
  request<{ entries: ConfigAuditEntry[] }>(
    `/api/admin/config-history${cardNumber ? `?card_number=${encodeURIComponent(cardNumber)}` : ''}`
  );

// Compare drivers
export interface CompareShift {
  date: string;
  weekday: string;
  start: string;
  end: string;
  duration_hm: string;
  work_minutes: number;
}

export interface CompareDriverResult {
  driver_name: string;
  card_number: string;
  shifts: CompareShift[];
  error?: string;
}

export const compareDrivers = (files: { path: string; driver_name: string; card_number: string }[]) =>
  request<{ drivers: CompareDriverResult[] }>('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });

// CSV export (returns blob)
export async function exportCsv(driverName: string, shifts: unknown[]) {
  const res = await fetch('/api/export/csv', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_name: driverName, shifts }),
  });
  if (!res.ok) throw new Error('CSV export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// DATEV export (returns blob)
export async function exportDatev(driverName: string, cardNumber: string, summary: unknown, shifts: unknown[], period: string) {
  const res = await fetch('/api/export/datev', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_name: driverName, card_number: cardNumber, summary, shifts, period }),
  });
  if (!res.ok) throw new Error('DATEV export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'DATEV_export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// Settlement (monthly batch analysis)
export interface SettlementDriverSummary {
  total_work_minutes: number;
  total_work_hm: string;
  total_driving_minutes: number;
  total_driving_hm: string;
  total_break_minutes: number;
  total_break_hm: string;
  total_avail_minutes: number;
  night_25_minutes: number;
  night_25_hm: string;
  night_40_minutes: number;
  night_40_hm: string;
  diet_count: number;
  effective_diet_count: number;
  vma_amount: number;
  total_shifts: number;
}

export interface SettlementDriver {
  driver_name: string;
  card_number: string;
  personal_nr: string;
  double_diet: boolean;
  diet_rate: number;
  summary: SettlementDriverSummary;
  shifts: unknown[];
  mindestlohn?: import('./mindestlohn').MindestlohnResult | null;
}

export const fetchSettlement = (period: string) =>
  request<{ period: string; drivers: SettlementDriver[] }>('/api/settlement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period }),
  });

// DATEV batch export (returns blob)
export async function exportDatevBatch(period: string, drivers: SettlementDriver[]) {
  const res = await fetch('/api/export/datev-batch', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period, drivers }),
  });
  if (!res.ok) throw new Error('DATEV batch export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || `DATEV_Alle_${period}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Vehicle activity (Samsara GPS/engine controlling)
export interface VehicleTrip {
  start: string;  // HH:MM
  end: string;    // HH:MM
  km: number;
}

export interface VehicleDayActivity {
  date: string;
  begin_driving: string;
  last_driving: string;
  duration_h: number;
  duration_m: number;
  duration_hm: string;
  duration_minutes: number;
  distance_km: number;
  trips_count?: number;
  last_location?: string;
  trips?: VehicleTrip[];
}

export interface VehicleActivity {
  vehicle_id: string;
  vehicle_name: string;
  days: VehicleDayActivity[];
  total_km: number;
  active_days: number;
  distance_source?: string;
}

export interface VehicleDebugInfo {
  api_calls: number;
  raw_trips: number;
  vehicles_with_data: number;
  total_days: number;
  errors: string[];
  sample_trip_keys?: string[];
  stats_vehicles?: number;
  stats_source?: string;
  [key: string]: unknown;
}

export interface SamsaraVehicle {
  id: string;
  name: string;
  vin: string;
  serial: string;
  license_plate: string;
}

export const fetchSamsaraVehicles = () =>
  request<{ vehicles: SamsaraVehicle[] }>('/api/vehicles');

export const fetchVehicleActivity = (period: string, vehicleIds?: string[], dateFrom?: string, dateTo?: string) =>
  request<{ period: string; vehicles: VehicleActivity[]; debug: VehicleDebugInfo }>('/api/vehicles/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period, vehicle_ids: vehicleIds || [], date_from: dateFrom || '', date_to: dateTo || '' }),
  });

// Driver KM from tachograph card (odometer readings)
export interface DriverKmVehicle {
  plate: string;
  first_use: string;
  last_use: string;
  odometer_begin_km: number;
  odometer_end_km: number;
  distance_km: number;
}

export interface DriverKmEntry {
  driver_name: string;
  card_number: string;
  vehicles: DriverKmVehicle[];
  total_km: number;
}

export const fetchDriverKm = (dateFrom: string, dateTo: string, driverNames?: string[]) =>
  request<{ date_from: string; date_to: string; drivers: DriverKmEntry[] }>('/api/driver-km', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date_from: dateFrom, date_to: dateTo, driver_names: driverNames || [] }),
  });

// PDF export (returns blob)
export async function exportPdf(driverName: string, cardNumber: string, summary: unknown, shifts: unknown[]) {
  const res = await fetch('/api/export/pdf', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driver_name: driverName, card_number: cardNumber, summary, shifts }),
  });
  if (!res.ok) throw new Error('PDF export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'export.pdf';
  a.click();
  URL.revokeObjectURL(url);
}

// Toll Collect – Dropbox integration
export interface TollCollectFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export const fetchTollCollectFiles = () =>
  request<{ files: TollCollectFile[] }>('/api/tollcollect/files');

export async function uploadTollCollectFile(file: File, period?: string) {
  const form = new FormData();
  form.append('file', file);
  if (period) form.append('period', period);
  return request<{ ok: boolean; path: string; filename: string }>('/api/tollcollect/upload', {
    method: 'POST',
    body: form,
  });
}

export const downloadTollCollectFile = (path: string) =>
  request<{ ok: boolean; filename: string; content: string }>(
    `/api/tollcollect/download?path=${encodeURIComponent(path)}`,
  );

export const deleteTollCollectFile = (path: string) =>
  request<{ ok: boolean }>('/api/tollcollect/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });


