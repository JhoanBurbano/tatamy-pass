/** Plantilla de credencial (ADR-0009): leer, guardar, assets, vista previa, reset, RBAC y persistencia. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultConfig, defaultBadgeTemplate, generateKeyPair, type BadgeTemplate } from '@tatami/core';
import { buildApp } from '../src/server.js';
import { seedCredentials } from '../src/seed-data.js';
import { BadgeTemplateStore } from '../src/badge-template.js';
import { PDFDocument } from 'pdf-lib';

const pages = async (bytes: Buffer) => (await PDFDocument.load(bytes)).getPageCount();

const key = generateKeyPair('ktest');
const tmp = mkdtempSync(join(tmpdir(), 'tatami-badge-'));
const templatePath = join(tmp, 'data', 'badge-template.json');
let app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {};
const auth = (u: string) => ({ authorization: `Bearer ${tokens[u]}` });
// PNG 1×1 válido
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(async () => {
  app = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, backupsDir: join(tmp, 'backups'), configPath: null, templatePath });
  for (const [u, r] of [['admin', 'ADMIN'], ['coord', 'COORDINATOR'], ['print', 'PRINTER'], ['audit', 'AUDITOR'], ['super', 'SUPERVISOR']] as const) {
    app.ctx.users.create(u, `${u}123`, r);
    tokens[u] = (await app.inject({ method: 'POST', url: '/auth/login', payload: { username: u, password: `${u}123` } })).json().token;
  }
  seedCredentials(app.ctx, 20);
});
afterAll(async () => { await app.close(); rmSync(tmp, { recursive: true, force: true }); });

describe('GET /print/template', () => {
  it('crea el archivo con la plantilla por defecto y la devuelve', async () => {
    expect(existsSync(templatePath)).toBe(true);
    const r = await app.inject({ method: 'GET', url: '/print/template', headers: auth('print') });
    expect(r.statusCode).toBe(200);
    expect(r.json().template).toEqual(defaultBadgeTemplate());
    expect(r.json().isDefault).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/print/template', headers: auth('super') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/print/template' })).statusCode).toBe(401);
  });
});

describe('PUT /print/template', () => {
  it('valida con mensajes por campo', async () => {
    const t = defaultBadgeTemplate();
    t.colors.accent = 'rosa';
    const r = await app.inject({ method: 'PUT', url: '/print/template', headers: auth('admin'), payload: { template: t } });
    expect(r.statusCode).toBe(400);
    expect(r.json().errors).toEqual([{ path: 'colors.accent', message: expect.stringMatching(/hexadecimal/) }]);
    expect((await app.inject({ method: 'PUT', url: '/print/template', headers: auth('admin'), payload: {} })).statusCode).toBe(400);
  });

  it('guarda, persiste en disco, audita y el PDF del lote usa el diseño nuevo; printer y auditor no pueden', async () => {
    const t = defaultBadgeTemplate();
    t.name = 'Mi diseño'; t.header.title = 'COPA REGIONAL'; t.credentialDisplay.prefix = 'CNITF2026'; t.privacy.printDocument = false;
    const r = await app.inject({ method: 'PUT', url: '/print/template', headers: auth('coord'), payload: { template: t } });
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toMatch(/Diseño guardado/);
    expect(JSON.parse(readFileSync(templatePath, 'utf8')).header.title).toBe('COPA REGIONAL');
    expect((await app.inject({ method: 'GET', url: '/print/template', headers: auth('audit') })).json().isDefault).toBe(false);
    expect(app.ctx.audit.all().some((a) => a.action === 'BADGE_TEMPLATE_UPDATED')).toBe(true);
    expect((await app.inject({ method: 'PUT', url: '/print/template', headers: auth('print'), payload: { template: t } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/print/template', headers: auth('audit'), payload: { template: t } })).statusCode).toBe(403);
    // lote → PDF con dos páginas por credencial (anverso y reverso)
    const batch = (await app.inject({ method: 'POST', url: '/print/batches', headers: auth('print'), payload: { roleCode: 'COMP', status: 'DELIVERED', limit: 3 } })).json();
    const pdf = await app.inject({ method: 'GET', url: `/print/batches/${batch.id}/pdf`, headers: auth('print') });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(await pages(pdf.rawPayload)).toBe(batch.count * 2);
    const duplex = await app.inject({ method: 'GET', url: `/print/batches/${batch.id}/pdf?layout=duplex`, headers: auth('print') });
    expect(await pages(duplex.rawPayload)).toBe(batch.count);
  });
});

describe('assets', () => {
  it('sube un PNG, lo usa en el pie, lo quita y limpia referencias; rechaza mime y tamaño', async () => {
    const up = await app.inject({ method: 'POST', url: '/print/template/assets', headers: auth('admin'), payload: { id: 'logo-liga', name: 'Liga Caucana', mime: 'image/png', dataBase64: `data:image/png;base64,${PNG}` } });
    expect(up.statusCode).toBe(200);
    expect(up.json().template.assets['logo-liga']).toMatchObject({ name: 'Liga Caucana', mime: 'image/png', dataBase64: PNG });
    const t = up.json().template as BadgeTemplate;
    t.front.footer.logos = ['logo-liga', 'logo-itf'];
    t.back.sponsors.logos = ['logo-liga'];
    expect((await app.inject({ method: 'PUT', url: '/print/template', headers: auth('admin'), payload: { template: t } })).statusCode).toBe(200);
    const del = await app.inject({ method: 'DELETE', url: '/print/template/assets/logo-liga', headers: auth('admin') });
    expect(del.statusCode).toBe(200);
    expect(del.json().template.assets['logo-liga']).toBeUndefined();
    expect(del.json().template.front.footer.logos).toEqual(['logo-itf']);
    expect(del.json().template.back.sponsors.logos).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: '/print/template/assets/logo-liga', headers: auth('admin') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/print/template/assets', headers: auth('admin'), payload: { id: 'Logo Raro', mime: 'image/png', dataBase64: PNG } })).json().error).toMatch(/id corto/);
    expect((await app.inject({ method: 'POST', url: '/print/template/assets', headers: auth('admin'), payload: { id: 'gif', mime: 'image/gif', dataBase64: PNG } })).json().error).toMatch(/PNG, JPG o SVG/);
    expect((await app.inject({ method: 'POST', url: '/print/template/assets', headers: auth('admin'), payload: { id: 'vacio', mime: 'image/png', dataBase64: '' } })).json().error).toMatch(/vacío/);
    const big = await app.inject({ method: 'POST', url: '/print/template/assets', headers: auth('admin'), payload: { id: 'grande', mime: 'image/png', dataBase64: 'A'.repeat(1_500_000) } });
    expect(big.json().error).toMatch(/1 MB/);
    expect((await app.inject({ method: 'POST', url: '/print/template/assets', headers: auth('print'), payload: { id: 'x', mime: 'image/png', dataBase64: PNG } })).statusCode).toBe(403);
  });
});

describe('preview y reset', () => {
  it('la vista previa devuelve un PDF con la plantilla enviada sin guardarla', async () => {
    const t = defaultBadgeTemplate();
    t.header.title = 'SOLO PREVIEW';
    const r = await app.inject({ method: 'POST', url: '/print/template/preview', headers: auth('print'), payload: { template: t, layout: 'two-pages', sample: { displayName: 'Ana Prueba', roleCode: 'COACH' } } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await app.inject({ method: 'GET', url: '/print/template', headers: auth('admin') })).json().template.header.title).not.toBe('SOLO PREVIEW');
    t.front.qr.sizeMm = 5;
    expect((await app.inject({ method: 'POST', url: '/print/template/preview', headers: auth('print'), payload: { template: t } })).statusCode).toBe(400);
    // sin template: usa la vigente; rol desconocido cae en COMP
    expect((await app.inject({ method: 'POST', url: '/print/template/preview', headers: auth('coord'), payload: { sample: { roleCode: 'NOPE' } } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/print/template/preview', headers: auth('audit'), payload: {} })).statusCode).toBe(403);
  });

  it('reset vuelve al diseño del piloto', async () => {
    expect((await app.inject({ method: 'POST', url: '/print/template/reset', headers: auth('print') })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/print/template/reset', headers: auth('admin') });
    expect(r.statusCode).toBe(200);
    expect(r.json().template).toEqual(defaultBadgeTemplate());
    expect(JSON.parse(readFileSync(templatePath, 'utf8'))).toEqual(defaultBadgeTemplate());
  });
});

describe('BadgeTemplateStore', () => {
  it('un archivo corrupto o inválido no tumba el host: avisa y usa la por defecto', () => {
    const p = join(tmp, 'roto.json');
    writeFileSync(p, '{ no es json');
    const msgs: string[] = [];
    const s1 = new BadgeTemplateStore(p, (m) => msgs.push(m));
    expect(s1.get()).toEqual(defaultBadgeTemplate());
    expect(msgs[0]).toMatch(/No pude leer/);
    writeFileSync(p, JSON.stringify({ id: 'x' }));
    const s2 = new BadgeTemplateStore(p, (m) => msgs.push(m));
    expect(s2.get()).toEqual(defaultBadgeTemplate());
    expect(msgs[1]).toMatch(/tiene errores/);
    const mem = new BadgeTemplateStore(null);
    expect(mem.save({ nope: true }).length).toBeGreaterThan(0);
    expect(mem.bytes()).toBeGreaterThan(1000);
  });
});

describe('persona: delegación, emergencia y EPS', () => {
  it('se guardan, el teléfono de emergencia queda cifrado, se purgan y se replican', () => {
    const p = app.ctx.persons.upsert({ id: 'p_badge', firstName: 'Ana', lastName: 'Ruiz', birthDate: '2000-05-01', source: 'seed', delegation: 'Cauca', emergencyContact: { name: 'Rosa', phone: '3101234567' }, eps: { name: 'Sura', regime: 'Contributivo' } });
    expect(p).toMatchObject({ delegation: 'Cauca', emergencyContact: { name: 'Rosa', phone: '3101234567' }, eps: { name: 'Sura', regime: 'Contributivo' } });
    const raw = app.ctx.db.prepare('SELECT emergency_json, eps_json, delegation FROM persons WHERE id = ?').get('p_badge') as { emergency_json: string; eps_json: string; delegation: string };
    expect(raw.emergency_json).toContain('"phone":"enc:v1:');
    expect(raw.emergency_json).not.toContain('3101234567');
    expect(raw.delegation).toBe('Cauca');
    const upd = app.ctx.persons.updateById({ ...p, delegation: 'Valle', emergencyContact: { name: 'Rosa', phone: '3000000000' } });
    expect(upd.delegation).toBe('Valle');
    expect(upd.emergencyContact?.phone).toBe('3000000000');
    const plain = app.ctx.persons.plainSince().find((r) => r.id === 'p_badge')!;
    expect(JSON.parse(plain.emergency_json as string)).toEqual({ name: 'Rosa', phone: '3000000000' });
    app.ctx.persons.upsertPlain({ ...plain, id: 'p_badge2', dedupe_key: 'h1:otra' });
    expect(app.ctx.persons.byId('p_badge2')?.emergencyContact).toEqual({ name: 'Rosa', phone: '3000000000' });
    app.ctx.persons.purge('p_badge', new Date().toISOString());
    const purged = app.ctx.persons.byId('p_badge')!;
    expect(purged.emergencyContact).toBeUndefined();
    expect(purged.eps).toBeUndefined();
  });
});

describe('preview en PNG', () => {
  it('devuelve imagen si hay poppler o 406 si no', async () => {
    const r = await app.inject({ method: 'POST', url: '/print/template/preview', headers: auth('admin'), payload: { format: 'png' } });
    if (r.statusCode === 200) expect(r.headers['content-type']).toContain('image/png');
    else { expect(r.statusCode).toBe(406); expect(r.json().error).toMatch(/poppler/); }
  });
});
