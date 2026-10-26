import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, dateTime, download, num } from '../api.js';
import { Card, Confirm, Empty, ErrorBox, Field, PageHead, REASON_NAMES, STATUS_NAMES, STATUS_TONE, Spinner, Tag, errorText, useToast } from '../ui.jsx';
import { isReadOnly, type Session } from '../App.jsx';

interface Cred { id: string; displayName: string; club?: string; roleCode: string; zones: string[]; version: number; status: string; categoryCode?: string; companionOf?: string | null; issuedAt: string; updatedAt: string; deliveredAt?: string | null; printedAt?: string | null; photoUrl?: string; token?: string }
interface Detail extends Cred {
  person: { id: string; firstName: string; lastName: string; club?: string; source: string; birthDate?: string; documentNumber?: string; relationship?: string; guardian?: { name: string; document: string }; purgedAt?: string | null } | null;
  revocations: Array<{ version: number | null; reason: string; at: string; by: string }>;
  companions: Cred[]; participant: Cred | null;
  scans: Array<{ id: string; at: string; zone: string; direction: string; decision: string; reasonCode: string; deviceId: string; manual?: { reason: string; by: string } }>;
}
interface Config { roles: Array<{ code: string; name: string; color: string }>; zones: Array<{ code: string; name: string }>; ageCategories: Array<{ code: string; name: string }> }

