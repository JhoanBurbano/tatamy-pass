import { useEffect, useState } from 'react';
import { api, dateTime } from '../api.js';
import { Card, Confirm, Empty, ErrorBox, Field, PageHead, ROLE_NAMES, Spinner, Tag, errorText, useToast } from '../ui.jsx';
import type { Role, Session } from '../App.jsx';

interface User { id: string; username: string; role: Role; club?: string; disabledAt: string | null; createdAt: string }

const ROLES: Role[] = ['ADMIN', 'COORDINATOR', 'PRINTER', 'SUPERVISOR', 'AUDITOR', 'REGISTRAR', 'CONTROL'];

export function Usuarios({ session }: { session: Session }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('COORDINATOR');
  const [club, setClub] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reset, setReset] = useState<User | null>(null);
  const [newPass, setNewPass] = useState('');
  const [toDisable, setToDisable] = useState<User | null>(null);

  const load = () => api<User[]>('/users').then((u) => { setUsers(u); setError(null); }).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    try { await api('/users', { method: 'POST', body: { username, password, role, club: club || undefined } }); toast(`Usuario ${username} creado.`); setUsername(''); setPassword(''); setClub(''); await load(); }
    catch (err) { toast(errorText(err), 'error'); } finally { setBusy(null); }
  };
  const toggle = async (u: User, disabled: boolean) => {
    setBusy(u.id);
    try { await api(`/users/${u.id}/disable`, { method: 'POST', body: { disabled } }); toast(disabled ? `${u.username} desactivado. Sus sesiones se cerraron.` : `${u.username} activado.`); setToDisable(null); await load(); }
    catch (err) { toast(errorText(err), 'error'); } finally { setBusy(null); }
  };
  const doReset = async () => {
    if (!reset) return;
    setBusy(reset.id);
    try { await api(`/users/${reset.id}/reset-password`, { method: 'POST', body: { password: newPass } }); toast(`Contraseña de ${reset.username} cambiada. Sus sesiones se cerraron.`); setReset(null); setNewPass(''); }
    catch (err) { toast(errorText(err), 'error'); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHead title="Usuarios" sub="Cuentas nominales del panel, una por persona. Nada de cuentas compartidas: la auditoría registra quién hizo cada cosa." />
      <ErrorBox text={error} />
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
        <Card className="flush" title="Cuentas">
          <div className="tbl">
            {!users ? <Spinner /> : users.length === 0 ? <Empty>No hay usuarios.</Empty> : (
              <table>
                <thead><tr><th>Usuario</th><th>Rol</th><th>Club</th><th>Creado</th><th>Estado</th><th></th></tr></thead>
                <tbody>{users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.username}{u.id === session.user.id && <span className="muted small"> (tú)</span>}</td>
                    <td>{ROLE_NAMES[u.role] ?? u.role}</td>
                    <td className="muted">{u.club ?? '—'}</td>
                    <td>{dateTime(u.createdAt)}</td>
                    <td>{u.disabledAt ? <Tag tone="bad">Desactivado</Tag> : <Tag tone="ok">Activo</Tag>}</td>
                    <td className="inline" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn sm" disabled={busy === u.id} onClick={() => { setReset(u); setNewPass(''); }}>Nueva contraseña</button>
                      {u.id !== session.user.id && (u.disabledAt
                        ? <button className="btn sm" disabled={busy === u.id} onClick={() => void toggle(u, false)}>Activar</button>
                        : <button className="btn sm danger" disabled={busy === u.id} onClick={() => setToDisable(u)}>Desactivar</button>)}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </Card>
        <Card title="Nuevo usuario">
          <form className="stack" onSubmit={create}>
            <Field label="Usuario" hint="Letras, números, punto o guion (3 a 32)."><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>
            <Field label="Contraseña" hint="Mínimo 8 caracteres."><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Rol"><select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select></Field>
            {role === 'REGISTRAR' && <Field label="Club"><input value={club} onChange={(e) => setClub(e.target.value)} /></Field>}
            <button className="btn pri" disabled={busy === 'create' || !username || password.length < 8}>Crear usuario</button>
          </form>
        </Card>
      </div>
      {reset && (
        <div className="modal-bg" onClick={() => setReset(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Nueva contraseña para {reset.username}</h3>
            <Field label="Contraseña" hint="Mínimo 8 caracteres. Sus sesiones abiertas se cerrarán."><input autoFocus type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} /></Field>
            <div className="modal-actions"><button className="btn" onClick={() => setReset(null)}>Cancelar</button><button className="btn pri" disabled={newPass.length < 8 || busy === reset.id} onClick={() => void doReset()}>Cambiar</button></div>
          </div>
        </div>
      )}
      <Confirm open={!!toDisable} danger title={`¿Desactivar a ${toDisable?.username}?`} body="No podrá entrar al panel y sus sesiones se cierran. Puedes activarlo de nuevo cuando quieras." confirmLabel="Desactivar" busy={busy === toDisable?.id}
        onCancel={() => setToDisable(null)} onConfirm={() => { if (toDisable) return toggle(toDisable, true); }} />
    </>
  );
}
