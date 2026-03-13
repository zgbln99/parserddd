const BASE = '';

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    credentials: 'include',
    ...opts,
    headers: {
      ...(opts?.headers || {}),
    },
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
export const fetchDashboard = () =>
  request<{
    driver_count: number;
    total_files: number;
    last_sync: string;
    synced_count: number;
    last_sync_status: string;
    last_sync_errors: number;
    last_sync_uploaded: number;
  }>('/api/dashboard');

// Drivers
export const fetchDrivers = (refresh = false) =>
  request<{ drivers: import('../types').Driver[]; cached?: boolean }>(
    `/api/drivers${refresh ? '?refresh=1' : ''}`,
  );

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

// Connection status
export const fetchConnectionStatus = () =>
  request<{ dropbox: boolean; samsara: boolean }>('/api/status/connections');

// Sync
export const fetchSyncStatus = () =>
  request<{ last_sync: string; synced_count: number }>('/api/sync/status');

export const fetchSyncLog = () =>
  request<{ history: import('../types').SyncHistoryEntry[] }>('/api/sync/log');

// Admin
export interface LoginHistoryEntry {
  timestamp: string;
  role: string;
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
  created: string;
}

export const fetchUsers = () =>
  request<{ users: UserEntry[] }>('/api/admin/users');

export const createUser = (name: string, password: string, role: string) =>
  request<{ ok: boolean; id: number }>('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password, role }),
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
}

export const fetchConfig = () =>
  request<SyncConfig>('/api/admin/config');

export const updateConfig = (data: Record<string, string>) =>
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
