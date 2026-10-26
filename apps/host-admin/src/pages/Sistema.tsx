import { useState } from 'react';
import { api, ago, bytes, dateTime, download, num, until } from '../api.js';
import { Card, Confirm, Empty, ErrorBox, PageHead, Spinner, Tag, errorText, usePoll, useToast } from '../ui.jsx';
import type { Session } from '../App.jsx';

interface Snap { name: string; at: string; bytes: number }
interface Health {
  time: string; timezoneOffsetMinutes: number; eventOffsetMinutes: number; startedAt: string; uptimeSeconds: number; mode: 'primary' | 'standby';
  standby: { mode: string; primaryUrl: string | null; lastSyncAt: string | null; lagSeconds: number | null; online: boolean | null; lastError: string | null; lastCounts: Record<string, number> | null; message: string };
  cloud: { configured: boolean; url: string | null; intervalMinutes: number; lastCloudSyncAt: string | null; online: boolean | null; message: string };
  backups: { intervalMinutes: number; keep: number; dir: string; dir2: string | null; dir2Available: boolean; lastBackupAt: string | null; lastBackup2At: string | null; lastBackup2Error: string | null; nextRunAt: string | null; count: number; count2: number; snapshots: Snap[]; snapshots2: Snap[] };
  disk: { freeBytes: number; totalBytes: number } | null;
  disk2: { freeBytes: number; totalBytes: number } | null;
  db: { credentials: number; persons: number; scans: number; devices: number; audit: number };
  audit: { ok: boolean; brokenAt?: number };
  purge: { retentionDays: number; eligibleFrom: string; due: boolean; pending: number; nextCheckAt: string | null; lastSummary: { purgedAt: string; persons: number } | null };
  pii: { encrypted: boolean; saltSet: boolean; passphraseFromEnv: boolean };
  key: { kid: string; publicKeyHex: string };
}
interface Verify { name: string; ok: boolean; integrity: string; credentials: number; persons: number; scans: number; audit: number; message: string; current: { credentials: number; persons: number; scans: number; audit: number } }

