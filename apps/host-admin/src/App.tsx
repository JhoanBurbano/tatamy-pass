import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, ago, canChangeHost, getHostUrl, loadToken, setHostUrl, setToken } from './api.js';
import { Field, ToastProvider, errorText, usePoll } from './ui.jsx';
import { Puertas } from './pages/Puertas.jsx';
import { Credenciales } from './pages/Credenciales.jsx';
import { Impresion } from './pages/Impresion.jsx';
import { Dispositivos } from './pages/Dispositivos.jsx';
import { Alertas } from './pages/Alertas.jsx';
import { Evento } from './pages/Evento.jsx';
import { Auditoria } from './pages/Auditoria.jsx';
import { Sistema } from './pages/Sistema.jsx';
import { Usuarios } from './pages/Usuarios.jsx';
import { Inscripciones } from './pages/Inscripciones.jsx';
import { Nube } from './pages/Nube.jsx';
import { Radio } from './pages/Radio.jsx';

export type Role = 'ADMIN' | 'COORDINATOR' | 'PRINTER' | 'REGISTRAR' | 'CONTROL' | 'SUPERVISOR' | 'AUDITOR';
export interface Session { token: string; user: { id: string; username: string; role: Role }; mode: 'primary' | 'standby' }

/**
 * Páginas y quién las ve (§6 de 00-DECISIONES): admin todo; coord todo menos usuarios;
 * print impresión + inscripciones pendientes + credenciales; super puertas, credenciales,
 * dispositivos y alertas; audit solo lectura. El host aplica lo mismo en cada endpoint.
 */
export const PAGES: Array<{ id: string; label: string; ico: string; roles: Role[]; render: (s: Session) => ReactNode }> = [
  { id: 'puertas', label: 'Puertas en vivo', ico: '▣', roles: ['ADMIN', 'COORDINATOR', 'SUPERVISOR', 'AUDITOR'], render: (s) => <Puertas session={s} /> },
  { id: 'credenciales', label: 'Credenciales', ico: '☷', roles: ['ADMIN', 'COORDINATOR', 'PRINTER', 'SUPERVISOR', 'AUDITOR'], render: (s) => <Credenciales session={s} /> },
  { id: 'inscripciones', label: 'Inscripciones', ico: '✎', roles: ['ADMIN', 'COORDINATOR', 'PRINTER', 'SUPERVISOR', 'AUDITOR'], render: (s) => <Inscripciones session={s} /> },
  { id: 'impresion', label: 'Impresión', ico: '⎙', roles: ['ADMIN', 'COORDINATOR', 'PRINTER', 'AUDITOR'], render: (s) => <Impresion session={s} /> },
  { id: 'dispositivos', label: 'Dispositivos', ico: '▭', roles: ['ADMIN', 'COORDINATOR', 'SUPERVISOR', 'AUDITOR'], render: (s) => <Dispositivos session={s} /> },
  { id: 'alertas', label: 'Alertas', ico: '⚠', roles: ['ADMIN', 'COORDINATOR', 'SUPERVISOR', 'AUDITOR'], render: (s) => <Alertas session={s} /> },
  { id: 'radio', label: 'Radio', ico: '📻', roles: ['ADMIN', 'COORDINATOR', 'SUPERVISOR'], render: (s) => <Radio session={s} /> },
  { id: 'evento', label: 'Evento y roles', ico: '⚙', roles: ['ADMIN', 'COORDINATOR'], render: (s) => <Evento session={s} /> },
  { id: 'nube', label: 'Nube', ico: '☁', roles: ['ADMIN', 'COORDINATOR', 'PRINTER', 'AUDITOR'], render: (s) => <Nube session={s} /> },
  { id: 'auditoria', label: 'Auditoría', ico: '≡', roles: ['ADMIN', 'COORDINATOR', 'AUDITOR'], render: (s) => <Auditoria session={s} /> },
  { id: 'sistema', label: 'Sistema', ico: '♥', roles: ['ADMIN', 'COORDINATOR', 'AUDITOR'], render: (s) => <Sistema session={s} /> },
  { id: 'usuarios', label: 'Usuarios', ico: '☺', roles: ['ADMIN'], render: (s) => <Usuarios session={s} /> }
];

export const isReadOnly = (role: Role) => role === 'AUDITOR';

