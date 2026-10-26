import { useEffect, useState } from 'react';
import { ApiError, api, ago, dateTime, num } from '../api.js';
import { Card, Empty, ErrorBox, Field, PageHead, Spinner, Tag, errorText, usePoll, useToast } from '../ui.jsx';
import { CredentialDetail } from './Credenciales.jsx';
import type { Session } from '../App.jsx';

interface Cred { id: string; displayName: string; club?: string; roleCode: string; categoryCode?: string; companionOf?: string | null; issuedAt: string; status: string }
interface Pending { items: Cred[]; total: number; byRole: Record<string, number>; cloud: { configured: boolean; lastCloudSyncAt: string | null; online: boolean | null } }
interface Config { roles: Array<{ code: string; name: string; color: string; capacity: number | null }>; zones: Array<{ code: string; name: string }>; ageCategories: Array<{ code: string; name: string; minAge: number; maxAge: number | null }>; startDate: string }
type Errors = Array<{ path: string; message: string }>;

const EMPTY = { firstName: '', lastName: '', roleCode: 'PRESS', birthDate: '', documentNumber: '', club: '', categoryCode: '', guardianName: '', guardianDocument: '', companionOf: '', relationship: '', note: '' };

export function Inscripciones({ session }: { session: Session }) {
  const { toast } = useToast();
  const role = session.user.role;
  const canIssue = ['ADMIN', 'COORDINATOR'].includes(role) && session.mode !== 'standby';
  const canPrint = ['ADMIN', 'COORDINATOR', 'PRINTER'].includes(role) && session.mode !== 'standby';
  const pending = usePoll((signal) => api<Pending>('/registrations/pending?limit=100', { signal }), 15_000);
  const [config, setConfig] = useState<Config | null>(null);
  const [issued, setIssued] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState<Errors>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [last, setLast] = useState<Cred | null>(null);

  useEffect(() => { api<{ config: Config; issuedByRole: Record<string, number> }>('/config').then((r) => { setConfig(r.config); setIssued(r.issuedByRole); }).catch(() => undefined); }, [last]);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const err = (path: string) => errors.find((e) => e.path === path)?.message;
  const roleOf = (code: string) => config?.roles.find((r) => r.code === code);
  const age = form.birthDate && config ? Math.floor((Date.parse(config.startDate) - Date.parse(form.birthDate)) / (365.25 * 86_400_000)) : null;
  const isMinor = age !== null && age >= 0 && age < 18;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('issue'); setErrors([]);
    try {
      const body = {
        firstName: form.firstName, lastName: form.lastName, roleCode: form.roleCode, birthDate: form.birthDate || undefined, documentNumber: form.documentNumber || undefined,
        club: form.club || undefined, categoryCode: form.categoryCode || undefined, companionOf: form.companionOf || undefined, relationship: form.relationship || undefined, note: form.note || undefined,
        guardian: form.guardianName ? { name: form.guardianName, document: form.guardianDocument } : undefined
      };
      const r = await api<{ credential: Cred; message: string }>('/credentials/issue', { method: 'POST', body });
      toast(r.message);
      setLast(r.credential); setSelected(r.credential.id);
      setForm({ ...EMPTY, roleCode: form.roleCode, club: form.club });
      pending.refresh();
    } catch (ex) {
      if (ex instanceof ApiError && ex.errors?.length) setErrors(ex.errors);
      toast(errorText(ex), 'error');
    } finally { setBusy(null); }
  };
  const printPending = async () => {
    if (!pending.data) return;
    setBusy('print');
    try {
      const ids = pending.data.items.map((c) => c.id);
      const b = await api<{ id: string; count: number }>('/print/batches', { method: 'POST', body: { ids } });
      toast(`Lote ${b.id} creado con ${b.count} credenciales. Descárgalo en Impresión.`);
      window.location.hash = '/impresion';
    } catch (ex) { toast(errorText(ex), 'error'); } finally { setBusy(null); }
  };
  const p = pending.data;

  return (
    <>
      <PageHead title="Inscripciones" sub="Lo que la nube trajo y aún no se imprime, y la emisión en sitio para quien llega sin acreditar." />
      <ErrorBox text={pending.error} />
      <div className={canIssue ? 'grid-2' : ''} style={canIssue ? { gridTemplateColumns: 'minmax(0,1fr) 400px' } : undefined}>
        <div className="stack">
          <Card className="flush" title={p ? (p.total === 0 ? 'Nada pendiente de imprimir' : `${num(p.total)} credenciales de la nube sin imprimir`) : 'Pendientes de credencial'}
            right={p && p.total > 0 && canPrint ? <button className="btn sm pri" disabled={busy === 'print'} onClick={() => void printPending()}>{busy === 'print' ? 'Creando…' : `Crear lote con ${Math.min(p.total, 100)}`}</button> : undefined}>
            {p && (
              <div className="muted small" style={{ padding: '0 18px' }}>
                {p.cloud.configured ? <>Nube {p.cloud.online === false ? <Tag tone="warn">sin conexión</Tag> : <Tag tone="ok">conectada</Tag>} · última actualización {p.cloud.lastCloudSyncAt ? ago(p.cloud.lastCloudSyncAt) : 'nunca'} · <a href="#/nube">traer ahora</a></> : <>Sin nube configurada: aquí solo verás lo que se emita en sitio. <a href="#/nube">Ver cómo configurarla</a>.</>}
                {p.total > 0 && <> · {Object.entries(p.byRole).map(([r, n]) => `${roleOf(r)?.name ?? r}: ${n}`).join(' · ')}</>}
              </div>
            )}
            <div className="tbl">
              {pending.loading && !p ? <Spinner /> : p && p.items.length === 0 ? <Empty>Todo lo que llegó de la nube ya está impreso o entregado. Cuando llegue algo nuevo aparecerá aquí.</Empty> : (
                <table>
                  <thead><tr><th>ID corto</th><th>Nombre</th><th>Rol</th><th>Club</th><th>Llegó</th></tr></thead>
                  <tbody>{p?.items.map((c) => (
                    <tr key={c.id} className="click" onClick={() => setSelected(c.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(c.id); }}>
                      <td className="mono">{c.id}</td><td style={{ fontWeight: 600 }}>{c.displayName}</td>
                      <td><span className="role-dot" style={{ background: roleOf(c.roleCode)?.color ?? '#64748B' }} />{roleOf(c.roleCode)?.name ?? c.roleCode}</td>
                      <td className="muted">{c.club ?? '—'}</td><td>{dateTime(c.issuedAt)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </Card>
          {selected && <CredentialDetail id={selected} role={role} ro={role === 'AUDITOR'} config={config} onClose={() => setSelected(null)} onChanged={() => pending.refresh()} toast={toast} />}
        </div>

        {canIssue && (
          <Card title="Emitir en sitio">
            <p className="muted small">Para quien llega sin inscripción (prensa, staff de última hora, un acompañante). Crea la persona y su credencial; luego imprímela desde la ficha.</p>
            <form onSubmit={submit} className="stack" style={{ gap: 10 }}>
              <div className="row">
                <Field label="Nombre" error={err('firstName')}><input value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete="off" /></Field>
                <Field label="Apellido" error={err('lastName')}><input value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="off" /></Field>
              </div>
              <Field label="Rol de acceso" error={err('roleCode')}>
                <select value={form.roleCode} onChange={(e) => set({ roleCode: e.target.value, categoryCode: '' })}>
                  {config?.roles.filter((r) => r.code !== 'ACOMP').map((r) => <option key={r.code} value={r.code}>{r.name}{r.capacity !== null ? ` (${num(issued[r.code] ?? 0)} de ${num(r.capacity)})` : ''}</option>)}
                </select>
              </Field>
              <div className="row">
                <Field label="Documento" hint="Opcional. Evita duplicados." error={err('documentNumber')}><input value={form.documentNumber} onChange={(e) => set({ documentNumber: e.target.value })} inputMode="numeric" /></Field>
                <Field label="Club / medio" error={err('club')}><input value={form.club} onChange={(e) => set({ club: e.target.value })} /></Field>
              </div>
              <div className="row">
                <Field label={form.roleCode === 'COMP' ? 'Fecha de nacimiento' : 'Fecha de nacimiento (opcional)'} error={err('birthDate')}><input type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} /></Field>
                {form.roleCode === 'COMP' && (
                  <Field label="Categoría" hint="Si la dejas vacía se calcula por edad." error={err('categoryCode')}>
                    <select value={form.categoryCode} onChange={(e) => set({ categoryCode: e.target.value })}><option value="">Automática</option>{config?.ageCategories.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.minAge}{c.maxAge !== null ? `–${c.maxAge}` : '+'})</option>)}</select>
                  </Field>
                )}
              </div>
              {isMinor && (
                <div className="row">
                  <Field label="Acudiente (menor de edad)" error={err('guardian')}><input value={form.guardianName} onChange={(e) => set({ guardianName: e.target.value })} placeholder="Nombre" /></Field>
                  <Field label="Documento del acudiente"><input value={form.guardianDocument} onChange={(e) => set({ guardianDocument: e.target.value })} inputMode="numeric" /></Field>
                </div>
              )}
              <details>
                <summary className="small muted" style={{ cursor: 'pointer' }}>Es acompañante de un participante</summary>
                <div className="row" style={{ marginTop: 8 }}>
                  <Field label="ID corto del participante" error={err('companionOf')} hint="Entra a Gradería con rol Acompañante."><input value={form.companionOf} onChange={(e) => set({ companionOf: e.target.value.toUpperCase() })} placeholder="TP-2026-00123-C" /></Field>
                  <Field label="Parentesco"><input value={form.relationship} onChange={(e) => set({ relationship: e.target.value })} placeholder="Madre, padre…" /></Field>
                </div>
              </details>
              <Field label="Nota (queda en la auditoría)"><input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="Llegó sin acreditar, autorizó…" /></Field>
              <button className="btn pri" disabled={busy === 'issue' || !form.firstName.trim() || !form.lastName.trim()}>{busy === 'issue' ? 'Emitiendo…' : 'Emitir credencial'}</button>
              {last && <div className="ok-box">Última emitida: <b className="mono">{last.id}</b> · {last.displayName}. <button className="btn link" type="button" onClick={() => setSelected(last.id)}>Abrir ficha</button></div>}
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
