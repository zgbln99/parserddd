/**
 * Client for the LTS Card Bridge — the small program on the dispatcher's PC
 * that reads a driver card from a USB smart-card reader (see
 * backend/tools/card_bridge/README.md). It listens on localhost only.
 */

export const BRIDGE_URL = 'http://127.0.0.1:27182';
export const BRIDGE_DOWNLOAD_URL = '/api/reader/card-bridge/lts_card_bridge.py';
export const BRIDGE_README_URL = '/api/reader/card-bridge/README.md';
export const BRIDGE_EXE_URL = '/api/reader/card-bridge/LTS-CardBridge.exe';

export interface BridgeReader {
  name: string;
  card: boolean;
  atr: string;
  error?: string;
}

export interface BridgeStatus {
  ok: boolean;
  version: string;
  readers: BridgeReader[];
  card_present?: boolean;
  busy?: boolean;
  progress?: { step: string; count: number };
  error?: string;
}

export interface CardIdentification {
  card_number: string;
  member_state: number;
  surname: string;
  first_names: string;
  expiry: string;
}

export interface BridgeReadResult {
  ok: true;
  filename: string;
  size: number;
  generation: 1 | 2;
  reader: string;
  identification: Partial<CardIdentification>;
  data_b64: string;
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves to null when the bridge is not running. */
export async function bridgeStatus(): Promise<BridgeStatus | null> {
  try {
    return await fetchJson<BridgeStatus>(`${BRIDGE_URL}/status`, { method: 'GET' }, 1500);
  } catch {
    return null;
  }
}

/** Reads the card; a full Gen2 card takes up to a minute or two. */
export function bridgeRead(reader?: string): Promise<BridgeReadResult> {
  return fetchJson<BridgeReadResult>(`${BRIDGE_URL}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reader ? { reader } : {}),
  }, 180_000);
}

export function bridgeResultToFile(r: BridgeReadResult): File {
  const bin = atob(r.data_b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], r.filename, { type: 'application/octet-stream' });
}
