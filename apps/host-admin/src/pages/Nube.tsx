import { useState } from 'react';
import { api, ago, dateTime, num, until } from '../api.js';
import { Card, Empty, ErrorBox, Field, PageHead, Spinner, Tag, errorText, usePoll, useToast } from '../ui.jsx';
import type { Session } from '../App.jsx';

interface Status {
  configured: boolean; url: string | null; intervalMinutes: number; lastCloudSyncAt: string | null; lastAttemptAt: string | null; online: boolean | null; running: boolean; nextRunAt: string | null; message: string;
  lastResult: { at: string; ok: boolean; error?: string; received: number; created: number; updated: number; unchanged: number; companionsCreated: number; cursor: string | null } | null;
}
interface Preview { ok: boolean; error?: string; count: number; newCount: number; updatedCount: number; items: Array<{ id: string; name: string; club?: string; roleCode: string; companions: number; isNew: boolean; updatedAt: string }> }

export function Nube({ session }: { session: Session }) {
  const { toast } = useToast();
  const canPull = ['ADMIN', 'COORDINATOR'].includes(session.user.role) && session.mode !== 'standby';
  const st = usePoll((signal) => api<Status>('/sync/cloud/status', { signal }), 10_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [interval, setIntervalMin] = useState<string>('');
  const d = st.data;
  const intervalValue = interval === '' ? String(d?.intervalMinutes ?? 5) : interval;

  const pull = async () => {
    setBusy('pull');
    try {
      const r = await api<{ received: number; created: number; updated: number; companionsCreated: number }>('/sync/cloud/pull', { method: 'POST' });
      toast(r.received === 0 ? 'La nube no tiene nada nuevo.' : `Listo: ${r.received} recibidas · ${r.created} nuevas · ${r.updated} actualizadas · ${r.companionsCreated} acompañantes.`);
      setPreview(null); st.refresh();
    } catch (e) { toast(errorText(e), 'error'); st.refresh(); } finally { setBusy(null); }
  };
  const look = async () => {
    setBusy('preview');
    try { setPreview(await api<Preview>('/sync/cloud/preview')); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const saveInterval = async () => {
    setBusy('interval');
    try {
      const r = await api<{ message: string }>('/sync/cloud/settings', { method: 'PUT', body: { intervalMinutes: Number(intervalValue) } });
      toast(r.message); setIntervalMin(''); st.refresh();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHead title="Nube" sub="Inscripciones aprobadas en la nube (apps/registration) que el host trae por internet. Sin internet, las puertas siguen funcionando igual."
        right={d && <Tag tone={!d.configured ? 'off' : d.online === false ? 'warn' : d.online ? 'ok' : 'info'}>{!d.configured ? 'no configurada' : d.online === false ? 'sin conexión' : d.online ? 'conectada' : 'sin probar todavía'}</Tag>} />
      <ErrorBox text={st.error} />
      {!d ? <Spinner /> : !d.configured ? (
        <Card title="La nube no está configurada">
          <p>Para traer inscripciones de la nube, arranca el host con <code>TP_CLOUD_URL</code> (dirección de la inscripción online) y <code>TP_CLOUD_KEY</code> (la clave compartida). Sin eso, las credenciales se emiten desde <a href="#/inscripciones">Inscripciones › Emitir en sitio</a> o con el seed.</p>
        </Card>
      ) : (
        <div className="grid-eq">
          <Card title="Estado">
            <p style={{ fontWeight: 600 }}>{d.message}</p>
            <div className="line-item"><span>Dirección</span><span className="mono small">{d.url}</span></div>
            <div className="line-item"><span>Última actualización</span><span>{d.lastCloudSyncAt ? `${dateTime(d.lastCloudSyncAt)} · ${ago(d.lastCloudSyncAt)}` : 'nunca'}</span></div>
            <div className="line-item"><span>Último intento</span><span>{d.lastAttemptAt ? ago(d.lastAttemptAt) : '—'}</span></div>
            {d.lastResult && (
              <div className="line-item"><span>Último resultado</span>
                <span className={d.lastResult.ok ? '' : 'bad'}>{d.lastResult.ok ? (d.lastResult.received === 0 ? 'sin cambios' : `${d.lastResult.received} recibidas · ${d.lastResult.created} nuevas · ${d.lastResult.updated} actualizadas · ${d.lastResult.companionsCreated} acompañantes`) : `falló: ${d.lastResult.error}`}</span>
              </div>
            )}
            <div className="line-item"><span>Periódica</span><span>{d.intervalMinutes > 0 ? `cada ${d.intervalMinutes} min${d.nextRunAt ? ` · próxima ${until(d.nextRunAt)}` : ''}` : 'desactivada (solo manual)'}</span></div>
            <div className="inline">
              {canPull && <button className="btn pri" disabled={busy === 'pull' || d.running} onClick={() => void pull()}>{busy === 'pull' || d.running ? 'Trayendo…' : 'Traer ahora'}</button>}
              <button className="btn" disabled={busy === 'preview'} onClick={() => void look()}>{busy === 'preview' ? 'Consultando…' : 'Ver qué hay por traer'}</button>
            </div>
            {!canPull && session.mode === 'standby' && <p className="muted small">En el equipo de respaldo solo se consulta; la nube se trae desde el principal.</p>}
          </Card>

          {canPull && (
            <Card title="Cada cuánto consultar la nube">
              <Field label="Minutos entre consultas" hint="0 = solo cuando pulses «Traer ahora». Con hotspot 4G, 5 min es suficiente.">
                <input type="number" min={0} max={1440} value={intervalValue} onChange={(e) => setIntervalMin(e.target.value)} />
              </Field>
              <button className="btn" disabled={busy === 'interval' || Number(intervalValue) === d.intervalMinutes} onClick={() => void saveInterval()}>Guardar intervalo</button>
              <p className="muted small">Si falla internet, el host anota «sin conexión» y reintenta en el siguiente ciclo. Nada se pierde: la nube guarda un cursor y manda solo lo nuevo.</p>
            </Card>
          )}

          <Card className="flush" title={preview ? (preview.count === 0 ? 'Nada pendiente por traer' : `${num(preview.count)} por traer · ${preview.newCount} nuevas · ${preview.updatedCount} actualizadas`) : 'Por traer'} right={preview && <button className="btn sm" onClick={() => setPreview(null)}>Cerrar</button>}>
            <div className="tbl">
              {!preview ? <Empty>Pulsa «Ver qué hay por traer» para consultar la nube sin cambiar nada en el host.</Empty>
                : preview.count === 0 ? <Empty>El host ya tiene todo lo aprobado en la nube.</Empty> : (
                  <table>
                    <thead><tr><th>Nombre</th><th>Rol</th><th>Club</th><th className="r">Acomp.</th><th>Estado</th><th>Cambiada</th></tr></thead>
                    <tbody>{preview.items.map((i) => (
                      <tr key={i.id}><td style={{ fontWeight: 600 }}>{i.name}</td><td>{i.roleCode}</td><td className="muted">{i.club ?? '—'}</td><td className="r">{i.companions}</td>
                        <td><Tag tone={i.isNew ? 'info' : 'warn'}>{i.isNew ? 'Nueva' : 'Actualizada'}</Tag></td><td>{dateTime(i.updatedAt)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
            </div>
            {preview && preview.count > 0 && canPull && <div style={{ padding: '10px 18px' }}><button className="btn pri" disabled={busy === 'pull'} onClick={() => void pull()}>Traer estas {num(preview.count)} ahora</button></div>}
          </Card>
        </div>
      )}
    </>
  );
}
