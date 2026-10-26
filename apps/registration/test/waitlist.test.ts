import { describe, expect, it } from 'vitest';
import { adult, memoryRepos, register, testConfig } from './helpers';
import { memorySender } from '../lib/mail';
import { confirmOffer, expireOffers, releaseSlot } from '../lib/waitlist';

const cfg = testConfig({ roles: testConfig().roles.map((r) => (r.code === 'COMP' ? { ...r, capacity: 1 } : r)) });

async function setup() {
  const repos = await memoryRepos();
  const mail = memorySender();
  await register(repos, adult({ firstName: 'Primera', email: 'p@x.com' }), cfg);
  await register(repos, adult({ firstName: 'Segunda', email: 's@x.com', acceptWaitlist: true }), cfg);
  await register(repos, adult({ firstName: 'Tercera', email: 't@x.com', acceptWaitlist: true, companions: [{ name: 'Mamá Tercera' }] }), cfg);
  return { repos, mail, deps: { repos, config: cfg, sendMail: mail } };
}

describe('lista de espera', () => {
  it('liberar cupo ofrece al primero por orden de llegada con enlace de 48 h', async () => {
    const { repos, mail, deps } = await setup();
    const now = new Date('2026-10-13T10:00:00.000Z');
    const res = await releaseSlot({ ...deps, now: () => now }, { roleCode: 'COMP' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.offered.firstName).toBe('Segunda');
    expect(res.expiresAt).toBe('2026-10-15T10:00:00.000Z');
    expect(mail.sent[0].to).toBe('s@x.com');
    expect(mail.sent[0].text).toContain(`/confirmar/${res.offered.offerToken}`);
    expect((await repos.registrations.waitlist({ roleCode: 'COMP' })).map((r) => r.status)).toEqual(['OFFERED', 'WAITLIST']);
    // la oferta reserva el cupo
    expect((await repos.registrations.countByRole()).COMP).toBe(2);
  });

  it('confirmar dentro del plazo pasa a pendiente; el enlace deja de servir', async () => {
    const { repos, deps } = await setup();
    const res = await releaseSlot(deps, { roleCode: 'COMP' });
    if (!res.ok) throw new Error('sin oferta');
    const c = await confirmOffer({ repos }, res.offered.offerToken!);
    expect(c.ok && c.registration.status).toBe('PENDING');
    expect((await confirmOffer({ repos }, res.offered.offerToken!)).ok).toBe(false);
    expect((await confirmOffer({ repos }, 'otro-token')).ok).toBe(false);
  });

  it('oferta vencida → EXPIRED y el cupo pasa al siguiente (con sus acompañantes)', async () => {
    const { repos, mail, deps } = await setup();
    const t0 = new Date('2026-10-13T10:00:00.000Z');
    const res = await releaseSlot({ ...deps, now: () => t0 }, { roleCode: 'COMP' });
    if (!res.ok) throw new Error('sin oferta');
    const t1 = new Date('2026-10-15T10:00:01.000Z');
    expect((await confirmOffer({ repos, now: () => t1 }, res.offered.offerToken!)).ok).toBe(false);
    const sweep = await expireOffers({ ...deps, now: () => t1 });
    expect(sweep.expired.map((r) => r.firstName)).toEqual(['Segunda']);
    expect(sweep.offered.map((r) => r.firstName)).toEqual(['Tercera']);
    expect((await repos.registrations.byId(res.offered.id))!.status).toBe('EXPIRED');
    const tercera = sweep.offered[0];
    expect((await repos.registrations.companionsOf(tercera.id))[0].status).toBe('OFFERED');
    expect(mail.sent.at(-1)!.to).toBe('t@x.com');
    // nada más que vencer
    expect((await expireOffers({ ...deps, now: () => t1 })).expired).toEqual([]);
  });

  it('sin nadie en espera, o sin correo, lo dice', async () => {
    const repos = await memoryRepos();
    const mail = memorySender();
    const deps = { repos, config: cfg, sendMail: mail };
    expect(await releaseSlot(deps, { roleCode: 'COMP' })).toMatchObject({ ok: false, reason: 'EMPTY' });
    await register(repos, adult({ firstName: 'Uno', email: 'u@x.com' }), cfg);
    await register(repos, adult({ firstName: 'SinCorreo', email: undefined, acceptWaitlist: true }), cfg);
    const r = await releaseSlot(deps, { roleCode: 'COMP' });
    expect(r).toMatchObject({ ok: false, reason: 'NO_EMAIL' });
    expect((await repos.registrations.list({ status: 'PENDING' })).length).toBe(2);
  });
});
