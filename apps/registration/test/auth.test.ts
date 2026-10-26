import { describe, expect, it } from 'vitest';
import { hashPassword, passwordPolicy, verifyPassword } from '../lib/auth/password';
import { createSessionToken, readSessionToken } from '../lib/auth/session';
import { bootstrapAdmin } from '../lib/db';
import { memoryRepos } from './helpers';
import { rateLimit, resetRateLimits } from '../lib/rate-limit';

describe('contraseñas', () => {
  it('argon2id (o scrypt) hashea y verifica', async () => {
    const h = await hashPassword('secreta123');
    expect(h.startsWith('$argon2id$') || h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(h, 'secreta123')).toBe(true);
    expect(await verifyPassword(h, 'otra')).toBe(false);
    expect(await verifyPassword(undefined, 'x')).toBe(false);
  });

  it('scrypt forzado por PASSWORD_HASH convive con argon2', async () => {
    process.env.PASSWORD_HASH = 'scrypt';
    // nueva instancia del módulo para que tome la variable
    // @ts-expect-error sufijo de query para forzar una instancia nueva del módulo en vitest
    const mod = (await import('../lib/auth/password?scrypt')) as typeof import('../lib/auth/password');
    const h = await mod.hashPassword('secreta123');
    delete process.env.PASSWORD_HASH;
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(h, 'secreta123')).toBe(true);
    expect(await verifyPassword(h, 'secreta124')).toBe(false);
  });

  it('política mínima', () => {
    expect(passwordPolicy('corta1')).toBeDefined();
    expect(passwordPolicy('sinnumeros')).toBeDefined();
    expect(passwordPolicy('buena1234')).toBeUndefined();
  });
});

describe('sesiones', () => {
  it('firma y lee el JWT; rechaza tokens alterados', async () => {
    const token = await createSessionToken({ id: 'u1', email: 'a@b.c', name: 'Ana', role: 'coord' });
    const s = await readSessionToken(token);
    expect(s).toMatchObject({ id: 'u1', role: 'coord', email: 'a@b.c' });
    expect(await readSessionToken(token.slice(0, -2) + 'xx')).toBeNull();
    expect(await readSessionToken(undefined)).toBeNull();
  });

  it('expira', async () => {
    const token = await createSessionToken({ id: 'u1', email: 'a@b.c', name: 'Ana', role: 'club', delegationId: 'd1' }, -1);
    expect(await readSessionToken(token)).toBeNull();
  });
});

describe('admin inicial y login', () => {
  it('crea el admin desde ADMIN_EMAIL/ADMIN_PASSWORD solo si no hay usuarios', async () => {
    const repos = await memoryRepos();
    process.env.ADMIN_EMAIL = 'admin@tp.co'; process.env.ADMIN_PASSWORD = 'admin12345';
    await bootstrapAdmin(repos, () => undefined);
    await bootstrapAdmin(repos, () => undefined);
    delete process.env.ADMIN_EMAIL; delete process.env.ADMIN_PASSWORD;
    expect(await repos.users.count()).toBe(1);
    const u = await repos.users.byEmail('ADMIN@tp.co');
    expect(u?.role).toBe('admin');
    expect(await verifyPassword(u?.passwordHash, 'admin12345')).toBe(true);
  });
});

describe('rate limit en memoria', () => {
  it('bloquea al superar el límite y libera al pasar la ventana', () => {
    resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit('ip', 3, 60_000, t + i).ok).toBe(true);
    const blocked = rateLimit('ip', 3, 60_000, t + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimit('ip', 3, 60_000, t + 61_000).ok).toBe(true);
    expect(rateLimit('otra', 3, 60_000, t).ok).toBe(true);
  });
});
