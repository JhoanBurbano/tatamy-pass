/**
 * Cliente de la API del host. En producción el panel se sirve desde el propio
 * host (/admin) y habla con el mismo origen; en desarrollo (vite) apunta a la
 * dirección guardada en la pantalla de acceso (por defecto http://localhost:8787).
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: Array<{ path: string; message: string }>, public body?: unknown) {
    super(message);
  }
}

const servedByHost = window.location.pathname.startsWith('/admin');

export function getHostUrl(): string {
  if (servedByHost) return '';
  try { return localStorage.getItem('tp.panel.host') ?? 'http://localhost:8787'; } catch { return 'http://localhost:8787'; }
}
export function setHostUrl(url: string): void {
  try { localStorage.setItem('tp.panel.host', url.replace(/\/$/, '')); } catch { /* sin almacenamiento */ }
}
export const canChangeHost = !servedByHost;

let token: string | null = null;
export function setToken(t: string | null): void {
  token = t;
  try { if (t) sessionStorage.setItem('tp.panel.token', t); else sessionStorage.removeItem('tp.panel.token'); } catch { /* nada */ }
}
export function loadToken(): string | null {
  try { token = sessionStorage.getItem('tp.panel.token'); } catch { token = null; }
  return token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(path: string, opts: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${getHostUrl()}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Sin conexión con el computador central. Reintentando…');
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const d = data as { error?: string; errors?: Array<{ path: string; message: string }> } | null;
    if (res.status === 401 && token) { setToken(null); window.dispatchEvent(new Event('tp:logout')); }
    throw new ApiError(res.status, d?.error ?? `Error ${res.status}`, d?.errors, data);
  }
  return data as T;
}

/** Descarga un archivo autenticado (PDF, CSV, JSON) sin exponer el token en la URL. */
export async function download(path: string, filename: string, opts: { open?: boolean } = {}): Promise<{ sha256?: string }> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${getHostUrl()}${path}`, { headers });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* nada */ }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (opts.open) window.open(url, '_blank', 'noopener');
  else {
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { sha256: res.headers.get('x-content-sha256') ?? undefined };
}

// ---- formato ----

const dtf = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const dtfFull = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dtf.format(new Date(iso));
}
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dtfFull.format(new Date(iso));
}
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
/** "en 40 s" / "en 4 min" para instantes futuros (pasados → "ahora"). */
export function until(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (s <= 0) return 'ahora';
  if (s < 60) return `en ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `en ${m} min`;
  return `en ${Math.round(m / 60)} h`;
}
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('es-CO');
}
export function bytes(n: number | null | undefined): string {
  if (!n && n !== 0) return '—';
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

/** POST autenticado que devuelve un archivo (p. ej. la vista previa PDF de la credencial) como Blob. */
export async function apiBlob(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${getHostUrl()}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    let errors: Array<{ path: string; message: string }> | undefined;
    try { const d = (await res.json()) as { error?: string; errors?: Array<{ path: string; message: string }> }; msg = d.error ?? msg; errors = d.errors; } catch { /* nada */ }
    throw new ApiError(res.status, msg, errors);
  }
  return res.blob();
}
