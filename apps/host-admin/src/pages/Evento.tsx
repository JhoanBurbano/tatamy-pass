import { useEffect, useMemo, useState } from 'react';
import type { AccessRole, AgeCategory, EventConfig, Zone } from '@tatami/core';
import { api, num } from '../api.js';
import { ApiError } from '../api.js';
import { Card, Confirm, ErrorBox, Field, PageHead, Spinner, errorText, useToast } from '../ui.jsx';
import type { Session } from '../App.jsx';

type Errors = Array<{ path: string; message: string }>;

/** Entrada numérica con casilla "sin límite" (null). */
function NullableNumber({ value, onChange, disabled, label }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; label: string }) {
  return (
    <span className="inline" style={{ flexWrap: 'nowrap' }}>
      <input type="number" min={0} style={{ width: 90 }} value={value ?? ''} disabled={disabled || value === null} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} aria-label={label} />
      <label className="check small"><input type="checkbox" checked={value === null} disabled={disabled} onChange={(e) => onChange(e.target.checked ? null : 0)} />sin límite</label>
    </span>
  );
}

function ZonesPick({ zones, value, onChange, disabled, allowAll }: { zones: Zone[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; allowAll?: boolean }) {
  const all = value.includes('*');
  const toggle = (code: string) => {
    if (code === '*') return onChange(all ? [] : ['*']);
    const base = all ? zones.map((z) => z.code) : value;
    onChange(base.includes(code) ? base.filter((c) => c !== code) : [...base, code]);
  };
  return (
    <span className="zones-pick">
      {allowAll && <label className={all ? 'on' : ''}><input type="checkbox" disabled={disabled} checked={all} onChange={() => toggle('*')} />Todas</label>}
      {zones.map((z) => <label key={z.code} className={all || value.includes(z.code) ? 'on' : ''} title={z.name}><input type="checkbox" disabled={disabled} checked={all || value.includes(z.code)} onChange={() => toggle(z.code)} />{z.code}</label>)}
    </span>
  );
}

const days = (from: string, to: string): string[] => {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return out;
  for (let t = Date.parse(from); t <= Date.parse(to) && out.length < 31; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

export function Evento({ session }: { session: Session }) {
  const { toast } = useToast();
  const ro = session.user.role !== 'ADMIN';
  const [cfg, setCfg] = useState<EventConfig | null>(null);
  const [saved, setSaved] = useState<EventConfig | null>(null);
  const [issued, setIssued] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Errors>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = () => api<{ config: EventConfig; issuedByRole: Record<string, number> }>('/config').then((r) => { setCfg(structuredClone(r.config)); setSaved(r.config); setIssued(r.issuedByRole); setErrors([]); setWarnings([]); }).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, []);

  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved]);
  const err = (path: string) => errors.find((e) => e.path === path)?.message;
  const errStarting = (prefix: string) => errors.filter((e) => e.path.startsWith(prefix)).map((e) => e.message);
  const set = (patch: Partial<EventConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c));
  const setRole = (i: number, patch: Partial<AccessRole>) => setCfg((c) => c && { ...c, roles: c.roles.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const setZone = (i: number, patch: Partial<Zone>) => setCfg((c) => c && { ...c, zones: c.zones.map((z, k) => (k === i ? { ...z, ...patch } : z)) });
  const setCat = (i: number, patch: Partial<AgeCategory>) => setCfg((c) => c && { ...c, ageCategories: c.ageCategories.map((x, k) => (k === i ? { ...x, ...patch } : x)) });

  const validate = async () => {
    if (!cfg) return false;
    const r = await api<{ errors: Errors; warnings: string[] }>('/config/validate', { method: 'POST', body: { config: cfg } });
    setErrors(r.errors); setWarnings(r.warnings);
    return r.errors.length === 0;
  };
  const save = async () => {
    if (!cfg || !saved) return;
    setBusy(true);
    try {
      if (!(await validate())) { toast('Revisa los campos marcados.', 'error'); setConfirm(false); return; }
      const r = await api<{ config: EventConfig; warnings: string[]; message: string }>('/config', { method: 'PUT', body: { config: cfg, expectedVersion: saved.configVersion } });
      toast(r.message);
      setConfirm(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast(errorText(e), 'error');
    } finally { setBusy(false); }
  };
  const trySave = async () => {
    if (!(await validate())) { toast('Revisa los campos marcados.', 'error'); return; }
    if (warnings.length || (cfg && cfg.roles.some((r) => r.capacity !== null && (issued[r.code] ?? 0) > r.capacity))) setConfirm(true);
    else await save();
  };

  if (error) return <ErrorBox text={error} />;
  if (!cfg) return <Spinner />;
  const eventDays = days(cfg.startDate, cfg.endDate);

  return (
    <>
      <PageHead title="Evento y roles" sub={`Configuración del evento (versión ${cfg.configVersion}). ${ro ? 'Solo el Administrador puede guardar cambios.' : 'Los scanners reciben los cambios en menos de un minuto.'}`}
        right={!ro && <span className="inline">
          <button className="btn" disabled={!dirty || busy} onClick={() => void load()}>Descartar</button>
          <button className="btn pri" disabled={!dirty || busy} onClick={() => void trySave()}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </span>} />
      {errors.length > 0 && <div className="error-box">La configuración tiene {errors.length} {errors.length === 1 ? 'error' : 'errores'}: {errors.slice(0, 3).map((e) => e.message).join(' ')}{errors.length > 3 ? ' …' : ''}</div>}
      {warnings.map((w, i) => <div className="warn-box" key={i}>{w}</div>)}

      <Card title="Evento">
        <div className="row">
          <Field label="Nombre" error={err('name')}><input disabled={ro} value={cfg.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Id del evento" error={err('eventId')} hint="Va dentro del QR; no lo cambies con credenciales emitidas."><input disabled={ro} value={cfg.eventId} onChange={(e) => set({ eventId: e.target.value })} /></Field>
          <Field label="Prefijo de IDs" error={err('idPrefix')}><input disabled={ro} value={cfg.idPrefix} onChange={(e) => set({ idPrefix: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Primer día" error={err('startDate')}><input type="date" disabled={ro} value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Último día" error={err('endDate')}><input type="date" disabled={ro} value={cfg.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
          <Field label="Desfase horario (min)" error={err('utcOffsetMinutes')} hint="Colombia = -300"><input type="number" disabled={ro} value={cfg.utcOffsetMinutes} onChange={(e) => set({ utcOffsetMinutes: Number(e.target.value) })} /></Field>
        </div>
      </Card>

      <Card title="Aforo y acompañantes">
        <div className="row">
          <Field label="Aforo total del evento" error={err('totalCapacity')} hint={`Hoy hay ${num(Object.values(issued).reduce((a, b) => a + b, 0))} credenciales.`}>
            <NullableNumber label="Aforo total" disabled={ro} value={cfg.totalCapacity} onChange={(v) => set({ totalCapacity: v })} />
          </Field>
          <Field label="Acompañantes por participante" error={err('companions.perParticipant')}>
            <NullableNumber label="Acompañantes por participante" disabled={ro} value={cfg.companions.perParticipant} onChange={(v) => set({ companions: { ...cfg.companions, perParticipant: v } })} />
          </Field>
          <Field label="Total de acompañantes" error={err('companions.total')}>
            <NullableNumber label="Total de acompañantes" disabled={ro} value={cfg.companions.total} onChange={(v) => set({ companions: { ...cfg.companions, total: v } })} />
          </Field>
        </div>
      </Card>

      <Card className="flush" title="Zonas" right={!ro && <button className="btn sm" onClick={() => set({ zones: [...cfg.zones, { code: '', name: '', tracksExit: true }] })}>Agregar zona</button>}>
        {errStarting('zones').map((m, i) => <div className="error-box" style={{ margin: '0 18px' }} key={i}>{m}</div>)}
        <div className="tbl"><table className="cfg-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Controla salida</th>{!ro && <th></th>}</tr></thead>
          <tbody>{cfg.zones.map((z, i) => (
            <tr key={i}>
              <td style={{ width: 90 }}><input disabled={ro} value={z.code} onChange={(e) => setZone(i, { code: e.target.value.toUpperCase() })} aria-label="Código de zona" /></td>
              <td><input disabled={ro} value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} aria-label="Nombre de zona" /></td>
              <td><label className="check"><input type="checkbox" disabled={ro} checked={z.tracksExit} onChange={(e) => setZone(i, { tracksExit: e.target.checked })} />sí (anti-passback y “dentro ahora”)</label></td>
              {!ro && <td className="r"><button className="btn sm" onClick={() => set({ zones: cfg.zones.filter((_, k) => k !== i) })}>Quitar</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Card>

      <Card className="flush" title="Roles de acceso" right={!ro && <button className="btn sm" onClick={() => set({ roles: [...cfg.roles, { code: '', name: '', zones: ['G'], days: null, capacity: null, requiresPhoto: true, color: '#1C4FD1', allowsDigital: false, antiPassbackZones: [] }] })}>Nuevo rol</button>}>
        {errStarting('roles').map((m, i) => <div className="error-box" style={{ margin: '0 18px' }} key={i}>{m}</div>)}
        <div className="tbl"><table className="cfg-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Color</th><th>Zonas</th><th>Días</th><th>Cupo</th><th>Emitidas</th><th>Foto</th><th>Digital</th><th>Anti-passback en</th>{!ro && <th></th>}</tr></thead>
          <tbody>{cfg.roles.map((r, i) => (
            <tr key={i}>
              <td style={{ width: 90 }}><input disabled={ro} value={r.code} onChange={(e) => setRole(i, { code: e.target.value.toUpperCase() })} aria-label="Código de rol" /></td>
              <td style={{ minWidth: 150 }}><input disabled={ro} value={r.name} onChange={(e) => setRole(i, { name: e.target.value })} aria-label="Nombre de rol" /></td>
              <td><input type="color" className="color-in" disabled={ro} value={/^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : '#64748B'} onChange={(e) => setRole(i, { color: e.target.value.toUpperCase() })} aria-label="Color" /></td>
              <td><ZonesPick zones={cfg.zones} value={r.zones} onChange={(zones) => setRole(i, { zones })} disabled={ro} allowAll /></td>
              <td>
                <label className="check small"><input type="checkbox" disabled={ro} checked={r.days === null} onChange={(e) => setRole(i, { days: e.target.checked ? null : [...eventDays] })} />todos</label>
                {r.days !== null && <span className="zones-pick">{eventDays.map((d) => <label key={d} className={r.days!.includes(d) ? 'on' : ''}><input type="checkbox" disabled={ro} checked={r.days!.includes(d)} onChange={() => setRole(i, { days: r.days!.includes(d) ? r.days!.filter((x) => x !== d) : [...r.days!, d].sort() })} />{d.slice(5)}</label>)}</span>}
              </td>
              <td><NullableNumber label="Cupo" disabled={ro} value={r.capacity} onChange={(capacity) => setRole(i, { capacity })} /></td>
              <td className="r">{num(issued[r.code] ?? 0)}</td>
              <td><input type="checkbox" disabled={ro} checked={r.requiresPhoto} onChange={(e) => setRole(i, { requiresPhoto: e.target.checked })} aria-label="Requiere foto" /></td>
              <td><input type="checkbox" disabled={ro} checked={r.allowsDigital} onChange={(e) => setRole(i, { allowsDigital: e.target.checked })} aria-label="Admite credencial digital" /></td>
              <td><ZonesPick zones={cfg.zones.filter((z) => z.tracksExit)} value={r.antiPassbackZones} onChange={(antiPassbackZones) => setRole(i, { antiPassbackZones })} disabled={ro} allowAll /></td>
              {!ro && <td className="r"><button className="btn sm" disabled={(issued[r.code] ?? 0) > 0} title={(issued[r.code] ?? 0) > 0 ? 'Tiene credenciales emitidas' : ''} onClick={() => set({ roles: cfg.roles.filter((_, k) => k !== i) })}>Quitar</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Card>

      <Card className="flush" title="Categorías de edad" right={!ro && <button className="btn sm" onClick={() => set({ ageCategories: [...cfg.ageCategories, { code: '', name: '', minAge: 0, maxAge: null, capacity: null }] })}>Agregar categoría</button>}>
        {errStarting('ageCategories').map((m, i) => <div className="error-box" style={{ margin: '0 18px' }} key={i}>{m}</div>)}
        <div className="tbl"><table className="cfg-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Edad mínima</th><th>Edad máxima</th><th>Cupo</th>{!ro && <th></th>}</tr></thead>
          <tbody>{cfg.ageCategories.map((c, i) => (
            <tr key={i}>
              <td style={{ width: 100 }}><input disabled={ro} value={c.code} onChange={(e) => setCat(i, { code: e.target.value.toUpperCase() })} aria-label="Código de categoría" /></td>
              <td><input disabled={ro} value={c.name} onChange={(e) => setCat(i, { name: e.target.value })} aria-label="Nombre de categoría" /></td>
              <td style={{ width: 110 }}><input type="number" min={0} disabled={ro} value={c.minAge} onChange={(e) => setCat(i, { minAge: Number(e.target.value) })} aria-label="Edad mínima" /></td>
              <td><NullableNumber label="Edad máxima" disabled={ro} value={c.maxAge} onChange={(maxAge) => setCat(i, { maxAge })} /></td>
              <td><NullableNumber label="Cupo de categoría" disabled={ro} value={c.capacity} onChange={(capacity) => setCat(i, { capacity })} /></td>
              {!ro && <td className="r"><button className="btn sm" onClick={() => set({ ageCategories: cfg.ageCategories.filter((_, k) => k !== i) })}>Quitar</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
        <p className="muted small" style={{ padding: '0 18px 14px' }}>La edad se calcula al primer día del evento. Las categorías no pueden solaparse.</p>
      </Card>

      <Card title="Ajustes avanzados" right={<button className="btn sm" onClick={() => setShowAdvanced((x) => !x)}>{showAdvanced ? 'Ocultar' : 'Mostrar'}</button>}>
        {showAdvanced && (
          <div className="row">
            <Field label="Ventana de duplicado (s)" error={err('duplicateWindowSeconds')} hint="Mismo QR en otra puerta en menos de este tiempo = alerta."><input type="number" min={0} disabled={ro} value={cfg.duplicateWindowSeconds} onChange={(e) => set({ duplicateWindowSeconds: Number(e.target.value) })} /></Field>
            <Field label="Vida del código digital (s)" error={err('digitalTokenWindowSeconds')}><input type="number" min={0} disabled={ro} value={cfg.digitalTokenWindowSeconds} onChange={(e) => set({ digitalTokenWindowSeconds: Number(e.target.value) })} /></Field>
            <Field label="Tolerancia de reloj (s)" error={err('clockToleranceSeconds')}><input type="number" min={0} disabled={ro} value={cfg.clockToleranceSeconds} onChange={(e) => set({ clockToleranceSeconds: Number(e.target.value) })} /></Field>
          </div>
        )}
        <p className="muted small">Claves de firma: <code>{cfg.signingKeys.map((k) => k.kid).join(', ') || '—'}</code>. La clave privada vive cifrada en el host y no se edita desde aquí.</p>
      </Card>

      <Confirm open={confirm} title="¿Guardar con cupos por debajo de lo emitido?" confirmLabel="Guardar igual" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => save()}
        body={<>{warnings.map((w, i) => <p key={i}>{w}</p>)}{warnings.length === 0 && <p>Ya hay credenciales emitidas por encima de algún cupo. Bajar el cupo no anula ninguna; solo bloquea nuevas emisiones.</p>}</>} />
    </>
  );
}
