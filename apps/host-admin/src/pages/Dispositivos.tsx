import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, ago, dateTime } from '../api.js';
import { Card, Confirm, Empty, ErrorBox, Field, PageHead, Spinner, Tag, errorText, usePoll, useToast } from '../ui.jsx';
import { isReadOnly, type Session } from '../App.jsx';

interface Device { id: string; name: string; zone: string; role: 'CONTROL' | 'SUPERVISOR'; enrolledAt: string; lastSeq: number; lastSeenAt: string | null; pendingCount: number; disabledAt: string | null }
interface Enroll { token: string; expiresAt: string; hostUrl: string; qr: string }

export function Dispositivos({ session }: { session: Session }) {
  const { toast } = useToast();
  const canManage = !isReadOnly(session.user.role) && ['ADMIN', 'SUPERVISOR'].includes(session.user.role);
  const devices = usePoll((signal) => api<Device[]>('/devices', { signal }), 10_000);
  const [zones, setZones] = useState<Array<{ code: string; name: string }>>([]);
  const [name, setName] = useState('');
  const [zone, setZone] = useState('G');
  const [role, setRole] = useState<'CONTROL' | 'SUPERVISOR'>('CONTROL');
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [qr, setQr] = useState<string>('');
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDisable, setToDisable] = useState<Device | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { api<{ config: { zones: Array<{ code: string; name: string }> } }>('/config').then((r) => setZones(r.config.zones)).catch(() => undefined); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!enroll) return;
    QRCode.toDataURL(enroll.qr, { errorCorrectionLevel: 'M', margin: 1, width: 520 }).then(setQr).catch(() => setQr(''));
  }, [enroll]);
  useEffect(() => { if (enroll) setLeft(Math.max(0, Math.round((Date.parse(enroll.expiresAt) - now) / 1000))); }, [enroll, now]);

  const generate = async () => {
    setBusy('enroll');
    try { setEnroll(await api<Enroll>('/devices/enroll-token', { method: 'POST', body: { name: name.trim(), zone, role } })); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const setDevZone = async (d: Device, z: string) => {
    setBusy(d.id);
    try { await api(`/devices/${d.id}`, { method: 'PATCH', body: { zone: z } }); toast(`${d.name} ahora valida en ${zones.find((x) => x.code === z)?.name ?? z}.`); devices.refresh(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const toggle = async (d: Device, disabled: boolean) => {
    setBusy(d.id);
    try { await api(`/devices/${d.id}/disable`, { method: 'POST', body: { disabled } }); toast(disabled ? `${d.name} desactivado.` : `${d.name} activado de nuevo.`); setToDisable(null); devices.refresh(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const statusOf = (d: Device): { tone: 'ok' | 'warn' | 'bad' | 'off'; text: string } => {
    if (d.disabledAt) return { tone: 'bad', text: 'Desactivado' };
    if (!d.lastSeenAt) return { tone: 'off', text: 'Nunca se ha conectado' };
    const s = (now - Date.parse(d.lastSeenAt)) / 1000;
    if (s > 300) return { tone: 'off', text: `Sin conexión ${ago(d.lastSeenAt, now)}${d.pendingCount ? ` · ${d.pendingCount} pendientes por enviar` : ''}` };
    if (s > 60) return { tone: 'warn', text: `Sin reportar ${ago(d.lastSeenAt, now)}` };
    if (d.pendingCount > 0) return { tone: 'warn', text: `${d.pendingCount} pendientes por enviar` };
    return { tone: 'ok', text: 'Conectado' };
  };
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');

  return (
    <>
      <PageHead title="Dispositivos" sub="Scanners enrolados, zona en la que validan y su conexión. Un scanner sin conexión sigue validando solo; lo que guarde se envía cuando vuelva." />
      <ErrorBox text={devices.error} />
      <div className={canManage ? 'grid-2' : ''} style={canManage ? { gridTemplateColumns: 'minmax(0,1fr) 340px' } : undefined}>
        <Card className="flush" title="Scanners">
          <div className="tbl">
            {devices.loading && !devices.data ? <Spinner /> : devices.data?.length === 0 ? <Empty>No hay scanners enrolados. Enrola el primero desde aquí.</Empty> : (
              <table>
                <thead><tr><th>Nombre</th><th>Zona</th><th>Rol</th><th>Última conexión</th><th className="r">Pendientes</th><th>Estado</th>{canManage && <th></th>}</tr></thead>
                <tbody>
                  {devices.data?.map((d) => {
                    const st = statusOf(d);
                    return (
                      <tr key={d.id}>
                        <td><span className="door"><i className={st.tone === 'ok' ? '' : st.tone === 'warn' ? 'warn' : st.tone === 'bad' ? 'disabled' : 'off'} />{d.name}</span><div className="muted small mono">{d.id}</div></td>
                        <td>
                          {canManage && !d.disabledAt ? (
                            <select value={d.zone} disabled={busy === d.id} onChange={(e) => void setDevZone(d, e.target.value)} aria-label={`Zona de ${d.name}`}>
                              {zones.map((z) => <option key={z.code} value={z.code}>{z.name}</option>)}
                            </select>
                          ) : (zones.find((z) => z.code === d.zone)?.name ?? d.zone)}
                        </td>
                        <td>{d.role === 'SUPERVISOR' ? 'Supervisor' : 'Control'}</td>
                        <td>{d.lastSeenAt ? `${dateTime(d.lastSeenAt)} · ${ago(d.lastSeenAt, now)}` : 'nunca'}<div className="muted small">enrolado {dateTime(d.enrolledAt)}</div></td>
                        <td className="r">{d.pendingCount}</td>
                        <td><Tag tone={st.tone}>{st.text}</Tag></td>
                        {canManage && (
                          <td className="r">
                            {d.disabledAt ? <button className="btn sm" disabled={busy === d.id} onClick={() => void toggle(d, false)}>Activar</button>
                              : <button className="btn sm danger" disabled={busy === d.id} onClick={() => setToDisable(d)}>Desactivar</button>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        {canManage && (
          <Card title="Enrolar un scanner">
            {!enroll ? (
              <>
                <Field label="Nombre de la puerta" hint="Como lo verás en Puertas en vivo."><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Puerta 4 · Tatamis" /></Field>
                <Field label="Zona"><select value={zone} onChange={(e) => setZone(e.target.value)}>{zones.map((z) => <option key={z.code} value={z.code}>{z.name}</option>)}</select></Field>
                <Field label="Rol del scanner"><select value={role} onChange={(e) => setRole(e.target.value as 'CONTROL' | 'SUPERVISOR')}><option value="CONTROL">Control de entradas</option><option value="SUPERVISOR">Supervisor (puede autorizar)</option></select></Field>
                <button className="btn pri" disabled={!name.trim() || busy === 'enroll'} onClick={() => void generate()}>Generar código</button>
              </>
            ) : (
              <>
                <div className="qr-box">
                  {qr ? <img src={qr} alt="Código QR de enrolamiento" /> : <Spinner text="Generando QR…" />}
                  <p style={{ fontWeight: 600 }}>{left > 0 ? `Escanea con el celular. Vence en ${mm}:${ss}.` : 'Este código venció. Genera otro.'}</p>
                  <p className="muted small" style={{ textAlign: 'center' }}>O escribe a mano en el scanner: dirección <code>{enroll.hostUrl}</code> y código <code>{enroll.token}</code>. Luego el portero elige su PIN de 6 dígitos.</p>
                </div>
                <div className="inline"><button className="btn" onClick={() => { setEnroll(null); setQr(''); }}>Listo</button><button className="btn" onClick={() => void generate()}>Generar otro</button></div>
              </>
            )}
          </Card>
        )}
      </div>
      <Confirm open={!!toDisable} danger title={`¿Desactivar ${toDisable?.name}?`} body="Dejará de enviar datos y el host rechazará sus conexiones. Lo que tenga guardado no se pierde." confirmLabel="Desactivar" busy={busy === toDisable?.id}
        onCancel={() => setToDisable(null)} onConfirm={() => { if (toDisable) return toggle(toDisable, true); }} />
    </>
  );
}
