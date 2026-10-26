/** Scanners: código de enrolamiento (QR + texto), enrolar, cambiar zona, desactivar. */
import type { Device } from '@tatami/core';
import { READERS, type RouteModule } from './shared.js';

export const registerDeviceRoutes: RouteModule = (app, ctx, g) => {
  /** Genera un código de enrolamiento (caduca en 10 min) para un scanner con nombre, zona y rol Control/Supervisor. Devuelve también el JSON para el QR. */
  app.post<{ Body: { name: string; zone: string; role?: Device['role'] } }>('/devices/enroll-token', { preHandler: g.requireUser(['ADMIN', 'SUPERVISOR']) }, async (req, reply) => {
    const { name, zone, role = 'CONTROL' } = req.body ?? {};
    if (!name?.trim() || !zone) return reply.code(400).send({ error: 'Faltan nombre o zona.' });
    if (!ctx.config.zones.some((z) => z.code === zone)) return reply.code(400).send({ error: `Zona desconocida: ${zone}` });
    if (role !== 'CONTROL' && role !== 'SUPERVISOR') return reply.code(400).send({ error: 'El rol del scanner es Control o Supervisor.' });
    const t = ctx.devices.createEnrollToken({ name: name.trim(), zone, role });
    g.audit(req.user!.username, 'ENROLL_TOKEN_CREATED', { name, zone, role, expiresAt: t.expiresAt });
    const url = g.hostUrl(req);
    return { ...t, hostUrl: url, qr: JSON.stringify({ hostUrl: url, token: t.token }) };
  });

  /** Enrola un scanner con el código y un PIN de 6 dígitos; devuelve `deviceToken`. Sin sesión: lo llama el propio scanner. */
  app.post<{ Body: { token: string; pin: string } }>('/devices/enroll', async (req, reply) => {
    const { token, pin } = req.body ?? {};
    if (!token || !/^\d{6}$/.test(pin ?? '')) return reply.code(400).send({ error: 'Token y PIN de 6 dígitos son obligatorios.' });
    const dev = ctx.devices.enroll(token, pin);
    if (!dev) return reply.code(400).send({ error: 'El código de enrolamiento no es válido o ya caducó. Pide uno nuevo al supervisor.' });
    g.audit('system', 'DEVICE_ENROLLED', { deviceId: dev.id, name: dev.name, zone: dev.zone, role: dev.role });
    return { deviceId: dev.id, deviceToken: dev.token, name: dev.name, zone: dev.zone, role: dev.role, enrolledAt: dev.enrolledAt };
  });

  /** Lista de scanners enrolados con zona, último seq, pendientes y estado. */
  app.get('/devices', { preHandler: g.requireUser(READERS) }, async () => ctx.devices.all());

  /** Cambia la zona o el nombre de un scanner. */
  app.patch<{ Params: { id: string }; Body: { zone?: string; name?: string } }>('/devices/:id', { preHandler: g.requireUser(['ADMIN', 'SUPERVISOR']) }, async (req, reply) => {
    const d = ctx.devices.byId(req.params.id);
    if (!d) return reply.code(404).send({ error: 'Dispositivo no encontrado.' });
    const zone = req.body?.zone;
    const name = req.body?.name?.trim();
    if (!zone && !name) return reply.code(400).send({ error: 'Indica la zona o el nombre nuevo.' });
    if (zone) {
      if (!ctx.config.zones.some((z) => z.code === zone)) return reply.code(400).send({ error: 'Zona desconocida.' });
      ctx.devices.setZone(d.id, zone);
      g.audit(req.user!.username, 'DEVICE_ZONE_CHANGED', { deviceId: d.id, from: d.zone, to: zone });
    }
    if (name && name !== d.name) {
      ctx.devices.rename(d.id, name);
      g.audit(req.user!.username, 'DEVICE_RENAMED', { deviceId: d.id, from: d.name, to: name });
    }
    const { token: _t, ...view } = ctx.devices.byId(d.id)!;
    return view;
  });

  /** Desactiva (o reactiva) un scanner; desde ese momento recibe 401. */
  app.post<{ Params: { id: string }; Body: { disabled?: boolean } }>('/devices/:id/disable', { preHandler: g.requireUser(['ADMIN', 'SUPERVISOR']) }, async (req, reply) => {
    const d = ctx.devices.byId(req.params.id);
    if (!d) return reply.code(404).send({ error: 'Dispositivo no encontrado.' });
    const disabled = req.body?.disabled ?? true;
    ctx.devices.setDisabled(d.id, disabled);
    g.audit(req.user!.username, disabled ? 'DEVICE_DISABLED' : 'DEVICE_ENABLED', { deviceId: d.id, name: d.name });
    const { token: _t, ...view } = ctx.devices.byId(d.id)!;
    return view;
  });
};
