/** Sesiones y usuarios del host (admin crea, desactiva y resetea contraseñas). */
import { USER_ROLES, type UserRole } from '../auth.js';
import type { RouteModule } from './shared.js';

export const registerAuthRoutes: RouteModule = (app, ctx, g) => {
  /** Inicia sesión con usuario y contraseña; devuelve el token de sesión (Bearer) y el modo del host. */
  app.post<{ Body: { username: string; password: string } }>('/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) return reply.code(400).send({ error: 'Faltan usuario o contraseña.' });
    const res = ctx.users.login(username, password);
    if (!res) return reply.code(401).send({ error: 'Usuario o contraseña incorrectos.' });
    g.audit(res.user.username, 'LOGIN', { userId: res.user.id });
    return { ...res, mode: ctx.mode };
  });
  /** Usuario de la sesión actual y modo del host (primary/standby). */
  app.get('/auth/me', { preHandler: g.requireUser(g.allRoles) }, async (req) => ({ user: req.user, mode: ctx.mode }));
  /** Cierra la sesión del token actual. */
  app.post('/auth/logout', { preHandler: g.requireUser(g.allRoles) }, async (req) => {
    const h = req.headers.authorization ?? '';
    ctx.users.logout(h.slice(7).trim());
    return { ok: true };
  });

  /** Lista de usuarios del host (sin contraseñas). */
  app.get('/users', { preHandler: g.requireUser(['ADMIN']) }, async () => ctx.users.all());
  /** Crea un usuario con rol (y club opcional). Contraseña mínima de 8 caracteres. */
  app.post<{ Body: { username: string; password: string; role: UserRole; club?: string } }>('/users', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    const { username, password, role, club } = req.body ?? {};
    if (!username?.trim() || !password || !role) return reply.code(400).send({ error: 'Faltan usuario, contraseña o rol.' });
    if (!/^[a-z0-9._-]{3,32}$/i.test(username.trim())) return reply.code(400).send({ error: 'El usuario admite letras, números, punto, guion y guion bajo (3 a 32 caracteres).' });
    if (password.length < 8) return reply.code(400).send({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (!USER_ROLES.includes(role)) return reply.code(400).send({ error: 'Rol desconocido.' });
    if (ctx.users.findByUsername(username.trim())) return reply.code(409).send({ error: 'Ya existe un usuario con ese nombre.' });
    const u = ctx.users.create(username.trim(), password, role, club?.trim() || undefined);
    g.audit(req.user!.username, 'USER_CREATED', { userId: u.id, username: u.username, role });
    return u;
  });
  /** Desactiva (o reactiva con `disabled:false`) un usuario y cierra sus sesiones. No permite desactivarse a sí mismo. */
  app.post<{ Params: { id: string }; Body: { disabled?: boolean } }>('/users/:id/disable', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    const u = ctx.users.byId(req.params.id);
    if (!u) return reply.code(404).send({ error: 'Usuario no encontrado.' });
    const disabled = req.body?.disabled ?? true;
    if (u.id === req.user!.id && disabled) return reply.code(400).send({ error: 'No puedes desactivar tu propio usuario.' });
    ctx.users.setDisabled(u.id, disabled);
    g.audit(req.user!.username, disabled ? 'USER_DISABLED' : 'USER_ENABLED', { userId: u.id, username: u.username });
    return ctx.users.byId(u.id);
  });
  /** Cambia la contraseña de un usuario. */
  app.post<{ Params: { id: string }; Body: { password: string } }>('/users/:id/reset-password', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    const u = ctx.users.byId(req.params.id);
    if (!u) return reply.code(404).send({ error: 'Usuario no encontrado.' });
    const password = req.body?.password ?? '';
    if (password.length < 8) return reply.code(400).send({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    ctx.users.resetPassword(u.id, password);
    g.audit(req.user!.username, 'USER_PASSWORD_RESET', { userId: u.id, username: u.username });
    return { ok: true };
  });
};
