/**
 * Impresión › Diseño de la credencial: editor por secciones de la plantilla
 * (`BadgeTemplate`, ADR-0009) con vista previa en vivo (PDF del host, debounce
 * 600 ms), subida de logos, restablecer, exportar e importar JSON.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BADGE_FIELD_SOURCES, BADGE_ICONS, type BadgeField, type BadgeIcon, type BadgeTemplate } from '@tatami/core';
import { api, apiBlob, bytes } from '../api.js';
import { Card, Confirm, ErrorBox, Field, Spinner, Tag, errorText, useToast } from '../ui.jsx';

type Errors = Array<{ path: string; message: string }>;
interface RoleInfo { code: string; name: string; color: string }

const COLOR_LABELS: Record<keyof BadgeTemplate['colors'], string> = {
  primary: 'Principal (azul marino)', accent: 'Acento (rosa)', text: 'Texto', muted: 'Texto secundario', stripe1: 'Franja 1', stripe2: 'Franja 2', stripe3: 'Franja 3', gold: 'Línea dorada', roleBandDefault: 'Banda del rol por defecto'
};
const ICON_LABELS: Record<BadgeIcon, string> = {
  none: 'Sin icono', kick: 'Patada', lock: 'Candado', info: 'Información', person: 'Persona', calendar: 'Calendario', 'id-card': 'Carné', ban: 'Prohibido', warning: 'Aviso', phone: 'Teléfono', cross: 'Cruz (salud)', star: 'Estrella', whistle: 'Silbato', camera: 'Cámara', medical: 'Botiquín', shield: 'Escudo', mic: 'Micrófono', handshake: 'Apretón de manos'
};

function Section({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="card" open={open} style={{ padding: 0 }}>
      <summary style={{ cursor: 'pointer', padding: '12px 18px', fontWeight: 700, listStyle: 'revert' }}>{title}</summary>
      <div style={{ padding: '0 18px 16px', display: 'grid', gap: 10 }}>{children}</div>
    </details>
  );
}

function IconPick({ value, onChange, disabled, label }: { value: BadgeIcon; onChange: (v: BadgeIcon) => void; disabled?: boolean; label: string }) {
  return <select value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value as BadgeIcon)}>{BADGE_ICONS.map((i) => <option key={i} value={i}>{ICON_LABELS[i]}</option>)}</select>;
}

function LogoList({ t, ids, onChange, disabled, label }: { t: BadgeTemplate; ids: string[]; onChange: (ids: string[]) => void; disabled?: boolean; label: string }) {
  const available = Object.keys(t.assets).filter((a) => a !== t.header.skylineAsset && a !== t.background.imageAsset);
  const move = (i: number, d: number) => { const n = [...ids]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label small muted">{label}</span>
      {ids.length === 0 && <span className="muted small">Sin logos. Añade uno abajo.</span>}
      {ids.map((id, i) => (
        <div key={`${id}-${i}`} className="inline">
          <AssetThumb asset={t.assets[id]} />
          <span style={{ flex: 1 }}>{t.assets[id]?.name ?? id} <span className="muted small mono">({id})</span></span>
          <button type="button" className="btn sm" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Subir">↑</button>
          <button type="button" className="btn sm" disabled={disabled || i === ids.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">↓</button>
          <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(ids.filter((_, k) => k !== i))}>Quitar</button>
        </div>
      ))}
      <div className="inline">
        <select disabled={disabled || ids.length >= 6} aria-label={`Añadir a ${label}`} value="" onChange={(e) => { if (e.target.value) onChange([...ids, e.target.value]); }}>
          <option value="">Añadir logo subido…</option>
          {available.map((a) => <option key={a} value={a}>{t.assets[a].name} ({a})</option>)}
        </select>
        {ids.length >= 6 && <span className="muted small">Máximo 6.</span>}
      </div>
    </div>
  );
}

function AssetThumb({ asset }: { asset?: BadgeTemplate['assets'][string] }) {
  if (!asset) return <span className="tag bad">falta</span>;
  return <img alt="" src={`data:${asset.mime};base64,${asset.dataBase64}`} style={{ width: 54, height: 24, objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }} />;
}

export function DisenoCredencial({ ro, roles }: { ro: boolean; roles: RoleInfo[] }) {
  const { toast } = useToast();
  const [t, setT] = useState<BadgeTemplate | null>(null);
  const [saved, setSaved] = useState<BadgeTemplate | null>(null);
  const [errors, setErrors] = useState<Errors>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [previewRole, setPreviewRole] = useState('COMP');
  const [previewLayout, setPreviewLayout] = useState<'duplex' | 'two-pages'>('duplex');
  const [upload, setUpload] = useState({ id: '', name: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** PNG (si el host tiene poppler) o PDF en iframe. */
  const [previewKind, setPreviewKind] = useState<'png' | 'pdf'>('png');

  const load = () => api<{ template: BadgeTemplate }>('/print/template').then((r) => { setT(structuredClone(r.template)); setSaved(r.template); setErrors([]); }).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, []);

  const dirty = useMemo(() => JSON.stringify(t) !== JSON.stringify(saved), [t, saved]);
  const err = (path: string) => errors.find((e) => e.path === path)?.message;
  const patch = (fn: (d: BadgeTemplate) => void) => setT((cur) => { if (!cur) return cur; const d = structuredClone(cur); fn(d); return d; });

  // Vista previa en vivo: se regenera 600 ms después del último cambio.
  const previewKey = useMemo(() => (t ? JSON.stringify({ t, previewRole, previewLayout }) : ''), [t, previewRole, previewLayout]);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setPreviewState('loading');
      try {
        let kind = previewKind;
        let blob: Blob;
        try {
          blob = await apiBlob('/print/template/preview', { template: t, layout: previewLayout, format: kind, sample: { roleCode: previewRole } }, ctrl.signal);
        } catch (e) {
          if (kind === 'png' && (e as { status?: number }).status === 406) { kind = 'pdf'; setPreviewKind('pdf'); blob = await apiBlob('/print/template/preview', { template: t, layout: previewLayout, sample: { roleCode: previewRole } }, ctrl.signal); }
          else throw e;
        }
        const url = URL.createObjectURL(blob);
        setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
        setPreviewState('idle');
        setErrors([]);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setPreviewState('error');
        const ae = e as { errors?: Errors };
        if (ae.errors) setErrors(ae.errors);
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const save = async () => {
    if (!t) return;
    setBusy('save');
    try {
      const r = await api<{ template: BadgeTemplate; message: string }>('/print/template', { method: 'PUT', body: { template: t } });
      toast(r.message); setSaved(r.template); setT(structuredClone(r.template)); setErrors([]);
    } catch (e) {
      const ae = e as { errors?: Errors };
      if (ae.errors) setErrors(ae.errors);
      toast(errorText(e), 'error');
    } finally { setBusy(null); }
  };
  const reset = async () => {
    setBusy('reset');
    try { const r = await api<{ template: BadgeTemplate; message: string }>('/print/template/reset', { method: 'POST' }); toast(r.message); setSaved(r.template); setT(structuredClone(r.template)); setErrors([]); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); setConfirmReset(false); }
  };
  const exportJson = () => {
    if (!t) return;
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `plantilla-credencial-${t.id}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    toast('Plantilla exportada. Guárdala como copia o compártela con otro host.');
  };
  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as BadgeTemplate;
      if (!parsed || typeof parsed !== 'object' || !('front' in parsed)) throw new Error('Ese archivo no es una plantilla de credencial.');
      setT(parsed); setErrors([]);
      toast('Plantilla importada. Revisa la vista previa y guarda para aplicarla.');
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const uploadAsset = async (file: File) => {
    if (!file.type || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) return toast('Solo se aceptan imágenes PNG, JPG o SVG.', 'error');
    if (file.size > 1024 * 1024) return toast('El archivo pesa más de 1 MB. Reduce la imagen antes de subirla.', 'error');
    const id = (upload.id || file.name.replace(/\.[^.]+$/, '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id) return toast('Pon un id corto para el archivo: minúsculas, números y guiones (p. ej. logo-liga).', 'error');
    const dataBase64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('No pude leer el archivo.')); r.readAsDataURL(file); });
    setBusy('upload');
    try {
      const r = await api<{ id: string; template: BadgeTemplate; message: string }>('/print/template/assets', { method: 'POST', body: { id, name: upload.name || file.name, mime: file.type, dataBase64 } });
      toast(r.message);
      setSaved(r.template);
      patch((d) => { d.assets = r.template.assets; });
      setUpload({ id: '', name: '' });
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const removeAsset = async (id: string) => {
    setBusy(`del:${id}`);
    try {
      const r = await api<{ template: BadgeTemplate; message: string }>(`/print/template/assets/${id}`, { method: 'DELETE' });
      toast(r.message);
      setSaved(r.template);
      patch((d) => {
        delete d.assets[id];
        d.front.footer.logos = d.front.footer.logos.filter((x) => x !== id); d.back.footer.logos = d.back.footer.logos.filter((x) => x !== id); d.back.sponsors.logos = d.back.sponsors.logos.filter((x) => x !== id);
        if (d.header.skylineAsset === id) d.header.skylineAsset = null; if (d.background.imageAsset === id) d.background.imageAsset = null;
      });
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };

  if (error) return <ErrorBox text={error} />;
  if (!t) return <Spinner />;
  const setField = (i: number, p: Partial<BadgeField>) => patch((d) => { d.front.fields[i] = { ...d.front.fields[i], ...p }; });
  const moveField = (i: number, dir: number) => patch((d) => { const j = i + dir; if (j < 0 || j >= d.front.fields.length) return; [d.front.fields[i], d.front.fields[j]] = [d.front.fields[j], d.front.fields[i]]; });
  const assetIds = Object.keys(t.assets);

  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 440px)' }}>
      <div className="stack">
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <div className="inline">
            <strong>{t.name}</strong> <span className="muted small mono">{t.id} · {t.size.widthMm} × {t.size.heightMm} mm</span>
            {dirty && <Tag tone="warn">Cambios sin guardar</Tag>}
            {errors.length > 0 && <Tag tone="bad">{errors.length} {errors.length === 1 ? 'error' : 'errores'}</Tag>}
          </div>
          <div className="inline">
            <button className="btn sm" onClick={exportJson}>Exportar plantilla (.json)</button>
            {!ro && <><button className="btn sm" onClick={() => importRef.current?.click()}>Importar plantilla</button>
              <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} /></>}
            {!ro && <button className="btn sm" disabled={busy !== null} onClick={() => setConfirmReset(true)}>Restablecer diseño del piloto</button>}
            {!ro && <button className="btn sm pri" disabled={!dirty || busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Guardando…' : 'Guardar diseño'}</button>}
          </div>
        </div>
        {errors.length > 0 && <div className="error-box" role="alert">{errors.slice(0, 5).map((e) => <div key={e.path}><span className="mono small">{e.path}</span> · {e.message}</div>)}{errors.length > 5 && <div className="small">… y {errors.length - 5} más.</div>}</div>}

        <Section title="Colores" open>
          <div className="row">
            {(Object.keys(COLOR_LABELS) as Array<keyof BadgeTemplate['colors']>).map((k) => (
              <Field key={k} label={COLOR_LABELS[k]} error={err(`colors.${k}`)}>
                <span className="inline" style={{ flexWrap: 'nowrap' }}>
                  <input type="color" className="color-in" disabled={ro} aria-label={COLOR_LABELS[k]} value={/^#[0-9a-fA-F]{6}$/.test(t.colors[k]) ? t.colors[k] : '#000000'} onChange={(e) => patch((d) => { d.colors[k] = e.target.value.toUpperCase(); })} />
                  <input className="mono" style={{ width: 96 }} disabled={ro} value={t.colors[k]} onChange={(e) => patch((d) => { d.colors[k] = e.target.value; })} aria-label={`${COLOR_LABELS[k]} (hex)`} />
                </span>
              </Field>
            ))}
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" disabled={ro} checked={t.background.stripes} onChange={(e) => patch((d) => { d.background.stripes = e.target.checked; })} />Franjas diagonales de fondo</label>
            <Field label="Ángulo de las franjas (°)" error={err('background.angle')}><input type="number" min={-89} max={89} disabled={ro} value={t.background.angle} onChange={(e) => patch((d) => { d.background.angle = Number(e.target.value); })} /></Field>
            <Field label="Opacidad (0–1)" error={err('background.opacity')}><input type="number" min={0} max={1} step={0.05} disabled={ro} value={t.background.opacity} onChange={(e) => patch((d) => { d.background.opacity = Number(e.target.value); })} /></Field>
          </div>
        </Section>

        <Section title="Textos de cabecera">
          <div className="row">
            <Field label="Número de edición" hint="Grande, con contorno (p. ej. 21)" error={err('header.badgeNumber')}><input disabled={ro} value={t.header.badgeNumber} maxLength={4} onChange={(e) => patch((d) => { d.header.badgeNumber = e.target.value; })} /></Field>
            <Field label="Título" error={err('header.title')}><input disabled={ro} value={t.header.title} onChange={(e) => patch((d) => { d.header.title = e.target.value; })} /></Field>
            <Field label="Subtítulo"><input disabled={ro} value={t.header.subtitle} onChange={(e) => patch((d) => { d.header.subtitle = e.target.value; })} /></Field>
          </div>
          <div className="row">
            <Field label="Año" hint="Vacío = el año de inicio del evento"><input disabled={ro} value={t.header.year} placeholder="2026" onChange={(e) => patch((d) => { d.header.year = e.target.value; })} /></Field>
            <Field label="Ciudad"><input disabled={ro} value={t.header.city} onChange={(e) => patch((d) => { d.header.city = e.target.value; })} /></Field>
            <Field label="Línea de fecha" hint="Vacío = se calcula desde las fechas del evento (14 AL 16 DE NOVIEMBRE DE 2026)"><input disabled={ro} value={t.header.dateLine} onChange={(e) => patch((d) => { d.header.dateLine = e.target.value; })} /></Field>
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" disabled={ro} checked={t.header.showSkyline} onChange={(e) => patch((d) => { d.header.showSkyline = e.target.checked; })} />Silueta arriba a la derecha</label>
            <Field label="Imagen de la silueta" error={err('header.skylineAsset')}>
              <select disabled={ro} value={t.header.skylineAsset ?? ''} onChange={(e) => patch((d) => { d.header.skylineAsset = e.target.value || null; })}><option value="">Ninguna</option>{assetIds.map((a) => <option key={a} value={a}>{t.assets[a].name} ({a})</option>)}</select>
            </Field>
            <Field label="Prefijo del número impreso" hint="Vacío = el ID tal cual (TP-2026-00428-C). Con CNITF2026 se imprime CNITF2026-00428-C; el dígito verificador no cambia." error={err('credentialDisplay.prefix')}>
              <input disabled={ro} value={t.credentialDisplay.prefix ?? ''} placeholder="CNITF2026" onChange={(e) => patch((d) => { d.credentialDisplay.prefix = e.target.value.trim().toUpperCase() || null; })} />
            </Field>
          </div>
        </Section>

        <Section title="Campos del anverso">
          <p className="muted small">Orden y visibilidad de los campos junto a la foto. Máximo 6.</p>
          <div className="tbl"><table className="cfg-table">
            <thead><tr><th>Etiqueta</th><th>Valor</th><th>Color etiqueta</th><th>Visible</th><th></th></tr></thead>
            <tbody>{t.front.fields.map((f, i) => (
              <tr key={f.key}>
                <td><input disabled={ro} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} aria-label={`Etiqueta ${f.key}`} /></td>
                <td>
                  <select disabled={ro} value={f.source} onChange={(e) => setField(i, { source: e.target.value as BadgeField['source'] })} aria-label={`Origen ${f.key}`}>{BADGE_FIELD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
                  {f.source === 'custom' && <input disabled={ro} value={f.customText ?? ''} placeholder="Texto fijo" onChange={(e) => setField(i, { customText: e.target.value })} />}
                </td>
                <td><select disabled={ro} value={f.labelColor === 'primary' || f.labelColor === 'accent' ? f.labelColor : 'hex'} onChange={(e) => setField(i, { labelColor: e.target.value === 'hex' ? t.colors.text : e.target.value })} aria-label={`Color etiqueta ${f.key}`}><option value="primary">Principal</option><option value="accent">Acento</option><option value="hex">Otro</option></select>
                  {f.labelColor !== 'primary' && f.labelColor !== 'accent' && <input type="color" className="color-in" disabled={ro} value={f.labelColor} onChange={(e) => setField(i, { labelColor: e.target.value.toUpperCase() })} />}</td>
                <td><input type="checkbox" disabled={ro} checked={f.visible} onChange={(e) => setField(i, { visible: e.target.checked })} aria-label={`Visible ${f.key}`} /></td>
                <td className="inline"><button className="btn sm" disabled={ro || i === 0} onClick={() => moveField(i, -1)}>↑</button><button className="btn sm" disabled={ro || i === t.front.fields.length - 1} onClick={() => moveField(i, 1)}>↓</button><button className="btn sm" disabled={ro} onClick={() => patch((d) => { d.front.fields.splice(i, 1); })}>Quitar</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="inline">
            <button className="btn sm" disabled={ro || t.front.fields.length >= 6} onClick={() => patch((d) => { d.front.fields.push({ key: `campo-${Date.now().toString(36)}`, label: 'NUEVO CAMPO', source: 'custom', customText: '', labelColor: 'primary', visible: true }); })}>Añadir campo</button>
            <label className="check"><input type="checkbox" disabled={ro} checked={t.front.photo.visible} onChange={(e) => patch((d) => { d.front.photo.visible = e.target.checked; })} />Recuadro de foto</label>
            <Field label="QR (mm)" error={err('front.qr.sizeMm')}><input type="number" min={18} max={60} disabled={ro} style={{ width: 80 }} value={t.front.qr.sizeMm} onChange={(e) => patch((d) => { d.front.qr.sizeMm = Number(e.target.value); })} /></Field>
          </div>
          <div className="row">
            <Field label="Etiqueta de acceso"><input disabled={ro} value={t.front.access.label} onChange={(e) => patch((d) => { d.front.access.label = e.target.value; })} /></Field>
            <Field label="Texto de acceso" hint="Vacío = nombres de las zonas permitidas del rol"><input disabled={ro} value={t.front.access.text} placeholder="Área de competencia · Zonas autorizadas" onChange={(e) => patch((d) => { d.front.access.text = e.target.value; })} /></Field>
            <Field label="Etiqueta de acreditación"><input disabled={ro} value={t.front.accreditation.label} onChange={(e) => patch((d) => { d.front.accreditation.label = e.target.value; })} /></Field>
          </div>
        </Section>

        <Section title="Banda del rol">
          <div className="inline">
            <label className="check"><input type="checkbox" disabled={ro} checked={t.front.roleBand.visible} onChange={(e) => patch((d) => { d.front.roleBand.visible = e.target.checked; })} />Mostrar banda</label>
            <label className="check"><input type="checkbox" disabled={ro} checked={t.front.roleBand.useRoleColor} onChange={(e) => patch((d) => { d.front.roleBand.useRoleColor = e.target.checked; })} />Usar el color de cada rol (Evento y roles)</label>
          </div>
          <p className="muted small">Los roles marcados "color por defecto" usan siempre el color de banda por defecto (rosa en el piloto) aunque tengan color propio.</p>
          <div className="tbl"><table className="cfg-table">
            <thead><tr><th>Rol</th><th>Color por defecto</th><th>Icono</th></tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.code}>
                  <td><span className="role-dot" style={{ background: r.color }} />{r.name} <span className="muted small mono">{r.code}</span></td>
                  <td><input type="checkbox" disabled={ro} checked={t.front.roleBand.defaultColorRoles.includes(r.code)} aria-label={`Color por defecto ${r.code}`} onChange={(e) => patch((d) => { d.front.roleBand.defaultColorRoles = e.target.checked ? [...d.front.roleBand.defaultColorRoles, r.code] : d.front.roleBand.defaultColorRoles.filter((x) => x !== r.code); })} /></td>
                  <td><IconPick disabled={ro} label={`Icono ${r.code}`} value={t.front.roleBand.icons[r.code] ?? t.front.roleBand.icons['*'] ?? 'none'} onChange={(v) => patch((d) => { d.front.roleBand.icons[r.code] = v; })} /></td>
                </tr>
              ))}
              <tr><td className="muted">Otros roles</td><td></td><td><IconPick disabled={ro} label="Icono por defecto" value={t.front.roleBand.icons['*'] ?? 'none'} onChange={(v) => patch((d) => { d.front.roleBand.icons['*'] = v; })} /></td></tr>
            </tbody>
          </table></div>
        </Section>

        <Section title="Logos y archivos">
          <LogoList t={t} ids={t.front.footer.logos} disabled={ro} label="Pie del anverso" onChange={(ids) => patch((d) => { d.front.footer.logos = ids; })} />
          <LogoList t={t} ids={t.back.footer.logos} disabled={ro} label="Pie del reverso" onChange={(ids) => patch((d) => { d.back.footer.logos = ids; })} />
          {!ro && (
            <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <Field label="Id del archivo" hint="minúsculas, números y guiones"><input value={upload.id} placeholder="logo-liga" onChange={(e) => setUpload((u) => ({ ...u, id: e.target.value }))} /></Field>
              <Field label="Nombre"><input value={upload.name} placeholder="Liga Caucana de Taekwondo" onChange={(e) => setUpload((u) => ({ ...u, name: e.target.value }))} /></Field>
              <Field label="Archivo (PNG, JPG o SVG, hasta 1 MB)"><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" disabled={busy === 'upload'} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAsset(f); }} /></Field>
            </div>
          )}
          <div className="stack" style={{ gap: 4 }}>
            <span className="label small muted">Archivos en la plantilla ({assetIds.length}) · {bytes(new Blob([JSON.stringify(t)]).size)} en total</span>
            {assetIds.map((id) => (
              <div key={id} className="inline"><AssetThumb asset={t.assets[id]} /><span style={{ flex: 1 }}>{t.assets[id].name} <span className="muted small mono">{id} · {t.assets[id].mime.replace('image/', '')}</span></span>{!ro && <button className="btn sm" disabled={busy === `del:${id}`} onClick={() => void removeAsset(id)}>Eliminar</button>}</div>
            ))}
          </div>
        </Section>

        <Section title="Reverso">
          <label className="check"><input type="checkbox" disabled={ro} checked={t.back.enabled} onChange={(e) => patch((d) => { d.back.enabled = e.target.checked; })} />Imprimir reverso (segunda página por credencial)</label>
          <Field label="Título del recuadro"><input disabled={ro} value={t.back.infoBox.title} onChange={(e) => patch((d) => { d.back.infoBox.title = e.target.value; })} /></Field>
          <span className="label small muted">Información importante (una línea por viñeta, máximo 8)</span>
          {t.back.infoBox.items.map((it, i) => (
            <div key={i} className="inline">
              <IconPick disabled={ro} label={`Icono línea ${i + 1}`} value={it.icon} onChange={(v) => patch((d) => { d.back.infoBox.items[i].icon = v; })} />
              <input style={{ flex: 1 }} disabled={ro} value={it.text} maxLength={110} aria-label={`Línea ${i + 1}`} onChange={(e) => patch((d) => { d.back.infoBox.items[i].text = e.target.value; })} />
              <button className="btn sm" disabled={ro} onClick={() => patch((d) => { d.back.infoBox.items.splice(i, 1); })}>Quitar</button>
              {err(`back.infoBox.items[${i}].text`) && <span className="hint error">{err(`back.infoBox.items[${i}].text`)}</span>}
            </div>
          ))}
          <div><button className="btn sm" disabled={ro || t.back.infoBox.items.length >= 8} onClick={() => patch((d) => { d.back.infoBox.items.push({ icon: 'info', text: '' }); })}>Añadir línea</button></div>
          <div className="row">
            <label className="check"><input type="checkbox" disabled={ro} checked={t.back.emergencyContact.visible} onChange={(e) => patch((d) => { d.back.emergencyContact.visible = e.target.checked; })} />Tarjeta de contacto de emergencia</label>
            <label className="check"><input type="checkbox" disabled={ro} checked={t.back.eps.visible} onChange={(e) => patch((d) => { d.back.eps.visible = e.target.checked; })} />Tarjeta de EPS</label>
            <label className="check"><input type="checkbox" disabled={ro} checked={t.back.barcode.visible} onChange={(e) => patch((d) => { d.back.barcode.visible = e.target.checked; })} />Código de barras (Code 128) con el número</label>
          </div>
          <Field label="Título de patrocinadores"><input disabled={ro} value={t.back.sponsors.title} onChange={(e) => patch((d) => { d.back.sponsors.title = e.target.value; })} /></Field>
          <LogoList t={t} ids={t.back.sponsors.logos} disabled={ro} label="Patrocinadores" onChange={(ids) => patch((d) => { d.back.sponsors.logos = ids; })} />
        </Section>

        <Section title="Privacidad: qué datos personales se imprimen">
          <div className="warn-box">Una credencial se pierde, se fotografía y se presta. Imprime solo lo que la operación necesita (Ley 1581 de 2012): el documento y la EPS son datos personales; el contacto de emergencia es de un tercero. Lo que apagues aquí no sale en ningún PDF aunque la persona lo haya dado.</div>
          <label className="check"><input type="checkbox" disabled={ro} checked={t.privacy.printDocument} onChange={(e) => patch((d) => { d.privacy.printDocument = e.target.checked; })} />Imprimir el documento de identidad en el anverso</label>
          <label className="check"><input type="checkbox" disabled={ro} checked={t.privacy.printEmergency} onChange={(e) => patch((d) => { d.privacy.printEmergency = e.target.checked; })} />Imprimir el contacto de emergencia (nombre y teléfono) en el reverso</label>
          <label className="check"><input type="checkbox" disabled={ro} checked={t.privacy.printEps} onChange={(e) => patch((d) => { d.privacy.printEps = e.target.checked; })} />Imprimir la EPS y el régimen en el reverso</label>
        </Section>
      </div>

      <Card title="Vista previa" right={<span className="muted small">{previewState === 'loading' ? 'Actualizando…' : previewState === 'error' ? 'No se pudo generar' : 'Al día'}</span>}>
        <div className="row">
          <Field label="Rol de muestra"><select value={previewRole} onChange={(e) => setPreviewRole(e.target.value)}>{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
          <Field label="Vista"><select value={previewLayout} onChange={(e) => setPreviewLayout(e.target.value as 'duplex' | 'two-pages')}><option value="duplex">Anverso y reverso juntos</option><option value="two-pages">Una página por lado</option></select></Field>
        </div>
        {!previewUrl ? <Spinner text="Generando vista previa…" />
          : previewKind === 'png' ? <img alt="Vista previa de la credencial" src={previewUrl} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} data-testid="badge-preview" />
          : <iframe title="Vista previa de la credencial" src={`${previewUrl}#toolbar=0&view=FitH`} style={{ width: '100%', height: previewLayout === 'duplex' ? 420 : 640, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} data-testid="badge-preview" />}
        <p className="muted small">La muestra se firma con una clave de prueba: su QR no vale en ninguna puerta. Datos de ejemplo; el nombre y los campos salen de cada credencial real.</p>
        {previewUrl && previewKind === 'pdf' && <a className="btn sm" href={previewUrl} target="_blank" rel="noopener">Abrir PDF de muestra</a>}
        {previewKind === 'png' && <span className="muted small">La muestra en "Una página por lado" solo enseña el anverso; elige "Anverso y reverso juntos" para ver ambos.</span>}
      </Card>

      <Confirm open={confirmReset} title="Restablecer el diseño del piloto" body="Vuelve a la plantilla “Nacional 2026” con logos de ejemplo. Se pierden los colores, textos y logos que hayas cambiado. Exporta la plantilla antes si quieres conservarla." confirmLabel="Restablecer" danger busy={busy === 'reset'} onCancel={() => setConfirmReset(false)} onConfirm={() => void reset()} />
    </div>
  );
}
