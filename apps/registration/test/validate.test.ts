import { describe, expect, it } from 'vitest';
import { adult, memoryRepos, register, testConfig, TINY_JPEG } from './helpers';
import { processRegistration } from '../lib/validate';
import { registrationWindow } from '../lib/config';

describe('inscripción pública', () => {
  it('adulto válido queda PENDING con código y correo', async () => {
    const repos = await memoryRepos();
    const r = await register(repos, adult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('PENDING');
    expect(r.registration.code).toMatch(/^N26-/);
    expect(r.registration.categoryCode).toBe('ADU');
    expect(r.created).toBe(true);
  });

  it('bloquea menor en categoría adulta y exige acudiente + consentimiento', async () => {
    const repos = await memoryRepos();
    const r = await register(repos, adult({ birthDate: '2012-05-01', categoryCode: 'ADU' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('VALIDATION');
    expect(r.errors.categoryCode).toMatch(/Juvenil/);
    expect(r.errors.guardianName).toBeDefined();
    expect(r.errors.guardianConsent).toBeDefined();
    const ok = await register(repos, adult({ birthDate: '2012-05-01', categoryCode: 'JUV', guardianName: 'Pedro', guardianDocument: '1', guardianConsent: true }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.registration.guardian?.name).toBe('Pedro');
  });

  it('valida campos obligatorios, correo y aviso de privacidad', async () => {
    const repos = await memoryRepos();
    const r = await register(repos, { email: 'nope', privacyConsent: false, roleCode: 'ACOMP' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['birthDate', 'email', 'firstName', 'lastName', 'privacyConsent', 'roleCode']);
  });

  it('cupo lleno → 409 salvo que acepte lista de espera', async () => {
    const repos = await memoryRepos();
    const config = testConfig({ roles: testConfig().roles.map((r) => (r.code === 'COMP' ? { ...r, capacity: 1 } : r)) });
    expect((await register(repos, adult(), config)).ok).toBe(true);
    const full = await register(repos, adult({ firstName: 'Beto' }), config);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.code).toBe('CAPACITY_FULL');
    const wl = await register(repos, adult({ firstName: 'Beto', acceptWaitlist: true }), config);
    expect(wl.ok && wl.status).toBe('WAITLIST');
    expect((await repos.registrations.countByRole()).COMP).toBe(1);
  });

  it('aforo total del evento también manda a lista de espera', async () => {
    const repos = await memoryRepos();
    const config = testConfig({ totalCapacity: 1 });
    expect((await register(repos, adult(), config)).ok).toBe(true);
    const r = await register(repos, adult({ firstName: 'Beto', acceptWaitlist: true }), config);
    expect(r.ok && r.status).toBe('WAITLIST');
  });

  it('acompañantes: máximo por participante y herencia de estado', async () => {
    const repos = await memoryRepos();
    const bad = await register(repos, adult({ companions: [{ name: 'Uno' }, { name: 'Dos' }, { name: 'Tres' }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.companions).toMatch(/máximo/);
    const ok = await register(repos, adult({ companions: [{ name: 'Pedro Ruiz', document: '9', relationship: 'Padre' }, { name: 'Lina Ruiz' }] }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.companions.map((c) => c.roleCode)).toEqual(['ACOMP', 'ACOMP']);
    expect(ok.companions[0].companionOf).toBe(ok.registration.id);
    expect(await repos.registrations.countActive()).toBe(3);
  });

  it('reinscribir con los mismos datos actualiza en vez de duplicar', async () => {
    const repos = await memoryRepos();
    await register(repos, adult());
    const again = await register(repos, adult({ documentNumber: '777' }));
    expect(again.ok && !again.created).toBe(true);
    expect((await repos.registrations.all()).length).toBe(1);
    expect((await repos.registrations.all())[0].documentNumber).toBe('777');
  });

  it('guarda la foto recortada y la expone como photoUrl', async () => {
    const repos = await memoryRepos();
    const r = await register(repos, adult({ photo: TINY_JPEG, companions: [{ name: 'Lina Ruiz', photo: TINY_JPEG }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registration.photoUrl).toMatch(/^memory:\/\/photos\//);
    expect(r.companions[0].photoUrl).toMatch(/^memory:\/\//);
    const bad = await register(repos, adult({ firstName: 'Zoe', photo: 'data:text/plain;base64,QUJD' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.photo).toMatch(/No pude leer/);
  });

  it('asocia la delegación por nombre del club', async () => {
    const repos = await memoryRepos();
    const d = await repos.users.createDelegation({ name: 'Academia Caucana' });
    const r = await register(repos, adult({ club: 'academia caucana' }));
    expect(r.ok && r.registration.delegationId).toBe(d.id);
  });

  it('ventana de inscripciones: cerrada antes de abrir y después de cerrar', async () => {
    const repos = await memoryRepos();
    const form = { intro: '', successNote: '', privacyNotice: '', opensAt: '2026-10-01T00:00:00.000Z', closesAt: '2026-11-01T00:00:00.000Z' };
    expect(registrationWindow(form, new Date('2026-09-01')).open).toBe(false);
    expect(registrationWindow(form, new Date('2026-10-15')).open).toBe(true);
    expect(registrationWindow(form, new Date('2026-11-02')).reason).toMatch(/cerraron/);
    const r = await processRegistration(repos, adult(), { config: testConfig(), form, now: new Date('2026-12-01') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CLOSED');
  });
});

describe('contacto de emergencia, EPS y delegación', () => {
  it('opcionales por defecto; se guardan completos y exigen nombre + teléfono juntos', async () => {
    const repos = await memoryRepos();
    const ok = await register(repos, adult({ delegation: 'Cauca', emergencyName: 'Rosa Ruiz', emergencyPhone: '310 234 5678', epsName: 'Sura', epsRegime: 'Régimen Contributivo' }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.registration).toMatchObject({ delegation: 'Cauca', emergencyContact: { name: 'Rosa Ruiz', phone: '310 234 5678' }, eps: { name: 'Sura', regime: 'Régimen Contributivo' } });
    const half = await register(repos, adult({ firstName: 'Beto', emergencyName: 'Rosa' }));
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.errors.emergencyPhone).toMatch(/nombre y teléfono/);
    const badPhone = await register(repos, adult({ firstName: 'Caro', emergencyName: 'Rosa', emergencyPhone: 'abc' }));
    if (!badPhone.ok) expect(badPhone.errors.emergencyPhone).toMatch(/Revisa el teléfono/);
    const none = await register(repos, adult({ firstName: 'Dani' }));
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.registration.emergencyContact).toBeUndefined();
  });

  it('requireEmergencyContact en la config lo vuelve obligatorio', async () => {
    const repos = await memoryRepos();
    const config = testConfig({ registration: { requireEmergencyContact: true } });
    const r = await register(repos, adult(), config);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors.emergencyName).toMatch(/emergencia/); expect(r.errors.emergencyPhone).toBeDefined(); }
    const ok = await register(repos, adult({ emergencyName: 'Rosa', emergencyPhone: '3102345678' }), config);
    expect(ok.ok).toBe(true);
  });
});
