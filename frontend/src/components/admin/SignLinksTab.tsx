import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, Copy, ExternalLink, RefreshCcw, ClipboardCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Spinner } from '../Spinner';

/**
 * Admin tab — manage public driver-signing links.
 *
 * Two flows are exposed:
 *   1. Create a new link from a JSON `payload` (the engine PdfReport).
 *      The dispatcher pastes/uploads the JSON or, in the wired-up flow,
 *      the analysis page pre-fills it via a "Send to driver" button.
 *   2. List all existing links, with status (pending/signed/expired) and
 *      Dropbox path of the signed PDF.
 *
 * Backend endpoints used:
 *   POST /api/admin/sign-links          — create
 *   GET  /api/admin/sign-links?status=  — list
 */

interface LinkRow {
  token: string;
  driver_card: string;
  driver_name: string;
  locale: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  status: 'pending' | 'signed' | 'expired';
  pdf_dropbox_path: string | null;
  created_by: string;
}

const FILTERS: ('all' | 'pending' | 'signed' | 'expired')[] = ['all', 'pending', 'signed', 'expired'];

export function SignLinksTab() {
  const [items, setItems] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'signed' | 'expired'>('all');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/admin/sign-links${qs}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setItems(body.items ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <TestLinkPanel onCreated={refresh} />
      <CreateForm onCreated={refresh} />

      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold tracking-tight">Versendete Links</h3>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
            >
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {f === 'all' ? 'Alle' : f === 'pending' ? 'Offen' : f === 'signed' ? 'Signiert' : 'Abgelaufen'}
                </option>
              ))}
            </select>
            <button
              onClick={refresh}
              className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            >
              <RefreshCcw size={14} />
              Aktualisieren
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Spinner size="md" />
          </div>
        ) : (
          <LinksTable items={items} onChanged={refresh} />
        )}
      </div>
    </div>
  );
}

/**
 * One-click test link generator.
 *
 * Hits POST /api/admin/sign-links/test which seeds 6 synthetic violations
 * across the driver-facing categories. Useful for QA after deploys + for
 * showing the sign flow to non-technical stakeholders without burning
 * real driver data.
 */
function TestLinkPanel({ onCreated }: { onCreated: () => void }) {
  const [driverName, setDriverName] = useState('Hans Mustermann');
  const [locale, setLocale] = useState<'de' | 'en' | 'pl'>('de');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ url: string; expires_at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    setCreated(null);
    setCreating(true);
    try {
      const res = await fetch('/api/admin/sign-links/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_name: driverName.trim() || undefined, locale }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setCreated({ url: body.url, expires_at: body.expires_at });
      onCreated();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl border border-emerald-200/30 bg-emerald-50/40 p-5 dark:border-emerald-700/30 dark:bg-emerald-900/10">
      <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <CheckCircle2 size={18} className="text-emerald-600" /> Test-Link erzeugen
      </h3>
      <p className="mt-1 text-sm text-muted">
        Generiert eine Sign-URL mit 6 vorgefertigten Verstößen — kein DDD,
        kein Engine-Aufruf, keine echten Fahrerdaten. Ideal zum Prüfen der
        Signatur-Seite + des PDF-Layouts.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1.5 block text-xs font-medium text-muted">Test-Name</span>
          <input
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            className="h-10 w-64 rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-xs font-medium text-muted">Sprache</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'de' | 'en' | 'pl')}
            className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-white/5"
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
            <option value="pl">Polski</option>
          </select>
        </label>
        <button
          onClick={onClick}
          disabled={creating}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {creating ? <Spinner size="sm" /> : <Send size={14} />}
          Test-Link erzeugen
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}
      {created && (
        <div className="mt-3 rounded-lg bg-white p-3 text-sm dark:bg-black/30">
          <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={16} /> Test-Link erstellt
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
              {created.url}
            </code>
            <CopyButton text={created.url} />
            <a
              href={created.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#0071e3] px-3 text-sm font-medium text-white transition hover:bg-[#0077ed]"
            >
              <ExternalLink size={14} />
              Öffnen
            </a>
          </div>
          <div className="mt-1 text-xs text-muted">Gültig bis {new Date(created.expires_at).toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [driverCard, setDriverCard] = useState('');
  const [driverName, setDriverName] = useState('');
  const [locale, setLocale] = useState<'de' | 'en' | 'pl'>('de');
  const [payloadStr, setPayloadStr] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expires_at: string } | null>(null);

  const onSubmit = async () => {
    setError(null);
    setCreated(null);
    let payload: unknown;
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      setError(`Ungültiges JSON: ${e}`);
      return;
    }
    if (typeof payload !== 'object' || payload === null) {
      setError('payload muss ein Objekt sein (PdfReport vom Engine).');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/sign-links', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_card: driverCard.trim(),
          driver_name: driverName.trim(),
          locale,
          payload,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setCreated({ url: body.url, expires_at: body.expires_at });
      onCreated();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-5">
      <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Send size={18} /> Neuen Signatur-Link erstellen
      </h3>
      <p className="mt-1 text-sm text-muted">
        JSON-Payload: <code>EvaluationResult.report(locale)</code> aus dem Compliance-Engine.
        Den fügst du als Ganzes in das Textfeld ein.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          value={driverCard}
          onChange={(e) => setDriverCard(e.target.value)}
          placeholder="Karten-Nr."
          className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-white/5"
        />
        <input
          value={driverName}
          onChange={(e) => setDriverName(e.target.value)}
          placeholder="Fahrername"
          className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-white/5"
        />
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'de' | 'en' | 'pl')}
          className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-white/5"
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
          <option value="pl">Polski</option>
        </select>
      </div>
      <textarea
        value={payloadStr}
        onChange={(e) => setPayloadStr(e.target.value)}
        rows={6}
        placeholder='{"locale":"de","sections":[...],"summary":{...}}'
        className="mt-3 w-full rounded-lg border border-black/10 bg-white p-3 font-mono text-xs dark:border-white/10 dark:bg-white/5"
      />
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}
      {created && (
        <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm dark:bg-green-900/20">
          <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-300">
            <CheckCircle2 size={16} /> Link erstellt
          </div>
          <div className="mt-1 flex items-center gap-2">
            <code className="truncate rounded bg-white px-2 py-1 text-xs dark:bg-black/30">{created.url}</code>
            <CopyButton text={created.url} />
          </div>
          <div className="mt-1 text-xs text-muted">Gültig bis {new Date(created.expires_at).toLocaleString()}</div>
        </div>
      )}
      <button
        onClick={onSubmit}
        disabled={creating || !driverCard.trim() || !payloadStr.trim()}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#0071e3] px-5 text-sm font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-60"
      >
        {creating ? <Spinner size="sm" /> : <Send size={14} />}
        Link erstellen
      </button>
    </div>
  );
}