function useHash(): [string, (h: string) => void] {
  const [hash, set] = useState(() => window.location.hash.replace(/^#\/?/, ''));
  useEffect(() => {
    const on = () => set(window.location.hash.replace(/^#\/?/, ''));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [hash, (h) => { window.location.hash = `/${h}`; }];
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState(getHostUrl());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try {
      if (canChangeHost) setHostUrl(host);
      const s = await api<Session>('/auth/login', { method: 'POST', body: { username, password } });
      setToken(s.token);
      onLogin(s);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0 ? 'No encuentro el computador central. Revisa la dirección y la Wi-Fi de staff.' : errorText(err));
    } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ color: 'var(--fg)', padding: 0 }}><span className="mark" />Tatami Pass</div>
        <div>
          <h1>Panel del host</h1>
          <p className="muted small">Entra con tu usuario del evento.</p>
        </div>
        {canChangeHost && (
          <Field label="Dirección del computador central" hint="En producción el panel se abre desde el propio host (/admin) y este campo no aparece.">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="http://192.168.10.2:8787" />
          </Field>
        )}
        <Field label="Usuario"><input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Contraseña"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="btn pri" disabled={busy || !username || !password}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

interface Health { ok: boolean; mode: 'primary' | 'standby'; lagSeconds: number | null; time: string; lastBackupAt: string | null; devices: number; radio?: number; standby?: { message: string; online: boolean | null } }

function Shell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const pages = PAGES.filter((p) => p.roles.includes(session.user.role));
  const [hash, go] = useHash();
  const current = pages.find((p) => p.id === hash) ?? pages[0];
  const health = usePoll((signal) => api<Health>('/health', { signal }), 10_000);
  const cloud = usePoll((signal) => api<{ configured: boolean; lastCloudSyncAt: string | null; online: boolean | null }>('/sync/cloud/status', { signal }), 30_000);
  const h = health.data;
  const mode = h?.mode ?? session.mode;
  useEffect(() => { if (pages.length && (!hash || !pages.some((p) => p.id === hash))) go(pages[0].id); }, [hash, pages, go]);
  // Control de entradas e Inscriptor no tienen páginas en este panel: aviso claro en vez de una pantalla rota.
  if (!current) {
    return (
      <div className="login">
        <div className="card">
          <div className="brand" style={{ color: 'var(--fg)', padding: 0 }}><span className="mark" />Tatami Pass</div>
          <h1>Este usuario no tiene páginas en el panel</h1>
          <p className="muted small">Tu rol ({ROLE_SHORT[session.user.role]}) trabaja desde el scanner o desde la nube, no desde este panel. Si crees que es un error, pide al Administrador que revise tu rol.</p>
          <button className="btn" onClick={onLogout}>Salir</button>
        </div>
      </div>
    );
  }
  const backupTone = !h?.lastBackupAt ? 'warn' : Date.now() - Date.parse(h.lastBackupAt) > 10 * 60_000 ? 'bad' : Date.now() - Date.parse(h.lastBackupAt) > 6 * 60_000 ? 'warn' : 'ok';
  return (
    <div className="shell">
      <aside className="sb">
        <div className="brand"><span className="mark" />Tatami Pass</div>
        {pages.map((p) => (
          <a key={p.id} href={`#/${p.id}`} className={p.id === current.id ? 'on' : ''} aria-current={p.id === current.id ? 'page' : undefined}>
            <span className="ico" aria-hidden>{p.ico}</span>{p.label}
          </a>
        ))}
        <div className="st">
          <div><span className={`dot ${health.error ? 'bad' : 'ok'}`} />{health.error ? 'Sin conexión con el computador central' : mode === 'standby' ? <b>Equipo de respaldo</b> : <b>Equipo principal</b>}</div>
          {mode === 'standby' && h?.standby && <div><span className={`dot ${h.standby.online ? 'ok' : 'bad'}`} />{h.standby.message}</div>}
          <div><span className={`dot ${backupTone}`} />Copia de seguridad: {h?.lastBackupAt ? ago(h.lastBackupAt) : 'todavía ninguna'}</div>
          <div><span className={`dot ${h?.radio ? 'ok' : ''}`} />Radio: {h ? `${h.radio ?? 0} ${h.radio === 1 ? 'equipo conectado' : 'equipos conectados'}` : '—'}</div>
          <div><span className={`dot ${cloud.data?.configured ? (cloud.data.online === false ? 'warn' : 'ok') : ''}`} />Nube: {cloud.data?.configured ? (cloud.data.lastCloudSyncAt ? `actualizada ${ago(cloud.data.lastCloudSyncAt)}` : 'sin actualizar') : 'no configurada'}</div>
          <div className="user"><span><b>{session.user.username}</b> · {ROLE_SHORT[session.user.role]}</span><button onClick={onLogout} aria-label="Cerrar sesión">Salir</button></div>
        </div>
      </aside>
      <main className="main">
        {mode === 'standby' && (
          <div className="standby-banner">
            <span>Este es el equipo de respaldo. Aquí solo se consulta; los cambios se hacen en el principal.</span>
            {session.user.role === 'ADMIN' && <a href="#/sistema" className="btn sm">Ir a Sistema para promoverlo</a>}
          </div>
        )}
        <div key={current.id} className="page">{current.render(session)}</div>
      </main>
    </div>
  );
}

const ROLE_SHORT: Record<Role, string> = { ADMIN: 'Administrador', COORDINATOR: 'Coordinador', PRINTER: 'Impresión', REGISTRAR: 'Inscriptor', CONTROL: 'Control', SUPERVISOR: 'Supervisor', AUDITOR: 'Auditor' };

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const t = loadToken();
    if (!t) { setSession(null); return; }
    api<{ user: Session['user']; mode: Session['mode'] }>('/auth/me').then((r) => setSession({ token: t, user: r.user, mode: r.mode })).catch(() => { setToken(null); setSession(null); });
    const onLogout = () => setSession(null);
    window.addEventListener('tp:logout', onLogout);
    return () => window.removeEventListener('tp:logout', onLogout);
  }, []);
  if (session === undefined) return <div className="login"><p className="muted">Cargando…</p></div>;
  return (
    <ToastProvider>
      {session ? <Shell session={session} onLogout={() => { void api('/auth/logout', { method: 'POST' }).catch(() => undefined); setToken(null); setSession(null); }} /> : <Login onLogin={setSession} />}
    </ToastProvider>
  );
}
