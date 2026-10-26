/**
 * Ventana de Tatami Pass Host: pinta el estado que manda el proceso principal
 * y dispara acciones por `window.tp` (preload). Sin framework: un archivo.
 */
import type { DesktopState, EnrollResult, Settings, TpApi } from '../shared/ipc.js';

declare global { interface Window { tp: TpApi } }
const tp = window.tp;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
let state: DesktopState | null = null;
let enrollTimer: number | undefined;

// ---------- utilidades ----------
function ago(iso: string | null): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m ? `${d}/${m}/${y}` : iso;
}
let toastTimer: number | undefined;
function toast(message: string, err = false): void {
  const t = $('toast');
  t.textContent = message;
  t.classList.toggle('err', err);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add('hidden'), err ? 7000 : 4500);
}
async function act(btn: HTMLButtonElement, fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> {
  btn.disabled = true;
  try { const r = await fn(); toast(r.message, !r.ok); } catch (e) { toast((e as Error).message, true); } finally { btn.disabled = false; }
}

// ---------- pintar estado ----------
function render(s: DesktopState): void {
  state = s;
  $('siteName').textContent = s.siteName ? `${s.siteName} · v${s.version}` : `v${s.version}`;
  const pill = $('statusPill');
  pill.classList.remove('ok', 'warn', 'bad');
  if (!s.setupDone) { pill.classList.add('warn'); $('statusText').textContent = 'Falta configurar'; }
  else if (s.running) { pill.classList.add('ok'); $('statusText').textContent = `Host corriendo · ${s.mode === 'primary' ? 'principal' : 'equipo de respaldo'}`; }
  else if (s.starting) { pill.classList.add('warn'); $('statusText').textContent = 'Arrancando…'; }
  else { pill.classList.add('bad'); $('statusText').textContent = 'Host detenido'; }
  ($('btnOpenPanel') as HTMLButtonElement).disabled = !s.running;

  const mb = $('modeBadge');
  mb.textContent = s.mode === 'primary' ? 'Principal' : 'Equipo de respaldo';
  mb.className = `badge ${s.mode === 'primary' ? 'blue' : 'red'}`;
  const he = $('hostError');
  he.classList.toggle('hidden', !s.hostError);
  he.textContent = s.hostError ?? '';

  const urls = $('urls');
  urls.innerHTML = '';
  s.urls.forEach((u, i) => { const d = document.createElement('div'); d.textContent = u; if (i === 0) d.className = 'main-url'; urls.appendChild(d); });
  if (!s.lanIps.length) { const d = document.createElement('div'); d.className = 'muted small'; d.textContent = 'Sin red: conecta el equipo a la red del coliseo para que los scanners lo vean.'; urls.appendChild(d); }
  $('eventName').textContent = s.event ? s.event.name : 'Sin evento';
  $('eventDates').textContent = s.event ? `${fmtDate(s.event.startDate)} – ${fmtDate(s.event.endDate)} · ${s.event.configPath || 'config de la carpeta de datos'}` : '';
  $('counts').textContent = s.running ? `${s.counts.credentials} credenciales · ${s.counts.scans} escaneos · ${s.counts.persons} personas` : '';
  $('standbyBox').classList.toggle('hidden', s.mode !== 'standby');
  $('replicaMsg').textContent = s.replica.message;

  const zone = $<HTMLSelectElement>('enrollZone');
  const zones = s.event?.zones ?? [];
  if (zone.options.length !== zones.length || [...zone.options].some((o, i) => o.value !== zones[i]?.code)) {
    zone.innerHTML = '';
    for (const z of zones) { const o = document.createElement('option'); o.value = z.code; o.textContent = `${z.name} (${z.code})`; zone.appendChild(o); }
  }

  const list = $('devices');
  list.innerHTML = '';
  if (!s.devices.length) list.innerHTML = '<li class="empty">Todavía no hay scanners enrolados. Genera un código a la izquierda.</li>';
  for (const d of s.devices) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="d ${d.online ? 'on' : ''}"></span><span>${esc(d.name)} <span class="muted">· ${esc(d.zone)} · ${d.role === 'SUPERVISOR' ? 'Supervisor' : 'Control'}${d.disabled ? ' · desactivado' : ''}</span></span><span class="muted small">${d.online ? 'conectado' : d.lastSeenAt ? `visto ${ago(d.lastSeenAt)}` : 'nunca conectado'}</span><span class="pend ${d.pending > 0 ? 'warn' : ''}">${d.pending} pend.</span>`;
    list.appendChild(li);
  }
  const online = s.devices.filter((d) => d.online).length;
  $('devicesSummary').textContent = `${online} conectado${online === 1 ? '' : 's'} · ${s.pendingTotal} pendiente${s.pendingTotal === 1 ? '' : 's'} · Radio: ${s.radioConnected ?? 0} equipo${s.radioConnected === 1 ? '' : 's'} conectado${s.radioConnected === 1 ? '' : 's'}`;

  $('backupLast').textContent = s.backups.lastBackupAt ? `Última copia ${ago(s.backups.lastBackupAt)} (${s.backups.count} guardadas)` : 'Todavía no hay copias';
  $('backupDirs').textContent = `${s.backups.dir || '—'}${s.backups.dir2 ? ` · USB: ${s.backups.dir2} ${s.backups.dir2Available ? (s.backups.lastBackup2At ? `(última ${ago(s.backups.lastBackup2At)})` : '') : '(no conectada)'}` : ''}${s.backups.lastBackup2Error ? ` · Falló el segundo destino: ${s.backups.lastBackup2Error}` : ''}`;
  ($('btnBackupNow') as HTMLButtonElement).disabled = !s.running || s.mode !== 'primary';
  ($('btnBackupUsb') as HTMLButtonElement).disabled = !s.running;

  $('cloudLast').textContent = s.cloud.configured ? `Última actualización ${ago(s.cloud.lastCloudSyncAt)}${s.cloud.intervalMinutes > 0 ? ` · cada ${s.cloud.intervalMinutes} min` : ' · solo manual'}` : 'Sin nube configurada';
  $('cloudMsg').textContent = s.cloud.configured ? `${s.cloud.url} · ${s.cloud.message}` : 'Opcional: pon la dirección y la clave en Ajustes para traer inscripciones aprobadas.';
  ($('btnCloudPull') as HTMLButtonElement).disabled = !s.running || !s.cloud.configured || s.mode !== 'primary';

  const hb = $('httpsBadge');
  if (!s.https.enabled) { hb.textContent = 'Desactivado'; hb.className = 'badge'; $('httpsMsg').textContent = 'Los scanners usan http://. Actívalo en Ajustes para tener candado y cámara sin avisos.'; }
  else if (s.https.running) { hb.textContent = 'Activo'; hb.className = 'badge green'; $('httpsMsg').textContent = `Caddy sirve https en el puerto ${s.https.port}. Instala el certificado raíz en cada celular una sola vez.`; }
  else { hb.textContent = s.https.binaryFound ? 'Arrancando' : 'No disponible'; hb.className = 'badge red'; $('httpsMsg').textContent = s.https.error ?? 'Esperando a Caddy…'; }
  ($('btnExportCert') as HTMLButtonElement).disabled = !s.https.rootCertAvailable;

  $('passInfo').textContent = s.passphraseStorage === 'safeStorage' ? 'Guardada en el llavero del sistema.' : s.passphraseStorage === 'plain' ? 'Guardada en el disco: este equipo no tiene llavero disponible. Protege la carpeta de datos.' : 'Todavía no hay passphrase.';
  $('wizard').classList.toggle('hidden', s.setupDone);
}

function esc(t: string): string { return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c); }

// ---------- logs ----------
function appendLog(line: string): void {
  const pre = $('logs');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
  pre.textContent += (pre.textContent ? '\n' : '') + line;
  const lines = pre.textContent.split('\n');
  if (lines.length > 200) pre.textContent = lines.slice(-200).join('\n');
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

// ---------- enrolamiento ----------
function showEnrollment(r: EnrollResult): void {
  $('qrBox').innerHTML = `<img alt="Código QR de enrolamiento" src="${r.qrDataUrl}" />`;
  $('enrollToken').textContent = `Si no puede leer el QR: dirección ${r.hostUrl} y código ${r.token}`;
  clearInterval(enrollTimer);
  const tick = () => {
    const left = Math.round((Date.parse(r.expiresAt) - Date.now()) / 1000);
    if (left <= 0) { $('enrollExpires').textContent = 'El código caducó: genera otro.'; clearInterval(enrollTimer); $('qrBox').innerHTML = '<div class="qr-empty">El código caducó. Genera uno nuevo.</div>'; return; }
    $('enrollExpires').textContent = `Caduca en ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  enrollTimer = window.setInterval(tick, 1000);
}

// ---------- ajustes ----------
function fillSettings(s: Settings): void {
  const f = $<HTMLFormElement>('settingsForm');
  for (const [k, v] of Object.entries(s)) {
    const el = f.elements.namedItem(k) as HTMLInputElement | null;
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = String(v);
  }
}
function readSettings(): Partial<Settings> {
  const f = $<HTMLFormElement>('settingsForm');
  const g = (k: string) => (f.elements.namedItem(k) as HTMLInputElement);
  return {
    siteName: g('siteName').value, port: Number(g('port').value), mode: g('mode').value as Settings['mode'], primaryUrl: g('primaryUrl').value, replicaKey: g('replicaKey').value,
    backupsDir2: g('backupsDir2').value, cloudUrl: g('cloudUrl').value, cloudKey: g('cloudKey').value, cloudIntervalMinutes: Number(g('cloudIntervalMinutes').value),
    eventConfigPath: g('eventConfigPath').value, httpsEnabled: g('httpsEnabled').checked, httpsPort: Number(g('httpsPort').value), launchAtLogin: g('launchAtLogin').checked
  };
}

// ---------- asistente ----------
let wStep = 1;
function showStep(n: number): void {
  wStep = n;
  document.querySelectorAll<HTMLElement>('.wizard .step').forEach((el) => el.classList.toggle('hidden', Number(el.dataset.step) !== n));
  $('wizardStep').textContent = `Paso ${n} de 4`;
  ($('wBack') as HTMLButtonElement).disabled = n === 1;
  $('wNext').textContent = n === 4 ? 'Terminar' : 'Siguiente';
  $('wError').textContent = '';
}
function wizardValidate(n: number): string | null {
  if (n === 1) {
    if (!$<HTMLInputElement>('wSite').value.trim()) return 'Ponle un nombre a la sede.';
    if ($<HTMLSelectElement>('wMode').value === 'standby' && !$<HTMLInputElement>('wPrimaryUrl').value.trim()) return 'Como equipo de respaldo necesitas la dirección del principal.';
  }
  if (n === 2) {
    const a = $<HTMLInputElement>('wPass').value, b = $<HTMLInputElement>('wPass2').value;
    if (a.length < 8) return 'La passphrase debe tener al menos 8 caracteres (mejor 20 o más).';
    if (a !== b) return 'Las dos passphrases no coinciden.';
  }
  if (n === 3) {
    const src = (document.querySelector('input[name=wSource]:checked') as HTMLInputElement).value;
    if (src === 'file' && !$<HTMLInputElement>('wEventPath').value) return 'Elige el archivo event.config.json o usa el evento de demo.';
  }
  return null;
}

// ---------- cableado ----------
function wire(): void {
  $('btnOpenPanel').onclick = () => void tp.openPanel();
  $('btnOpenData').onclick = () => { if (state) void tp.openPath(state.dataDir); };
  $('btnChangeEvent').onclick = (e) => void act(e.currentTarget as HTMLButtonElement, () => tp.changeEventFile());
  $('btnBackupNow').onclick = (e) => void act(e.currentTarget as HTMLButtonElement, () => tp.backupNow());
  $('btnBackupUsb').onclick = (e) => void act(e.currentTarget as HTMLButtonElement, () => tp.backupToUsb());
  $('btnCloudPull').onclick = (e) => void act(e.currentTarget as HTMLButtonElement, () => tp.cloudPullNow());
  $('btnExportCert').onclick = (e) => void act(e.currentTarget as HTMLButtonElement, () => tp.exportRootCert());
  $('btnCertHelp').onclick = () => $('certHelp').classList.toggle('hidden');

  $<HTMLFormElement>('enrollForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const fd = new FormData(f);
    $('enrollError').textContent = '';
    const r = await tp.createEnrollment({ name: String(fd.get('name') ?? ''), zone: String(fd.get('zone') ?? ''), role: (fd.get('role') as 'CONTROL' | 'SUPERVISOR') ?? 'CONTROL' });
    if ('error' in r) { $('enrollError').textContent = r.error; return; }
    showEnrollment(r);
  };

  // promover (2 pasos)
  let promoteStep: 1 | 2 = 1;
  const pm = $('promoteModal');
  $('btnPromote').onclick = () => { promoteStep = 1; $('promoteText').innerHTML = 'Paso 1 de 2: ¿el principal no responde? Si responde, no promuevas: habría dos fuentes de verdad. Escribe <strong>SI</strong> para seguir.'; $<HTMLInputElement>('promoteInput').value = ''; $('promoteError').textContent = ''; pm.classList.remove('hidden'); $('promoteInput').focus(); };
  $('promoteCancel').onclick = () => pm.classList.add('hidden');
  $('promoteOk').onclick = async () => {
    const r = await tp.promote(promoteStep, $<HTMLInputElement>('promoteInput').value);
    if (!r.ok) { $('promoteError').textContent = r.message; return; }
    if (promoteStep === 1) { promoteStep = 2; $('promoteText').innerHTML = `${esc(r.message)} Escribe <strong>PROMOVER</strong>.`; $<HTMLInputElement>('promoteInput').value = ''; $('promoteError').textContent = ''; return; }
    pm.classList.add('hidden');
    toast(r.message);
  };

  // ajustes
  const sm = $('settingsModal');
  $('btnSettings').onclick = async () => { fillSettings(await tp.getSettings()); $('settingsError').textContent = ''; sm.classList.remove('hidden'); };
  $('settingsCancel').onclick = () => sm.classList.add('hidden');
  $('pickBackups2').onclick = async () => { const d = await tp.chooseFolder('Carpeta de copias secundaria (USB)'); if (d) ($<HTMLFormElement>('settingsForm').elements.namedItem('backupsDir2') as HTMLInputElement).value = d; };
  $('pickEvent').onclick = async () => { const f = await tp.chooseFile('Archivo event.config.json'); if (f) ($<HTMLFormElement>('settingsForm').elements.namedItem('eventConfigPath') as HTMLInputElement).value = f; };
  $<HTMLFormElement>('settingsForm').onsubmit = async (e) => {
    e.preventDefault();
    const r = await tp.saveSettings(readSettings());
    if (!r.ok) { $('settingsError').textContent = r.errors.map((x) => x.message).join(' '); return; }
    sm.classList.add('hidden');
    toast(r.restarted ? 'Ajustes guardados. El host se reinició para aplicarlos.' : 'Ajustes guardados.');
  };
  $('btnSetPass').onclick = (e) => void act(e.currentTarget as HTMLButtonElement, async () => { const r = await tp.setPassphrase($<HTMLInputElement>('passInput').value); if (r.ok) $<HTMLInputElement>('passInput').value = ''; return r; });
  $('btnRestart').onclick = (e) => void act(e.currentTarget as HTMLButtonElement, () => tp.restartHost());

  // asistente
  $<HTMLSelectElement>('wMode').onchange = (e) => $('wStandby').classList.toggle('hidden', (e.currentTarget as HTMLSelectElement).value !== 'standby');
  $('wPickEvent').onclick = async () => { const f = await tp.chooseFile('Archivo event.config.json'); if (f) { $<HTMLInputElement>('wEventPath').value = f; (document.querySelector('input[name=wSource][value=file]') as HTMLInputElement).checked = true; } };
  $('wPickBackups').onclick = async () => { const d = await tp.chooseFolder('Carpeta de la USB para copias'); if (d) $<HTMLInputElement>('wBackups2').value = d; };
  $('wClearBackups').onclick = () => { $<HTMLInputElement>('wBackups2').value = ''; };
  $('wBack').onclick = () => showStep(Math.max(1, wStep - 1));
  $('wNext').onclick = async () => {
    const err = wizardValidate(wStep);
    if (err) { $('wError').textContent = err; return; }
    if (wStep < 4) { showStep(wStep + 1); return; }
    const btn = $('wNext') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Preparando…';
    const r = await tp.runSetup({
      siteName: $<HTMLInputElement>('wSite').value, mode: $<HTMLSelectElement>('wMode').value as Settings['mode'], primaryUrl: $<HTMLInputElement>('wPrimaryUrl').value, replicaKey: $<HTMLInputElement>('wReplicaKey').value,
      passphrase: $<HTMLInputElement>('wPass').value, eventSource: (document.querySelector('input[name=wSource]:checked') as HTMLInputElement).value as 'demo' | 'file', eventConfigPath: $<HTMLInputElement>('wEventPath').value, backupsDir2: $<HTMLInputElement>('wBackups2').value
    });
    btn.disabled = false; btn.textContent = 'Terminar';
    if (!r.ok) { $('wError').textContent = r.errors.map((x) => x.message).join(' '); return; }
    toast(r.message ?? 'Listo.');
  };
  showStep(1);
}

async function boot(): Promise<void> {
  wire();
  tp.onState(render);
  tp.onLog(appendLog);
  render(await tp.getState());
  for (const l of await tp.getLogs()) appendLog(l);
  setInterval(() => { if (state) render(state); }, 15000);
}

void boot();