function LinksTable({ items, onChanged: _onChanged }: { items: LinkRow[]; onChanged: () => void }) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [items],
  );

  if (sorted.length === 0) {
    return <div className="py-10 text-center text-sm text-muted">Noch keine Links versendet.</div>;
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr className="border-b border-black/5 dark:border-white/10">
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Fahrer</th>
            <th className="py-2 pr-3">Erstellt</th>
            <th className="py-2 pr-3">Gültig bis</th>
            <th className="py-2 pr-3">Signiert</th>
            <th className="py-2 pr-3">Dropbox</th>
            <th className="py-2 pr-3">Link</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.token} className="border-b border-black/5 dark:border-white/5">
              <td className="py-2 pr-3">
                <StatusPill status={row.status} />
              </td>
              <td className="py-2 pr-3">
                <div className="font-medium">{row.driver_name || '—'}</div>
                <div className="text-xs text-muted">{row.driver_card}</div>
              </td>
              <td className="py-2 pr-3 text-xs">{new Date(row.created_at).toLocaleString()}</td>
              <td className="py-2 pr-3 text-xs">{new Date(row.expires_at).toLocaleString()}</td>
              <td className="py-2 pr-3 text-xs">
                {row.used_at ? new Date(row.used_at).toLocaleString() : '—'}
              </td>
              <td className="py-2 pr-3 text-xs">
                {row.pdf_dropbox_path ? (
                  <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
                    {row.pdf_dropbox_path}
                  </code>
                ) : (
                  '—'
                )}
              </td>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-1">
                  <CopyButton text={`${window.location.origin}/sign/${row.token}`} compact />
                  <a
                    href={`/sign/${row.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10"
                    title="Im Browser öffnen"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: LinkRow['status'] }) {
  if (status === 'signed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
        <CheckCircle2 size={12} /> Signiert
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-white/10 dark:text-gray-300">
        Abgelaufen
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <AlertTriangle size={12} /> Offen
    </span>
  );
}

function CopyButton({ text, compact = false }: { text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };
  if (compact) {
    return (
      <button
        onClick={onClick}
        className="rounded-md p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10"
        title="Link kopieren"
      >
        {copied ? <ClipboardCheck size={14} className="text-green-600" /> : <Copy size={14} />}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-black/10 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
    >
      {copied ? <ClipboardCheck size={12} className="text-green-600" /> : <Copy size={12} />}
      {copied ? 'Kopiert' : 'Kopieren'}
    </button>
  );
}
