import { describe, expect, it } from 'vitest';
import {
  csvToTable, dedupeKey, guessMapping, importSportData, normalizeBirthDate, normalizeName, parseCsv, splitFullName
} from '../src/sportdata-import.js';
import type { Person } from '../src/types.js';

const CSV = [
  'Nombre,Apellido,Fecha de nacimiento,Club,Documento,Categoria',
  'Juan,Pérez,2010-03-03,Academia Caucana,1001,Juvenil',
  '"García, María",Lopez,15/06/2012,"Club ""Tigres"", Cali",1002,Infantil B',
  'Ana,Ruiz,2000-01-01,Academia Caucana,,Adulto',
  'Juan,Pérez,2010-03-03,Academia Caucana,1001,Juvenil',
  ''
].join('\r\n');

describe('parseCsv', () => {
  it('maneja comillas, comillas escapadas y CRLF', () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(5);
    expect(rows[2][0]).toBe('García, María');
    expect(rows[2][3]).toBe('Club "Tigres", Cali');
  });

  it('detecta separador ; y BOM', () => {
    const rows = parseCsv('﻿a;b\n1;2\n');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('x,y', { delimiter: ';' })).toEqual([['x,y']]);
  });

  it('csvToTable usa la primera fila como encabezado', () => {
    const t = csvToTable('a,b\n1,2\n3');
    expect(t.headers).toEqual(['a', 'b']);
    expect(t.rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '' }]);
    expect(csvToTable('')).toEqual({ headers: [], rows: [] });
  });
});