export function Credenciales({ session }: { session: Session }) {
  const { toast } = useToast();
  const ro = isReadOnly(session.user.role);
  const role = session.user.role;
  const [q, setQ] = useState('');
  const [document, setDocument] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [status, setStatus] = useState('');
  const [club, setClub] = useState('');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ items: Cred[]; total: number } | null>(null);
  const [clubs, setClubs] = useState<string[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const LIMIT = 25;

  useEffect(() => {
    api<{ config: Config }>('/config').then((r) => setConfig(r.config)).catch(() => undefined);
    api<string[]>('/credentials/clubs').then(setClubs).catch(() => undefined);
  }, []);

  const search = async (off = 0) => {
    setBusy(true); setError(null);
    try {
      const p = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
      if (q.trim()) p.set('q', q.trim());
      if (document.trim()) p.set('document', document.trim());
      if (roleCode) p.set('roleCode', roleCode);
      if (status) p.set('status', status);
      if (club) p.set('club', club);
      setResult(await api(`/credentials?${p}`));
      setOffset(off);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  useEffect(() => { void search(0); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [roleCode, status, club]);

  const roleOf = (code: string) => config?.roles.find((r) => r.code === code);
  const searchLabel = q || document;

  return (
    <>
      <PageHead title="Credenciales" sub="Busca por nombre, ID corto, club o documento. Toca una fila para ver el detalle." />
      <Card>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void search(0); }}>
          <Field label="Nombre, ID corto o club"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Juan Pérez · TP-2026-00123-C" /></Field>
          <Field label="Documento"><input value={document} onChange={(e) => setDocument(e.target.value)} placeholder="1061700123" /></Field>
          <Field label="Rol">
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}><option value="">Todos</option>{config?.roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
          </Field>
          <Field label="Estado">
            <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(STATUS_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Club">
            <select value={club} onChange={(e) => setClub(e.target.value)}><option value="">Todos</option>{clubs.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </Field>
          <button className="btn pri" disabled={busy}>Buscar</button>
        </form>
        <ErrorBox text={error} />
      </Card>
      <div className={selected ? 'grid-2' : ''} style={selected ? { gridTemplateColumns: 'minmax(0,1fr) 420px' } : undefined}>
        <Card className="flush" title={result ? `${num(result.total)} credenciales` : 'Credenciales'}>
          <div className="tbl">
            {busy && !result ? <Spinner /> : result && result.items.length === 0 ? (
              <Empty>{searchLabel ? <>No encontré a nadie con "{searchLabel}". Prueba con el apellido o el ID corto.</> : 'No hay credenciales emitidas. Aprueba inscripciones y luego emite.'}</Empty>
            ) : (
              <table>
                <thead><tr><th>ID corto</th><th>Nombre</th><th>Rol</th><th>Club</th><th>Versión</th><th>Estado</th></tr></thead>
                <tbody>
                  {result?.items.map((c) => (
                    <tr key={c.id} className="click" onClick={() => setSelected(c.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(c.id); }}>
                      <td className="mono">{c.id}</td>
                      <td style={{ fontWeight: 600 }}>{c.displayName}</td>
                      <td><span className="role-dot" style={{ background: roleOf(c.roleCode)?.color ?? '#64748B' }} />{roleOf(c.roleCode)?.name ?? c.roleCode}</td>
                      <td className="muted">{c.club ?? '—'}</td>
                      <td className="r">v{c.version}</td>
                      <td><Tag tone={STATUS_TONE[c.status] ?? 'off'}>{STATUS_NAMES[c.status] ?? c.status}</Tag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {result && result.total > LIMIT && (
            <div className="pager" style={{ padding: '10px 18px' }}>
              <span>{offset + 1}–{Math.min(offset + LIMIT, result.total)} de {num(result.total)}</span>
              <span className="inline">
                <button className="btn sm" disabled={offset === 0 || busy} onClick={() => void search(Math.max(0, offset - LIMIT))}>Anterior</button>
                <button className="btn sm" disabled={offset + LIMIT >= result.total || busy} onClick={() => void search(offset + LIMIT)}>Siguiente</button>
              </span>
            </div>
          )}
        </Card>
        {selected && (
          <CredentialDetail id={selected} role={role} ro={ro} config={config} onClose={() => setSelected(null)} onChanged={() => { void search(offset); }} toast={toast} />
        )}
      </div>
    </>
  );
}

export function CredentialDetail({ id, role, ro, config, onClose, onChanged, toast }: {
  id: string; role: Session['user']['role']; ro: boolean; config: Config | null; onClose: () => void; onChanged: () => void; toast: (t: string, k?: 'ok' | 'error') => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'revoke' | 'reissue' | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ token: string; img: string } | null>(null);
  const [showPhoto, setShowPhoto] = useState(true);
  const load = () => api<Detail>(`/credentials/${encodeURIComponent(id)}`).then((x) => { setD(x); setError(null); }).catch((e) => setError(errorText(e)));
  useEffect(() => { setD(null); setQr(null); setShowPhoto(true); void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [id]);
  const roleInfo = d ? config?.roles.find((r) => r.code === d.roleCode) : undefined;
  const zoneName = (z: string) => config?.zones.find((x) => x.code === z)?.name ?? z;
  const canRevoke = !ro && ['ADMIN', 'COORDINATOR', 'SUPERVISOR'].includes(role);
  const canReissue = !ro && ['ADMIN', 'COORDINATOR'].includes(role);
  const canDeliver = !ro && ['ADMIN', 'COORDINATOR', 'PRINTER'].includes(role);
  const canPdf = ['ADMIN', 'COORDINATOR', 'PRINTER'].includes(role);
  const canToken = canPdf;
  const showQr = async () => {
    try {
      const t = await api<{ token: string }>(`/credentials/${encodeURIComponent(id)}/token`);
      const img = await QRCode.toDataURL(t.token, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
      setQr({ token: t.token, img });
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try { await fn(); toast(okMsg); setDialog(null); await load(); onChanged(); }
    catch (e) { toast(errorText(e), 'error'); }
    finally { setBusy(false); }
  };
  const initials = d ? d.displayName.split(' ').slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() : '';
  return (
    <Card title={<span className="mono">{id}</span>} right={<button className="btn sm" onClick={onClose}>Cerrar</button>}>
      <ErrorBox text={error} />
      {!d ? <Spinner /> : (
        <>
          <div className="cred-head">
            {d.photoUrl && showPhoto ? <img className="avatar" src={d.photoUrl} alt={`Foto de ${d.displayName}`} onError={() => setShowPhoto(false)} style={{ objectFit: 'cover' }} /> : <div className="avatar" style={{ background: roleInfo?.color ?? '#64748B' }} aria-label="Sin foto: iniciales">{initials}</div>}
            <div>
              <h3 style={{ fontSize: 18 }}>{d.displayName}</h3>
              <p className="muted small">{roleInfo?.name ?? d.roleCode}{d.club ? ` · ${d.club}` : ''}{d.categoryCode ? ` · ${config?.ageCategories.find((c) => c.code === d.categoryCode)?.name ?? d.categoryCode}` : ''}</p>
              <p><Tag tone={STATUS_TONE[d.status] ?? 'off'}>{STATUS_NAMES[d.status] ?? d.status}</Tag> <span className="muted small">versión {d.version}</span></p>
            </div>
          </div>
          <div className="belt" />
          <dl className="kv">
            <dt>Zonas</dt><dd>{(d.zones.includes('*') ? config?.zones.map((z) => z.code) ?? ['*'] : d.zones).map(zoneName).join(', ')}</dd>
            <dt>Emitida</dt><dd>{dateTime(d.issuedAt)}</dd>
            {d.printedAt && <><dt>Impresa</dt><dd>{dateTime(d.printedAt)}</dd></>}
            {d.deliveredAt && <><dt>Entregada</dt><dd>{dateTime(d.deliveredAt)}</dd></>}
            {d.person?.documentNumber && <><dt>Documento</dt><dd>{d.person.documentNumber}</dd></>}
            {d.person?.birthDate && <><dt>Nacimiento</dt><dd>{d.person.birthDate}</dd></>}
            {d.person?.guardian && <><dt>Acudiente</dt><dd>{d.person.guardian.name}</dd></>}
            {d.person?.purgedAt && <><dt>Datos</dt><dd>Datos personales borrados (purga)</dd></>}
            {d.participant && <><dt>Acompaña a</dt><dd><span className="mono">{d.participant.id}</span> · {d.participant.displayName}{d.person?.relationship ? ` (${d.person.relationship})` : ''}</dd></>}
          </dl>
          {d.companions.length > 0 && (
            <div>
              <h3>Acompañantes ({d.companions.length})</h3>
              {d.companions.map((c) => <div className="line-item" key={c.id}><span>{c.displayName}</span><span className="mono muted small">{c.id}</span></div>)}
            </div>
          )}
          {d.revocations.length > 0 && (
            <div>
              <h3>Anulaciones</h3>
              {d.revocations.map((r, i) => <div className="line-item" key={i}><span>{r.reason}</span><span className="muted small">{dateTime(r.at)} · {r.by}</span></div>)}
            </div>
          )}
          <div>
            <h3>Escaneos ({d.scans.length})</h3>
            {d.scans.length === 0 ? <p className="muted small">Todavía no se ha escaneado.</p> : (
              <div className="tbl"><table>
                <thead><tr><th>Hora</th><th>Zona</th><th>Resultado</th></tr></thead>
                <tbody>{d.scans.slice(0, 30).map((s) => (
                  <tr key={s.id}><td>{dateTime(s.at)}</td><td>{zoneName(s.zone)} {s.direction === 'OUT' ? '↩' : ''}</td>
                    <td><Tag tone={s.decision === 'ALLOW' ? 'ok' : s.decision === 'DENY' ? 'bad' : 'warn'}>{REASON_NAMES[s.reasonCode] ?? s.reasonCode}</Tag>{s.manual ? <span className="muted small"> · {s.manual.reason}</span> : null}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
          {qr && (
            <div className="qr-box">
              <img src={qr.img} alt={`QR de la credencial ${d.id}`} />
              <p className="muted small" style={{ textAlign: 'center' }}>Versión {d.version}. Si la credencial se re-emite, este QR deja de valer.</p>
              <textarea readOnly rows={3} value={qr.token} className="mono small" onFocus={(e) => e.currentTarget.select()} aria-label="Token del QR" />
              <div className="inline">
                <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(qr.token).then(() => toast('Token copiado.')).catch(() => toast('No se pudo copiar; selecciónalo a mano.', 'error')); }}>Copiar token</button>
                <button className="btn sm" onClick={() => setQr(null)}>Ocultar</button>
              </div>
            </div>
          )}
          <div className="inline">
            {canPdf && <button className="btn" onClick={() => download(`/credentials/${encodeURIComponent(d.id)}/pdf`, `${d.id}.pdf`, { open: true }).catch((e) => toast(errorText(e), 'error'))}>Ver / imprimir PDF</button>}
            {canPdf && <button className="btn" onClick={() => download(`/credentials/${encodeURIComponent(d.id)}/pdf`, `${d.id}.pdf`).then(() => toast(`PDF ${d.id}.pdf descargado.`)).catch((e) => toast(errorText(e), 'error'))}>Descargar PDF</button>}
            {canToken && !qr && <button className="btn" onClick={() => void showQr()}>Ver QR / token</button>}
            {canDeliver && d.status !== 'DELIVERED' && d.status !== 'REVOKED' && <button className="btn" disabled={busy} onClick={() => act(() => api(`/credentials/${encodeURIComponent(d.id)}/deliver`, { method: 'POST' }), `Entregada a ${d.displayName.split(' ')[0]}.`)}>Marcar entregada</button>}
            {canReissue && <button className="btn" disabled={busy} onClick={() => setDialog('reissue')}>Re-emitir</button>}
            {canRevoke && d.status !== 'REVOKED' && <button className="btn danger" disabled={busy} onClick={() => setDialog('revoke')}>Anular</button>}
          </div>
          <Confirm open={dialog === 'revoke'} danger title={`¿Anular la credencial ${d.id} de ${d.displayName}?`} body="Dejará de servir en todas las puertas en menos de un minuto." confirmLabel="Anular" withNote placeholder="Motivo (perdida, uso fraudulento…)" busy={busy}
            onCancel={() => setDialog(null)} onConfirm={(reason) => act(() => api(`/credentials/${encodeURIComponent(d.id)}/revoke`, { method: 'POST', body: { reason } }), `Credencial ${d.id} anulada.`)} />
          <Confirm open={dialog === 'reissue'} title={`¿Emitir una nueva versión para ${d.displayName}?`} body={`La actual (${d.id} v${d.version}) queda anulada. Habrá que imprimirla de nuevo.`} confirmLabel="Emitir nueva" withNote placeholder="Motivo (foto, cambio de club…)" busy={busy}
            onCancel={() => setDialog(null)} onConfirm={(reason) => act(() => api(`/credentials/${encodeURIComponent(d.id)}/reissue`, { method: 'POST', body: { reason } }), `Nueva credencial v${d.version + 1} lista para imprimir.`)} />
        </>
      )}
    </Card>
  );
}
