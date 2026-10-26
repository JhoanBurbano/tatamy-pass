import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api.js';

// ---------- toasts ----------

interface Toast { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<{ toast: (text: string, kind?: Toast['kind']) => void }>({ toast: () => undefined });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, kind }]);
    if (kind === 'ok') setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            {t.kind === 'error' && <button className="x" aria-label="Cerrar" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>×</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message ?? 'Algo salió mal. Inténtalo de nuevo.';
}

// ---------- polling ----------

export function usePoll<T>(fn: (signal: AbortSignal) => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const d = await fnRef.current(ctrl.signal);
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive && (e as Error).name !== 'AbortError') setError(errorText(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    const t = intervalMs > 0 ? setInterval(run, intervalMs) : undefined;
    return () => { alive = false; ctrl.abort(); if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tick, ...deps]);
  return { data, error, loading, refresh: () => setTick((x) => x + 1) };
}

// ---------- piezas ----------

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="hd">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      {right && <div className="hd-right">{right}</div>}
    </div>
  );
}

export function Kpi({ label, value, small, tone }: { label: string; value: ReactNode; small?: ReactNode; tone?: 'warn' | 'bad' | 'ok' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      {small && <small>{small}</small>}
    </div>
  );
}

export function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'off' | 'info'; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || right) && <header className="card-h"><h3>{title}</h3>{right}</header>}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner({ text = 'Cargando…' }: { text?: string }) {
  return <div className="muted small spinner">{text}</div>;
}

export function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="error-box" role="alert">{text}</div>;
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="hint error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/** Diálogo de confirmación, opcionalmente con nota o palabra de confirmación. */
export function Confirm({ open, title, body, confirmLabel = 'Confirmar', danger, onCancel, onConfirm, requireText, placeholder, withNote, busy }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; onCancel: () => void;
  onConfirm: (note: string) => void | Promise<void>; requireText?: string; placeholder?: string; withNote?: boolean; busy?: boolean;
}) {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(''); }, [open]);
  if (!open) return null;
  const ok = requireText ? text.trim() === requireText : withNote ? text.trim().length > 0 : true;
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="modal-title">{title}</h3>
        {body && <div className="modal-body">{body}</div>}
        {requireText && (
          <Field label={`Escribe ${requireText} para confirmar`}>
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={requireText} />
          </Field>
        )}
        {withNote && (
          <Field label="Nota">
            <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? 'Qué pasó y qué se decidió'} />
          </Field>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className={`btn ${danger ? 'danger' : 'pri'}`} disabled={!ok || busy} onClick={() => void onConfirm(text.trim())}>{busy ? 'Un momento…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export const ROLE_NAMES: Record<string, string> = {
  ADMIN: 'Administrador', COORDINATOR: 'Coordinador de acreditación', PRINTER: 'Operador de impresión', REGISTRAR: 'Inscriptor (club)',
  CONTROL: 'Control de entradas', SUPERVISOR: 'Supervisor de puerta', AUDITOR: 'Auditor'
};

export const STATUS_NAMES: Record<string, string> = { ISSUED: 'Emitida', PRINTED: 'Impresa', DELIVERED: 'Entregada', REVOKED: 'Anulada' };
export const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'off' | 'info'> = { ISSUED: 'info', PRINTED: 'warn', DELIVERED: 'ok', REVOKED: 'bad' };

export const REASON_NAMES: Record<string, string> = {
  OK: 'Entrada', OK_PHOTO_CHECK: 'Entrada (revisar foto)', OK_EXIT: 'Salida', OK_MANUAL: 'Ingreso manual', MALFORMED: 'Código ilegible', BAD_SIGNATURE: 'Firma inválida',
  UNKNOWN_KEY: 'Clave desconocida', WRONG_EVENT: 'Otro evento', UNKNOWN_CREDENTIAL: 'No está en la lista', REVOKED: 'Anulada', OLD_VERSION: 'Hay una más nueva',
  NOT_YET_VALID: 'Todavía no vale', EXPIRED: 'Vencida', DAY_NOT_ALLOWED: 'No es de hoy', ZONE_NOT_ALLOWED: 'No vale para la zona', DIGITAL_NOT_ALLOWED: 'No admite digital',
  DIGITAL_TOKEN_EXPIRED: 'Código digital vencido', ANTI_PASSBACK: 'Ya había entrado', DUPLICATE: 'Se usó en otra puerta', NOT_INSIDE: 'No estaba dentro'
};