export function Sistema({ session }: { session: Session }) {
  const { toast } = useToast();
  const admin = session.user.role === 'ADMIN';
  const h = usePoll((signal) => api<Health>('/system/health', { signal }), 10_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [purgeStep, setPurgeStep] = useState<0 | 1 | 2>(0);
  const [showUsb, setShowUsb] = useState(false);
  const d = h.data;
  const run = async (key: string, fn: () => Promise<{ message?: string } | unknown>, ok: string) => {
    setBusy(key);
    try { const r = (await fn()) as { message?: string } | undefined; toast(r?.message ?? ok); h.refresh(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const backupTone = (at: string | null, interval = 5) => (!at ? 'warn' : Date.now() - Date.parse(at) > 2 * interval * 60_000 ? 'bad' : Date.now() - Date.parse(at) > interval * 60_000 + 60_000 ? 'warn' : 'ok');
  const clockDiff = d ? Math.round((Date.now() - Date.parse(d.time)) / 1000) : 0;
  const diskFreeGb = d?.disk ? d.disk.freeBytes / 1e9 : null;
  const allGood = d && d.audit.ok && Math.abs(clockDiff) < 300 && backupTone(d.backups.lastBackupAt, d.backups.intervalMinutes || 5) !== 'bad' && (d.mode === 'primary' || d.standby.online);
  const doVerify = async (name: string) => {
    setBusy(`verify:${name}`);
    try { setVerify(await api<Verify>('/backup/verify', { method: 'POST', body: { name } })); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const snapshots = showUsb ? d?.backups.snapshots2 ?? [] : d?.backups.snapshots ?? [];

  return (
    <>
      <PageHead title="Sistema" sub="Salud del computador central, copias de seguridad, equipo de respaldo, datos personales y reportes." right={d && <Tag tone={allGood ? 'ok' : 'warn'}>{allGood ? 'Todo en orden' : 'Hay algo que revisar'}</Tag>} />
      <ErrorBox text={h.error} />
      {!d ? <Spinner /> : (
        <div className="grid-eq">
          <Card title="Computador central" right={<Tag tone={d.mode === 'primary' ? 'ok' : 'warn'}>{d.mode === 'primary' ? 'Equipo principal' : 'Equipo de respaldo'}</Tag>}>
            <div className="line-item"><span>Encendido desde</span><span>{dateTime(d.startedAt)} ({ago(d.startedAt)})</span></div>
            <div className="line-item"><span>Credenciales · personas</span><span className="num">{num(d.db.credentials)} · {num(d.db.persons)}</span></div>
            <div className="line-item"><span>Escaneos · scanners</span><span className="num">{num(d.db.scans)} · {d.db.devices}</span></div>
            <div className="line-item"><span>Registro de auditoría</span><span className={d.audit.ok ? 'ok' : 'bad'}>{d.audit.ok ? `íntegro (${num(d.db.audit)} registros)` : `alterado desde #${d.audit.brokenAt}`}</span></div>
            <div className="line-item"><span>Datos personales en reposo</span><span className={d.pii.encrypted ? 'ok' : 'bad'}>{d.pii.encrypted ? 'cifrados (AES-256-GCM)' : 'sin cifrar'}</span></div>
            {admin && <div className="line-item"><span>Clave de cifrado</span><span className={d.pii.passphraseFromEnv ? 'ok' : 'warn'}>{d.pii.passphraseFromEnv ? 'definida (TP_KEY_PASSPHRASE)' : 'de desarrollo · define TP_KEY_PASSPHRASE'}</span></div>}
            {admin && <div className="line-item"><span>Clave de firma</span><span className="mono small">{d.key.kid} · {d.key.publicKeyHex.slice(0, 12)}…</span></div>}
            <div className="line-item"><span>Hora del host</span><span>{dateTime(d.time)} · <span className={Math.abs(clockDiff) > 300 ? 'bad' : Math.abs(clockDiff) > 60 ? 'warn' : 'ok'}>{Math.abs(clockDiff) < 2 ? 'en hora con este navegador' : `${clockDiff > 0 ? '+' : ''}${clockDiff} s respecto a este navegador`}</span></span></div>
            <div className="line-item"><span>Espacio en disco</span><span className={diskFreeGb === null ? '' : diskFreeGb < 1 ? 'bad' : diskFreeGb < 5 ? 'warn' : 'ok'}>{d.disk ? `quedan ${bytes(d.disk.freeBytes)} de ${bytes(d.disk.totalBytes)}` : 'desconocido'}</span></div>
            <p className="muted small">El host es el reloj de la LAN. Si la diferencia con un celular supera 5 minutos, los códigos digitales rotativos fallan.</p>
          </Card>

          <Card title="Copias de seguridad" right={<Tag tone={backupTone(d.backups.lastBackupAt, d.backups.intervalMinutes || 5)}>{d.backups.lastBackupAt ? `última ${ago(d.backups.lastBackupAt)}` : 'ninguna todavía'}</Tag>}>
            <div className="line-item"><span>Cada cuánto</span><span>{d.backups.intervalMinutes > 0 ? `cada ${d.backups.intervalMinutes} min${d.backups.nextRunAt ? ` · próxima ${until(d.backups.nextRunAt)}` : ''}` : 'desactivadas (solo manual)'}</span></div>
            <div className="line-item"><span>Se conservan</span><span>{d.backups.keep} recientes + 1 por hora</span></div>
            <div className="line-item"><span>Carpeta principal</span><span className="mono small">{d.backups.dir} ({d.backups.count})</span></div>
            <div className="line-item"><span>Segundo destino (USB)</span>
              {!d.backups.dir2 ? <span className="muted">no configurado (TP_BACKUPS_DIR_2)</span>
                : <span className={d.backups.lastBackup2Error ? 'bad' : d.backups.dir2Available ? 'ok' : 'warn'}>{d.backups.dir2Available ? `${d.backups.dir2} (${d.backups.count2}${d.disk2 ? ` · libres ${bytes(d.disk2.freeBytes)}` : ''})` : `${d.backups.dir2} · no está conectado`}</span>}
            </div>
            {d.backups.lastBackup2Error && <div className="warn-box">La última copia no llegó al segundo destino: {d.backups.lastBackup2Error.split(' · ').slice(1).join(' · ')}. Revisa que la USB esté conectada; la copia principal sí se hizo.</div>}
            <div className="inline">
              {admin && <button className="btn pri" disabled={busy === 'backup'} onClick={() => run('backup', () => api('/backup/snapshot', { method: 'POST' }), 'Copia de seguridad creada.')}>{busy === 'backup' ? 'Copiando…' : 'Hacer copia ahora'}</button>}
              {d.backups.dir2 && <label className="check small"><input type="checkbox" checked={showUsb} onChange={(e) => setShowUsb(e.target.checked)} />Ver las del segundo destino</label>}
            </div>
            <div className="tbl" style={{ maxHeight: 260 }}>
              {snapshots.length === 0 ? <Empty>Todavía no hay copias{showUsb ? ' en el segundo destino' : ''}.</Empty> : (
                <table><thead><tr><th>Copia</th><th>Cuándo</th><th className="r">Tamaño</th><th></th></tr></thead>
                  <tbody>{snapshots.map((s) => (
                    <tr key={s.name}><td className="mono small">{s.name}</td><td>{dateTime(s.at)}</td><td className="r">{bytes(s.bytes)}</td>
                      <td className="r"><span className="inline" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" disabled={!!busy} onClick={() => void doVerify(s.name)}>{busy === `verify:${s.name}` ? 'Abriendo…' : 'Verificar'}</button>
                        {admin && <button className="btn sm" disabled={!!busy} onClick={() => setRestore(s.name)}>Restaurar</button>}
                      </span></td></tr>
                  ))}</tbody></table>
              )}
            </div>
            {verify && (
              <div className={verify.ok ? 'ok-box' : 'error-box'}>
                <b>{verify.name}</b>: {verify.message}
                {verify.ok && <div className="small">Ahora mismo el host tiene {num(verify.current.credentials)} credenciales, {num(verify.current.scans)} escaneos y {num(verify.current.audit)} registros de auditoría.</div>}
              </div>
            )}
            <p className="muted small">Restaurar con el host apagado: <code>npm run restore -w apps/host -- {snapshots[0]?.name ?? 'tatami-….db'} --yes</code>. Verifica siempre antes de restaurar.</p>
          </Card>

          <Card title="Equipo de respaldo (standby)" right={<Tag tone={d.mode === 'standby' ? (d.standby.online ? 'ok' : 'bad') : 'info'}>{d.mode === 'standby' ? (d.standby.online ? 'replicando' : 'sin conexión con el principal') : 'este es el principal'}</Tag>}>
            <p style={{ fontWeight: 600 }}>{d.standby.message}</p>
            {d.mode === 'standby' && (
              <>
                <div className="line-item"><span>Principal</span><span className="mono small">{d.standby.primaryUrl ?? '—'}</span></div>
                <div className="line-item"><span>Última sincronización</span><span className={d.standby.lagSeconds === null ? 'warn' : d.standby.lagSeconds > 100 ? 'bad' : d.standby.lagSeconds > 30 ? 'warn' : 'ok'}>{d.standby.lastSyncAt ? `${ago(d.standby.lastSyncAt)} (retraso ${d.standby.lagSeconds} s)` : 'nunca'}</span></div>
                {d.standby.lastCounts && <div className="line-item"><span>Último ciclo</span><span className="muted small">{Object.entries(d.standby.lastCounts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(' · ') || 'sin cambios'}</span></div>}
                {d.standby.lastError && <div className="line-item"><span>Último error</span><span className="bad">{d.standby.lastError}</span></div>}
                {admin && <button className="btn danger" onClick={() => setPromoteOpen(true)}>Convertir este equipo en el principal</button>}
                <p className="muted small">Después de promover, apunta los scanners a este equipo: en el scanner, menú ⋯ › Cambiar dirección del host (o cambia el DNS/mDNS <code>tatami-host.local</code> a esta IP).</p>
              </>
            )}
            {d.mode === 'primary' && <p className="muted small">Para tener respaldo, arranca otro host con <code>TP_ROLE=standby TP_PRIMARY_URL=http://este-equipo:8787 TP_REPLICA_KEY=…</code>, la misma <code>TP_KEY_PASSPHRASE</code> y la misma carpeta <code>keys/</code>. Replica cada 10 s y se promueve desde su propio panel o con <code>npm run promote -w apps/host</code>.</p>}
          </Card>

          <Card title="Datos personales (purga)" right={<Tag tone={d.purge.lastSummary ? 'ok' : d.purge.due ? 'warn' : 'info'}>{d.purge.lastSummary ? `purgados ${ago(d.purge.lastSummary.purgedAt)}` : d.purge.due ? 'pendiente' : 'todavía no toca'}</Tag>}>
            <div className="line-item"><span>Retención</span><span>{d.purge.retentionDays} días después del evento</span></div>
            <div className="line-item"><span>Se borran a partir del</span><span>{d.purge.eligibleFrom.slice(0, 10)}</span></div>
            <div className="line-item"><span>Personas con datos</span><span className="num">{num(d.purge.pending)}</span></div>
            <div className="line-item"><span>Revisión automática</span><span>{d.purge.nextCheckAt ? `diaria · próxima ${until(d.purge.nextCheckAt)}` : 'diaria (al arrancar el host)'}</span></div>
            <p className="muted small">Borra nombre, documento, fecha de nacimiento, acudiente y foto. Conserva conteos, escaneos (solo IDs) y auditoría anonimizada. No se puede deshacer.</p>
            {admin && d.purge.pending > 0 && <button className="btn danger" onClick={() => setPurgeStep(1)}>Purgar datos personales ahora</button>}
          </Card>

          <Card title="Nube" right={<Tag tone={!d.cloud.configured ? 'off' : d.cloud.online === false ? 'warn' : 'ok'}>{!d.cloud.configured ? 'no configurada' : d.cloud.online === false ? 'sin conexión' : 'conectada'}</Tag>}>
            <p style={{ fontWeight: 600 }}>{d.cloud.message}</p>
            <div className="line-item"><span>Actualización periódica</span><span>{d.cloud.intervalMinutes > 0 ? `cada ${d.cloud.intervalMinutes} min` : 'solo manual'}</span></div>
            <a href="#/nube" className="btn">Ir a Nube</a>
          </Card>

          <Card title="Reportes">
            <p className="muted small">Cierre del día: resumen por puerta, por rol, dentro al cierre, alertas e ingresos manuales.</p>
            <div className="inline">
              <button className="btn" disabled={busy === 'csv'} onClick={() => run('csv', () => download('/reports/day-close?format=csv', 'cierre.csv'), 'Reporte descargado.')}>Descargar cierre de hoy (CSV)</button>
              <button className="btn" disabled={busy === 'json'} onClick={() => run('json', () => api('/reports/day-close').then((r) => { const b = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'cierre.json'; a.click(); return {}; }), 'Reporte descargado.')}>JSON</button>
            </div>
          </Card>
        </div>
      )}
      <Confirm open={!!restore} danger title={`¿Restaurar la copia ${restore}?`} body="Se reemplazarán todos los datos actuales por los de esa copia. Antes se guarda una copia del estado actual por si acaso. Los scanners se resincronizan solos." confirmLabel="Restaurar" requireText="RESTAURAR" busy={busy === 'restore'}
        onCancel={() => setRestore(null)} onConfirm={() => run('restore', () => api('/backup/restore', { method: 'POST', body: { name: restore, confirm: 'RESTAURAR' } }), 'Copia restaurada.').then(() => setRestore(null))} />
      <Confirm open={promoteOpen} danger title="¿Convertir este equipo en el principal?" body="Hazlo solo si el principal no responde. Este equipo dejará de replicar y empezará a aceptar escaneos y cambios. Luego apunta los scanners a su dirección. No vuelvas a encender el principal viejo como principal." confirmLabel="Promover" requireText="PROMOVER" busy={busy === 'promote'}
        onCancel={() => setPromoteOpen(false)} onConfirm={() => run('promote', () => api('/system/promote', { method: 'POST', body: { confirm: 'PROMOVER' } }), 'Equipo promovido.').then(() => { setPromoteOpen(false); setTimeout(() => window.location.reload(), 800); })} />
      <Confirm open={purgeStep === 1} danger title={`¿Borrar los datos personales de ${num(d?.purge.pending ?? 0)} personas?`} body={`La fecha automática es el ${d?.purge.eligibleFrom.slice(0, 10) ?? '…'}. Si sigues, se borran ahora. Se conservan conteos, escaneos y auditoría; no se puede deshacer. En el siguiente paso tendrás que escribir el nombre del evento.`} confirmLabel="Continuar"
        onCancel={() => setPurgeStep(0)} onConfirm={() => setPurgeStep(2)} />
      <Confirm open={purgeStep === 2} danger title="Última confirmación" body="Escribe el nombre exacto del evento para borrar los datos personales de forma definitiva." confirmLabel="Borrar datos personales" withNote placeholder="Nombre exacto del evento" busy={busy === 'purge'}
        onCancel={() => setPurgeStep(0)} onConfirm={(name) => run('purge', () => api('/system/purge', { method: 'POST', body: { dryRun: false, force: true, confirm: name } }), 'Datos personales borrados.').then(() => setPurgeStep(0))} />
    </>
  );
}
