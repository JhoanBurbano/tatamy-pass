/**
 * KPIs en vivo del panel y reporte de cierre del día.
 * Todo se calcula a partir de scan_events (hechos) en la zona horaria del evento.
 */
import type { EventConfig, ScanEvent } from '@tatami/core';
import type { AppContext } from './server.js';

const DAY_MS = 86_400_000;

/** Fecha local (AAAA-MM-DD) del evento para un instante ISO. */
export function localDate(iso: string | number, utcOffsetMinutes: number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return new Date(t + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Rango UTC [desde, hasta) que cubre el día local `date`. */
export function dayRange(date: string, utcOffsetMinutes: number): { from: string; to: string } {
  const start = Date.parse(`${date}T00:00:00.000Z`) - utcOffsetMinutes * 60_000;
  return { from: new Date(start).toISOString(), to: new Date(start + DAY_MS).toISOString() };
}

const isEntry = (e: ScanEvent) => e.decision === 'ALLOW' && e.direction === 'IN';
const isExit = (e: ScanEvent) => e.decision === 'ALLOW' && e.direction === 'OUT';

/** Personas dentro por zona = entradas − salidas permitidas (solo zonas que controlan salida tienen sentido; se devuelven todas). */
export function insideByZone(events: ScanEvent[], config: EventConfig): Record<string, number> {
  const inside: Record<string, number> = {};
  for (const z of config.zones) inside[z.code] = 0;
  for (const e of events) {
    if (isEntry(e)) inside[e.zone] = (inside[e.zone] ?? 0) + 1;
    else if (isExit(e)) inside[e.zone] = (inside[e.zone] ?? 0) - 1;
  }
  for (const k of Object.keys(inside)) if (inside[k] < 0) inside[k] = 0;
  return inside;
}

export interface GateRow {
  deviceId: string; name: string; zone: string; zoneName: string; role: string;
  ratePerMin: number; today: number; denied: number; lastScanAt: string | null; lastSeenAt: string | null;
  pending: number; status: 'ok' | 'warn' | 'off' | 'disabled'; statusText: string;
}

export interface LiveSnapshot {
  at: string; date: string;
  kpis: { entriesToday: number; accredited: number; ratePerMin: number; peakRatePerMin: number; peakAt: string | null; pendingTotal: number; pendingDevices: number; openAlerts: number; devicesOnline: number; devicesOffline: number };
  gates: GateRow[];
  insideByZone: Array<{ code: string; name: string; inside: number; tracksExit: boolean }>;
  recent: ScanEvent[];
}

export function liveSnapshot(ctx: AppContext, now = Date.now()): LiveSnapshot {
  const { config } = ctx;
  const date = localDate(now, config.utcOffsetMinutes);
  const { from, to } = dayRange(date, config.utcOffsetMinutes);
  const todays = ctx.scans.between(from, to);
  const devices = ctx.devices.all();
  const lastByDevice = ctx.scans.lastByDevice();
  const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
  const oneMinAgo = new Date(now - 60_000).toISOString();

  // ritmo por dispositivo (últimos 5 min) y global (último minuto)
  const perDevice5 = new Map<string, number>();
  const perDeviceToday = new Map<string, number>();
  const perDeviceDenied = new Map<string, number>();
  const perMinute = new Map<string, number>();
  let entriesToday = 0, lastMinute = 0;
  for (const e of todays) {
    if (isEntry(e)) {
      entriesToday++;
      perDeviceToday.set(e.deviceId, (perDeviceToday.get(e.deviceId) ?? 0) + 1);
      if (e.at >= fiveMinAgo) perDevice5.set(e.deviceId, (perDevice5.get(e.deviceId) ?? 0) + 1);
      if (e.at >= oneMinAgo) lastMinute++;
      const minute = e.at.slice(0, 16);
      perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
    } else if (e.decision === 'DENY') {
      perDeviceDenied.set(e.deviceId, (perDeviceDenied.get(e.deviceId) ?? 0) + 1);
    }
  }
  let peakRatePerMin = 0, peakAt: string | null = null;
  for (const [m, n] of perMinute) if (n > peakRatePerMin) { peakRatePerMin = n; peakAt = `${m}:00.000Z`; }

  const zoneName = (z: string) => config.zones.find((x) => x.code === z)?.name ?? z;
  const gates: GateRow[] = devices.map((d) => {
    const lastSeen = d.lastSeenAt ? Date.parse(d.lastSeenAt) : null;
    const silent = lastSeen === null ? Infinity : now - lastSeen;
    let status: GateRow['status'] = 'ok';
    let statusText = 'Conectado';
    if (d.disabledAt) { status = 'disabled'; statusText = 'Desactivado'; }
    else if (silent > 5 * 60_000) { status = 'off'; statusText = lastSeen === null ? 'Nunca se ha conectado' : `Sin conexión hace ${Math.round(silent / 60_000)} min`; }
    else if (silent > 60_000) { status = 'warn'; statusText = `Sin reportar hace ${Math.round(silent / 60_000)} min`; }
    else if (d.pendingCount > 0) { status = 'warn'; statusText = `${d.pendingCount} pendientes por enviar`; }
    return {
      deviceId: d.id, name: d.name, zone: d.zone, zoneName: zoneName(d.zone), role: d.role,
      ratePerMin: Math.round(((perDevice5.get(d.id) ?? 0) / 5) * 10) / 10, today: perDeviceToday.get(d.id) ?? 0, denied: perDeviceDenied.get(d.id) ?? 0,
      lastScanAt: lastByDevice[d.id] ?? null, lastSeenAt: d.lastSeenAt ?? null, pending: d.pendingCount, status, statusText
    };
  });

  const inside = insideByZone(ctx.scans.between(from, to), config);
  const active = gates.filter((g) => g.status !== 'disabled');
  return {
    at: new Date(now).toISOString(), date,
    kpis: {
      entriesToday, accredited: ctx.credentials.count(), ratePerMin: lastMinute, peakRatePerMin, peakAt,
      pendingTotal: active.reduce((s, g) => s + g.pending, 0), pendingDevices: active.filter((g) => g.pending > 0).length,
      openAlerts: ctx.alerts.countOpen(), devicesOnline: active.filter((g) => g.status === 'ok' || g.status === 'warn').length, devicesOffline: active.filter((g) => g.status === 'off').length
    },
    gates,
    insideByZone: config.zones.map((z) => ({ code: z.code, name: z.name, inside: inside[z.code] ?? 0, tracksExit: z.tracksExit })),
    recent: todays.slice(-20).reverse()
  };
}

export interface DayCloseReport {
  date: string; generatedAt: string; event: string;
  totals: { scans: number; entries: number; exits: number; denied: number; alerts: number; manual: number };
  byGate: Array<{ deviceId: string; name: string; zone: string; entries: number; exits: number; denied: number; manual: number; alerts: number }>;
  byRole: Array<{ roleCode: string; name: string; accredited: number; entered: number; uniquePersons: number }>;
  byReason: Record<string, number>;
  insideAtClose: Array<{ code: string; name: string; inside: number }>;
  alerts: { open: number; byKind: Record<string, number> };
  manualEntries: Array<{ at: string; credentialId: string | null; device: string; zone: string; reason: string; by: string }>;
}

export function dayCloseReport(ctx: AppContext, date?: string, now = Date.now()): DayCloseReport {
  const { config } = ctx;
  const d = date ?? localDate(now, config.utcOffsetMinutes);
  const { from, to } = dayRange(d, config.utcOffsetMinutes);
  const events = ctx.scans.between(from, to);
  const devices = ctx.devices.all();
  const devName = (id: string) => devices.find((x) => x.id === id)?.name ?? id;
  const roleOf = new Map<string, string>();
  for (const c of ctx.credentials.all()) roleOf.set(c.id, c.roleCode);
  const accredited = ctx.credentials.countByRole();

  const gate = new Map<string, DayCloseReport['byGate'][number]>();
  const role = new Map<string, { entered: number; persons: Set<string> }>();
  const byReason: Record<string, number> = {};
  const totals = { scans: events.length, entries: 0, exits: 0, denied: 0, alerts: 0, manual: 0 };
  const manualEntries: DayCloseReport['manualEntries'] = [];
  for (const e of events) {
    const g = gate.get(e.deviceId) ?? { deviceId: e.deviceId, name: devName(e.deviceId), zone: e.zone, entries: 0, exits: 0, denied: 0, manual: 0, alerts: 0 };
    byReason[e.reasonCode] = (byReason[e.reasonCode] ?? 0) + 1;
    if (isEntry(e)) {
      totals.entries++; g.entries++;
      const r = e.credentialId ? roleOf.get(e.credentialId) : undefined;
      if (r) { const x = role.get(r) ?? { entered: 0, persons: new Set() }; x.entered++; x.persons.add(e.credentialId!); role.set(r, x); }
    } else if (isExit(e)) { totals.exits++; g.exits++; }
    else if (e.decision === 'DENY') { totals.denied++; g.denied++; }
    if (e.decision === 'ALERT') { totals.alerts++; g.alerts++; }
    if (e.manual || e.reasonCode === 'OK_MANUAL') {
      totals.manual++; g.manual++;
      manualEntries.push({ at: e.at, credentialId: e.credentialId, device: g.name, zone: e.zone, reason: e.manual?.reason ?? '', by: e.manual?.by ?? '' });
    }
    gate.set(e.deviceId, g);
  }
  const inside = insideByZone(events, config);
  return {
    date: d, generatedAt: new Date(now).toISOString(), event: config.name, totals,
    byGate: [...gate.values()].sort((a, b) => a.name.localeCompare(b.name)),
    byRole: config.roles.map((r) => ({ roleCode: r.code, name: r.name, accredited: accredited[r.code] ?? 0, entered: role.get(r.code)?.entered ?? 0, uniquePersons: role.get(r.code)?.persons.size ?? 0 })),
    byReason,
    insideAtClose: config.zones.filter((z) => z.tracksExit).map((z) => ({ code: z.code, name: z.name, inside: inside[z.code] ?? 0 })),
    alerts: { open: ctx.alerts.countOpen(), byKind: ctx.alerts.countByKind(from, to) },
    manualEntries
  };
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return columns ? columns.join(',') + '\n' : '';
  const cols = columns ?? Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n') + '\n';
}

/** CSV del cierre: varias secciones separadas por una línea vacía. */
export function dayCloseCsv(r: DayCloseReport): string {
  const parts = [
    `# Cierre del día,${r.date},${r.event},generado,${r.generatedAt}`,
    toCsv([{ seccion: 'totales', ...r.totals }]),
    toCsv(r.byGate.map((g) => ({ seccion: 'puerta', ...g }))),
    toCsv(r.byRole.map((x) => ({ seccion: 'rol', ...x }))),
    toCsv(r.insideAtClose.map((x) => ({ seccion: 'dentro_al_cierre', ...x }))),
    toCsv(Object.entries(r.byReason).map(([reasonCode, n]) => ({ seccion: 'motivo', reasonCode, n }))),
    toCsv(r.manualEntries.map((m) => ({ seccion: 'ingreso_manual', ...m })), ['seccion', 'at', 'credentialId', 'device', 'zone', 'reason', 'by'])
  ];
  return parts.join('\n');
}
