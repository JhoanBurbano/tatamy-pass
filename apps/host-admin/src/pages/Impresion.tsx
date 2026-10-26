import { useEffect, useState } from 'react';
import { api, dateTime, download, num } from '../api.js';
import { Card, Empty, ErrorBox, Field, PageHead, STATUS_NAMES, Spinner, Tag, errorText, useToast } from '../ui.jsx';
import { CredentialDetail } from './Credenciales.jsx';
import { DisenoCredencial } from './DisenoCredencial.jsx';
import type { Session } from '../App.jsx';

interface Batch { id: string; createdAt: string; createdBy: string; filter: { roleCode: string | null; club: string | null; status: string; ids?: number }; credentialIds: string[]; count: number; status: 'PENDING' | 'PRINTED' | 'DELIVERED'; printedAt: string | null; printedBy: string | null; deliveredAt: string | null; deliveredBy: string | null }
interface BatchItem { id: string; displayName: string; club?: string; roleCode: string; version: number; status: string }
interface Config { roles: Array<{ code: string; name: string; color: string }>; zones: Array<{ code: string; name: string }>; ageCategories: Array<{ code: string; name: string }> }

export function Impresion({ session }: { session: Session }) {
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [issued, setIssued] = useState<Record<string, number>>({});
  const [clubs, setClubs] = useState<string[]>([]);
  const [roleCode, setRoleCode] = useState('');
  const [club, setClub] = useState('');
  const [status, setStatus] = useState('ISSUED');
  const [limit, setLimit] = useState(500);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [open, setOpen] = useState<{ batch: Batch; items: BatchItem[] } | null>(null);
  const ro = session.user.role === 'AUDITOR' || session.mode === 'standby';
  const [tab, setTab] = useState<'lotes' | 'diseno'>(() => (window.location.hash.includes('diseno') ? 'diseno' : 'lotes'));
  const canDesign = session.user.role === 'ADMIN' || session.user.role === 'COORDINATOR';

  const load = async () => {
    try {
      const [b, c, cl] = await Promise.all([api<Batch[]>('/print/batches'), api<{ config: Config; issuedByRole: Record<string, number> }>('/config'), api<string[]>('/credentials/clubs')]);
      setBatches(b); setConfig(c.config); setIssued(c.issuedByRole); setClubs(cl); setError(null);
    } catch (e) { setError(errorText(e)); }
  };
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const p = new URLSearchParams({ limit: '1' });
    if (roleCode) p.set('roleCode', roleCode);
    if (club) p.set('club', club);
    if (status) p.set('status', status);
    api<{ total: number }>(`/credentials?${p}`).then((r) => setPreview(r.total)).catch(() => setPreview(null));
  }, [roleCode, club, status]);

  const create = async () => {
    setBusy('create');
    try {
      const b = await api<Batch>('/print/batches', { method: 'POST', body: { roleCode: roleCode || undefined, club: club || undefined, status: status || undefined, limit } });
      toast(`Lote ${b.id} creado con ${b.count} credenciales.`);
      await load();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const pdf = async (b: Batch) => {
    setBusy(b.id);
    try { await download(`/print/batches/${b.id}/pdf`, `${b.id}.pdf`); toast(`PDF listo: ${b.count} credenciales.`); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const printed = async (b: Batch) => {
    setBusy(b.id);
    try { const r = await api<{ credentialsUpdated: number }>(`/print/batches/${b.id}/printed`, { method: 'POST' }); toast(`Lote marcado como impreso (${r.credentialsUpdated} credenciales).`); await load(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const delivered = async (b: Batch) => {
    setBusy(b.id);
    try { const r = await api<{ credentialsUpdated: number }>(`/print/batches/${b.id}/delivered`, { method: 'POST' }); toast(`Lote entregado (${r.credentialsUpdated} credenciales marcadas).`); await load(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const openPreview = async (b: Batch) => {
    setBusy(`prev:${b.id}`);
    try { const r = await api<Batch & { items: BatchItem[] }>(`/print/batches/${b.id}`); setOpen({ batch: b, items: r.items }); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const roleName = (code: string | null) => (code ? config?.roles.find((r) => r.code === code)?.name ?? code : 'Todos los roles');

  return (
    <>
      <PageHead title="Impresión" sub={tab === 'lotes' ? 'Crea un lote por rol, club o estado, descarga el PDF (100 × 150 mm, anverso y reverso según el diseño) y márcalo como impreso.' : 'El diseño de la credencial es una plantilla: cambia colores, textos, logos y qué datos se imprimen; los próximos PDF salen con ella.'}
        right={<div className="inline" role="tablist">
          <button role="tab" aria-selected={tab === 'lotes'} className={`btn sm ${tab === 'lotes' ? 'pri' : ''}`} onClick={() => setTab('lotes')}>Lotes</button>
          <button role="tab" aria-selected={tab === 'diseno'} className={`btn sm ${tab === 'diseno' ? 'pri' : ''}`} onClick={() => setTab('diseno')}>Diseño de la credencial</button>
        </div>} />
      <ErrorBox text={error} />
      {tab === 'diseno' && <DisenoCredencial ro={ro || !canDesign} roles={config?.roles ?? []} />}
      {tab === 'lotes' && <>
      <div className="grid-eq">
        <Card title="Nuevo lote">
          <div className="row">
            <Field label="Rol">
              <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}><option value="">Todos</option>{config?.roles.map((r) => <option key={r.code} value={r.code}>{r.name} ({num(issued[r.code] ?? 0)})</option>)}</select>
            </Field>
            <Field label="Club"><select value={club} onChange={(e) => setClub(e.target.value)}><option value="">Todos</option>{clubs.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label="Estado">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>{['ISSUED', 'PRINTED', 'DELIVERED'].map((s) => <option key={s} value={s}>{STATUS_NAMES[s]}</option>)}</select>
            </Field>
            <Field label="Máximo por lote"><input type="number" min={1} max={2000} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 500)} /></Field>
          </div>
          <div className="inline">
            <button className="btn pri" disabled={ro || busy === 'create' || preview === 0} onClick={() => void create()}>{busy === 'create' ? 'Creando…' : 'Crear lote'}</button>
            <span className="muted small">{preview === null ? '' : preview === 0 ? 'No hay credenciales con ese filtro.' : `${num(Math.min(preview, limit))} credenciales entrarían en el lote${preview > limit ? ` (hay ${num(preview)}; sube el máximo o crea varios lotes)` : ''}.`}</span>
          </div>
          <p className="muted small">Un lote de 500 tarda menos de un minuto en generarse. Si la impresora atasca, no reimprimas el lote entero: busca abajo los IDs que faltaron e imprímelos uno a uno.</p>
        </Card>
        <Card title="Imprimir una sola credencial">
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) setSelected(lookup.trim().toUpperCase()); }}>
            <Field label="ID corto"><input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="TP-2026-00123-C" /></Field>
            <button className="btn">Abrir</button>
          </form>
          <p className="muted small">Desde el detalle puedes ver el PDF y marcarla como entregada.</p>
        </Card>
      </div>
      {selected && <CredentialDetail id={selected} role={session.user.role} ro={ro} config={config} onClose={() => setSelected(null)} onChanged={() => void load()} toast={toast} />}
      {open && (
        <Card className="flush" title={`Vista previa del lote ${open.batch.id} · ${num(open.items.length)} credenciales`} right={<button className="btn sm" onClick={() => setOpen(null)}>Cerrar</button>}>
          <div className="tbl" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr><th>ID corto</th><th>Nombre</th><th>Rol</th><th>Club</th><th>Versión</th><th>Estado</th></tr></thead>
              <tbody>{open.items.map((c) => (
                <tr key={c.id} className="click" onClick={() => setSelected(c.id)}>
                  <td className="mono">{c.id}</td><td style={{ fontWeight: 600 }}>{c.displayName}</td>
                  <td><span className="role-dot" style={{ background: config?.roles.find((r) => r.code === c.roleCode)?.color ?? '#64748B' }} />{roleName(c.roleCode)}</td>
                  <td className="muted">{c.club ?? '—'}</td><td className="r">v{c.version}</td><td><Tag tone={c.status === 'REVOKED' ? 'bad' : c.status === 'DELIVERED' ? 'ok' : 'info'}>{STATUS_NAMES[c.status] ?? c.status}</Tag></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="muted small" style={{ padding: '0 18px 12px' }}>Cada credencial son dos páginas de 100 × 150 mm (anverso con foto, campos, rol, QR y número; reverso con información, emergencia, EPS y código de barras) según la pestaña Diseño. Las anuladas se omiten del PDF.</p>
        </Card>
      )}
      <Card className="flush" title="Lotes">
        <div className="tbl">
          {!batches ? <Spinner /> : batches.length === 0 ? <Empty>Todavía no hay lotes. Crea el primero arriba.</Empty> : (
            <table>
              <thead><tr><th>Lote</th><th>Creado</th><th>Filtro</th><th className="r">Credenciales</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.id}</td>
                    <td>{dateTime(b.createdAt)} <span className="muted">· {b.createdBy}</span></td>
                    <td>{roleName(b.filter.roleCode)}{b.filter.club ? ` · ${b.filter.club}` : ''} · {STATUS_NAMES[b.filter.status] ?? b.filter.status}</td>
                    <td className="r">{num(b.count)}</td>
                    <td>{b.status === 'DELIVERED' ? <Tag tone="ok">Entregado {dateTime(b.deliveredAt)}</Tag> : b.status === 'PRINTED' ? <Tag tone="info">Impreso {dateTime(b.printedAt)}</Tag> : <Tag tone="warn">Pendiente</Tag>}</td>
                    <td className="inline" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn sm" disabled={busy === `prev:${b.id}`} onClick={() => void openPreview(b)}>Vista previa</button>
                      {!ro && <button className="btn sm" disabled={busy === b.id} onClick={() => void pdf(b)}>{busy === b.id ? 'Generando…' : 'Descargar PDF'}</button>}
                      {!ro && b.status === 'PENDING' && <button className="btn sm pri" disabled={busy === b.id} onClick={() => void printed(b)}>Marcar como impreso</button>}
                      {!ro && b.status === 'PRINTED' && <button className="btn sm pri" disabled={busy === b.id} onClick={() => void delivered(b)}>Marcar entregado</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      </>}
    </>
  );
}
