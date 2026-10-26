import { checkRotatingWindow, formatCredentialId, generateKeyPair, verifyToken } from '@tatami/core';
import { describe, expect, it } from 'vitest';
import { approveRegistration, rejectRegistration } from '../lib/approval';
import { credentialFor, digitalInfo, rotatingQr, setSigningKeyForTests } from '../lib/digital';
import { memorySender } from '../lib/mail';
import { adult, memoryRepos, register, testConfig } from './helpers';

const key = generateKeyPair('k1');
const cfg = testConfig();

describe('credencial digital (QR rotativo)', () => {
  it('solo roles con allowsDigital; estados según aprobación, host y clave', async () => {
    const repos = await memoryRepos();
    const comp = await register(repos, adult());
    const gen = await register(repos, adult({ firstName: 'Gloria', roleCode: 'GEN', categoryCode: undefined }));
    if (!comp.ok || !gen.ok) throw new Error('fallo');
    expect(digitalInfo(comp.registration, cfg, key).state).toBe('NOT_ALLOWED');
    expect(digitalInfo(gen.registration, cfg, key).state).toBe('NOT_APPROVED');
    await repos.registrations.setStatus(gen.registration.id, 'APPROVED');
    let g = (await repos.registrations.byId(gen.registration.id))!;
    expect(digitalInfo(g, cfg, key).state).toBe('WAITING_HOST');
    await repos.registrations.setCredential(g.id, { credentialId: formatCredentialId('TP-2026', 123), status: 'ISSUED', at: new Date().toISOString(), version: 2 });
    g = (await repos.registrations.byId(g.id))!;
    expect(digitalInfo(g, cfg, null).state).toBe('NO_KEY');
    expect(digitalInfo(g, cfg, key).state).toBe('READY');
    expect(g.credentialVersion).toBe(2);
    await repos.registrations.revoke(g.id, 'perdida');
    expect(digitalInfo((await repos.registrations.byId(g.id))!, cfg, key).state).toBe('REVOKED');
  });

  it('firma un token rotativo verificable con la clave pública, con seq, rol, zonas y versión del host', async () => {
    const repos = await memoryRepos();
    const gen = await register(repos, adult({ firstName: 'Gloria', roleCode: 'GEN', categoryCode: undefined }));
    if (!gen.ok) throw new Error('fallo');
    await repos.registrations.setStatus(gen.registration.id, 'APPROVED');
    await repos.registrations.setCredential(gen.registration.id, { credentialId: formatCredentialId('TP-2026', 45), status: 'ISSUED', at: new Date().toISOString(), version: 3 });
    const g = (await repos.registrations.byId(gen.registration.id))!;
    const now = Date.UTC(2026, 10, 20, 14, 0, 0);
    const qr = rotatingQr(g, cfg, now, key)!;
    expect(qr.windowSeconds).toBe(60);
    const v = verifyToken(qr.token, [{ kid: 'k1', publicKeyHex: key.publicKeyHex }]);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload).toMatchObject({ e: cfg.eventId, c: '00045', r: 'GEN', z: ['G'], n: 3, k: 'k1', f: cfg.startDate, t: cfg.endDate });
    expect(checkRotatingWindow(v.payload, now)).toBe('VALID');
    expect(checkRotatingWindow(v.payload, now + 7 * 60_000)).toBe('EXPIRED');
    expect(verifyToken(qr.token, [{ kid: 'k1', publicKeyHex: generateKeyPair('k1').publicKeyHex }]).ok).toBe(false);
    expect(credentialFor(g, cfg, 'k1')?.id).toBe(g.credentialId);
    // sin ID del host o sin clave no hay QR
    expect(rotatingQr({ ...g, credentialId: undefined }, cfg, now, key)).toBeNull();
    expect(rotatingQr(g, cfg, now, null)).toBeNull();
  });
});

describe('aprobar / rechazar con correo', () => {
  it('aprobar manda el estado y los enlaces de credencial digital (participante General y acompañantes)', async () => {
    setSigningKeyForTests(key);
    const repos = await memoryRepos();
    const mail = memorySender();
    const gen = await register(repos, adult({ firstName: 'Gloria', roleCode: 'GEN', categoryCode: undefined, email: 'g@x.com', companions: [{ name: 'Pepe Ruiz' }] }));
    if (!gen.ok) throw new Error('fallo');
    const res = await approveRegistration({ repos, config: cfg, sendMail: mail, actor: 'coord@x' }, gen.registration.id);
    expect(res.ok).toBe(true);
    const g = (await repos.registrations.byId(gen.registration.id))!;
    const c = (await repos.registrations.companionsOf(g.id))[0];
    expect(g.status).toBe('APPROVED'); expect(c.status).toBe('APPROVED');
    expect(g.credentialToken).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toContain('aprobada');
    expect(mail.sent[0].text).toContain(`/credencial/${g.credentialToken}`);
    expect(mail.sent[0].text).toContain(`Pepe Ruiz: `);
    expect(mail.sent[0].text).toContain(`/credencial/${c.credentialToken}`);
    expect((await repos.registrations.byCredentialToken(g.credentialToken!))?.id).toBe(g.id);
    setSigningKeyForTests(undefined);
  });

  it('competidor aprobado: correo sin enlace digital; rechazar exige motivo y lo manda', async () => {
    const repos = await memoryRepos();
    const mail = memorySender();
    const a = await register(repos, adult({ email: 'a@x.com' }));
    const b = await register(repos, adult({ firstName: 'Beto', email: 'b@x.com' }));
    if (!a.ok || !b.ok) throw new Error('fallo');
    await approveRegistration({ repos, config: cfg, sendMail: mail, actor: 'coord@x' }, a.registration.id);
    expect(mail.sent[0].text).not.toContain('/credencial/');
    expect(mail.sent[0].text).toContain('mesa de acreditación');
    const bad = await rejectRegistration({ repos, config: cfg, sendMail: mail, actor: 'coord@x' }, b.registration.id, '  ');
    expect(bad.ok).toBe(false);
    const ok = await rejectRegistration({ repos, config: cfg, sendMail: mail, actor: 'coord@x' }, b.registration.id, 'documento ilegible');
    expect(ok.ok).toBe(true);
    expect((await repos.registrations.byId(b.registration.id))!.status).toBe('REJECTED');
    expect(mail.sent[1].text).toContain('documento ilegible');
    // acompañantes no se aprueban por separado
    expect((await approveRegistration({ repos, config: cfg, sendMail: mail, actor: 'x' }, 'nope')).ok).toBe(false);
  });
});