describe('normalización', () => {
  it('fechas en varios formatos', () => {
    expect(normalizeBirthDate('2010-03-03')).toBe('2010-03-03');
    expect(normalizeBirthDate('15/06/2012')).toBe('2012-06-15');
    expect(normalizeBirthDate('5-6-2012')).toBe('2012-06-05');
    expect(normalizeBirthDate('2012/6/5')).toBe('2012-06-05');
    expect(normalizeBirthDate('31/02/2012')).toBeNull();
    expect(normalizeBirthDate('ayer')).toBeNull();
  });

  it('nombres sin tildes ni mayúsculas', () => {
    expect(normalizeName('  José  PÉREZ-Gómez ')).toBe('jose perez gomez');
    expect(dedupeKey({ firstName: 'José', lastName: 'Pérez', birthDate: '2010-01-01', club: 'Caucana' })).toBe(dedupeKey({ firstName: 'jose', lastName: 'perez', birthDate: '2010-01-01', club: 'CAUCANA' }));
  });

  it('splitFullName', () => {
    expect(splitFullName('Pérez, Juan')).toEqual({ firstName: 'Juan', lastName: 'Pérez' });
    expect(splitFullName('Juan Carlos Pérez Gómez')).toEqual({ firstName: 'Juan Carlos', lastName: 'Pérez Gómez' });
    expect(splitFullName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' });
  });

  it('guessMapping adivina columnas de SportData', () => {
    const m = guessMapping(['ID', 'Nombre', 'Apellido', 'Fecha de nacimiento', 'Club', 'Documento', 'Categoria']);
    expect(m).toEqual({ firstName: 'Nombre', lastName: 'Apellido', birthDate: 'Fecha de nacimiento', club: 'Club', documentNumber: 'Documento', externalId: 'ID', category: 'Categoria' });
    expect(guessMapping(['Full Name', 'DOB', 'Team'])).toEqual({ fullName: 'Full Name', birthDate: 'DOB', club: 'Team' });
  });
});

describe('importSportData', () => {
  const table = csvToTable(CSV);
  const mapping = { firstName: 'Nombre', lastName: 'Apellido', birthDate: 'Fecha de nacimiento', club: 'Club', documentNumber: 'Documento' };
  const idFactory = (i: number) => `p${i + 1}`;

  it('crea personas y detecta duplicados dentro del archivo', () => {
    const r = importSportData(table, { mapping, existing: [], idFactory });
    expect(r.created).toHaveLength(3);
    expect(r.duplicatesInFile).toBe(1);
    expect(r.errors).toHaveLength(0);
    expect(r.created[1]).toMatchObject({ firstName: 'García, María', lastName: 'Lopez', birthDate: '2012-06-15', club: 'Club "Tigres", Cali', source: 'sportdata' });
    expect(r.created[2].documentNumber).toBeUndefined();
  });

  it('reimportar es idempotente', () => {
    const first = importSportData(table, { mapping, existing: [], idFactory });
    const second = importSportData(table, { mapping, existing: first.persons, idFactory });
    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged).toHaveLength(3);
    expect(second.persons).toHaveLength(3);
    expect(second.persons.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('actualiza documento sin duplicar', () => {
    const first = importSportData(table, { mapping, existing: [], idFactory });
    const changed = csvToTable(CSV.replace('Ana,Ruiz,2000-01-01,Academia Caucana,,', 'Ana,Ruiz,2000-01-01,Academia Caucana,9999,'));
    const r = importSportData(changed, { mapping, existing: first.persons, idFactory });
    expect(r.updated).toHaveLength(1);
    expect(r.updated[0]).toMatchObject({ id: 'p3', documentNumber: '9999' });
    expect(r.persons).toHaveLength(3);
  });

  it('misma persona en otro club es otra inscripción (clave incluye club)', () => {
    const existing: Person[] = [{ id: 'z', firstName: 'Juan', lastName: 'Pérez', birthDate: '2010-03-03', club: 'Otro Club', source: 'online' }];
    const r = importSportData(table, { mapping, existing, idFactory });
    expect(r.created).toHaveLength(3);
    expect(r.persons).toHaveLength(4);
  });

  it('reporta errores por fila', () => {
    const t = csvToTable('Nombre,Apellido,Fecha de nacimiento\n,X,2010-01-01\nPepe,Y,no-fecha\n');
    const r = importSportData(t, { mapping: { firstName: 'Nombre', lastName: 'Apellido', birthDate: 'Fecha de nacimiento' }, existing: [] });
    expect(r.errors).toEqual([{ row: 2, message: 'Falta el nombre.' }, { row: 3, message: 'Fecha de nacimiento inválida: "no-fecha".' }]);
    expect(r.created).toHaveLength(0);
  });

  it('acepta nombre completo en una columna y externalId', () => {
    const t = csvToTable('ID,Nombre completo,DOB\n7,"Pérez, Juan",2010-01-01\n');
    const r = importSportData(t, { mapping: { fullName: 'Nombre completo', birthDate: 'DOB', externalId: 'ID' }, existing: [], idFactory });
    expect(r.created[0]).toMatchObject({ firstName: 'Juan', lastName: 'Pérez', externalId: '7' });
    // cambiar externalId actualiza
    const t2 = csvToTable('ID,Nombre completo,DOB\n8,"Pérez, Juan",2010-01-01\n');
    const r2 = importSportData(t2, { mapping: { fullName: 'Nombre completo', birthDate: 'DOB', externalId: 'ID' }, existing: r.persons, idFactory });
    expect(r2.updated[0].externalId).toBe('8');
    // sin idFactory genera ids propios
    const r3 = importSportData(t2, { mapping: { fullName: 'Nombre completo', birthDate: 'DOB' }, existing: [] });
    expect(r3.created[0].id).toMatch(/^p_/);
  });
});

describe('columnas opcionales: delegación, emergencia y EPS', () => {
  const csv = [
    'Nombre,Apellido,Fecha de nacimiento,Club,Departamento,Contacto de emergencia,Teléfono de emergencia,EPS,Régimen',
    'Juan,Pérez,2010-03-03,Academia Caucana,Cauca,María Pérez,3101234567,Sura,Contributivo',
    'Ana,Ruiz,2000-01-01,Academia Caucana,,Sin teléfono,,,'
  ].join('\n');
  it('guessMapping las detecta', () => {
    const t = csvToTable(csv);
    const m = guessMapping(t.headers);
    expect(m).toMatchObject({ delegation: 'Departamento', emergencyName: 'Contacto de emergencia', emergencyPhone: 'Teléfono de emergencia', epsName: 'EPS', epsRegime: 'Régimen' });
  });
  it('importa y actualiza esos campos sin duplicar', () => {
    const t = csvToTable(csv);
    const mapping = { ...guessMapping(t.headers), birthDate: 'Fecha de nacimiento' } as Parameters<typeof importSportData>[1]['mapping'];
    const r = importSportData(t, { mapping, existing: [], idFactory: (i) => `p${i}` });
    expect(r.created[0]).toMatchObject({ delegation: 'Cauca', emergencyContact: { name: 'María Pérez', phone: '3101234567' }, eps: { name: 'Sura', regime: 'Contributivo' } });
    // contacto sin teléfono no se guarda a medias
    expect(r.created[1].emergencyContact).toBeUndefined();
    expect(r.created[1].eps).toBeUndefined();
    const again = importSportData(t, { mapping, existing: r.persons });
    expect(again.unchanged).toHaveLength(2);
    const changed = csvToTable(csv.replace(',Cauca,', ',Valle,'));
    const upd = importSportData(changed, { mapping, existing: r.persons });
    expect(upd.updated[0].delegation).toBe('Valle');
  });
});
