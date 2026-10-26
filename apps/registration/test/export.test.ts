import { describe, expect, it } from 'vitest';
import { adult, memoryRepos, register, TINY_JPEG } from './helpers';
import { buildExport } from '../lib/export';
import { applyHostReport } from '../lib/host-report';
import { toCsv } from '../lib/csv';

describe('export al host', () => {
  it('solo aprobadas, con acompañantes, photoUrl, code y cursor incremental', async () => {
    const repos = await memoryRepos();
    const a = await register(repos, adult({ photo: TINY_JPEG, companions: [{ name: 'Lina Ruiz' }], delegation: 'Cauca', emergencyName: 'Rosa', emergencyPhone: '3102345678', epsName: 'Sura' }));
    await register(repos, adult({ firstName: 'Beto' }));
    if (!a.ok) throw new Error('fallo');
    expect((await buildExport(repos, undefined)).count).toBe(0);
    await repos.registrations.setStatus(a.registration.id, 'APPROVED');
    const e1 = await buildExport(repos, undefined, { markExported: true });
    expect(e1.count).toBe(1);
    expect(e1.registrations[0]).toMatchObject({ id: a.registration.id, code: a.registration.code, status: 'APPROVED', revoked: false });
    expect(e1.registrations[0].photoUrl).toMatch(/^memory:/);
    expect(e1.registrations[0]).toMatchObject({ delegation: 'Cauca', emergencyContact: { name: 'Rosa', phone: '3102345678' }, eps: { name: 'Sura' } });
    expect(e1.registrations[0].companions[0]).toMatchObject({ firstName: 'Lina', roleCode: 'ACOMP', companionOf: a.registration.id });
    expect(e1.cursor).toBe(e1.registrations[0].updatedAt);
    expect((await repos.registrations.byId(a.registration.id))!.exportedAt).toBeDefined();
    // segundo pull desde el cursor: nada nuevo
    expect((await buildExport(repos, e1.cursor!)).count).toBe(0);
  });

  it('revocar desde la nube vuelve a exportar la inscripción con revoked=true', async () => {
    const repos = await memoryRepos();
    const a = await register(repos, adult());
    if (!a.ok) throw new Error('fallo');
    await repos.registrations.setStatus(a.registration.id, 'APPROVED');
    const e1 = await buildExport(repos, undefined);
    await new Promise((r) => setTimeout(r, 5));
    await repos.registrations.revoke(a.registration.id, 'credencial perdida');
    const e2 = await buildExport(repos, e1.cursor!);
    expect(e2.count).toBe(1);
    expect(e2.registrations[0]).toMatchObject({ revoked: true, revokeReason: 'credencial perdida' });
  });

  it('el reporte del host actualiza el estado de credencial por id de inscripción', async () => {
    const repos = await memoryRepos();
    const a = await register(repos, adult());
    if (!a.ok) throw new Error('fallo');
    const res = await applyHostReport(repos, {
      hostId: 'host-1', at: '2026-11-22T20:00:00.000Z', summary: { scans: 1200, denied: 14 },
      credentials: [{ externalId: a.registration.id, credentialId: 'TP-2026-00001-C', status: 'delivered' }, { externalId: 'desconocida', status: 'PRINTED' }, { status: 'X' }]
    });
    expect(res).toMatchObject({ applied: 1, unknown: ['desconocida'], invalid: 1 });
    const r = (await repos.registrations.byId(a.registration.id))!;
    expect(r.credentialStatus).toBe('DELIVERED');
    expect(r.credentialId).toBe('TP-2026-00001-C');
    expect((await repos.settings.hostReports())[0].summary.scans).toBe(1200);
  });
});

describe('csv', () => {
  it('escapa comas, comillas y saltos', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'di "hola"'], ['línea\nnueva', null]]);
    expect(csv).toBe('﻿a,b\r\n"x,y","di ""hola"""\r\n"línea\nnueva",\r\n');
  });
});
