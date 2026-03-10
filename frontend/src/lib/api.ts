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
  request<{ ok: boolean }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

export const authLogout = () =>
  request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });

export const authStatus = () =>
  request<{ logged_in: boolean }>('/api/auth/status');

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

// Sync
export const fetchSyncStatus = () =>
  request<{ last_sync: string; synced_count: number }>('/api/sync/status');

export const fetchSyncLog = () =>
  request<{ history: import('../types').SyncHistoryEntry[] }>('/api/sync/log');

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
