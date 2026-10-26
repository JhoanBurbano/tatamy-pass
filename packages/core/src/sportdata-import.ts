/**
 * Importación SportData: CSV → personas con rol COMP (§7).
 * Parser CSV propio (RFC 4180: comillas, comillas escapadas, CRLF, separador
 * configurable). Dedupe por `nombre + fechaNacimiento + club`, idempotente.
 */
import type { IsoDate, Person } from './types.js';
import { isIsoDate } from './age-categories.js';

// ---------- CSV ----------

export interface CsvOptions {
  delimiter?: string; // auto: ',' o ';'
}

export function parseCsv(text: string, opts: CsvOptions = {}): string[][] {
  const src = text.replace(/^﻿/, '');
  const delimiter = opts.delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // descarta filas completamente vacías
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function csvToTable(text: string, opts: CsvOptions = {}): CsvTable {
  const rows = parseCsv(text, opts);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const data = rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows: data };
}

// ---------- mapeo ----------

/** Qué columna del CSV alimenta cada campo. Nombre completo o nombre+apellido. */
export interface ColumnMapping {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  birthDate: string;
  club?: string;
  documentNumber?: string;
  externalId?: string;
  category?: string;
  /** Opcionales: delegación (departamento/región), contacto de emergencia y EPS (reverso de la credencial). */
  delegation?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  epsName?: string;
  epsRegime?: string;
}

/** Intenta adivinar el mapeo por nombres de columna habituales en SportData. */
export function guessMapping(headers: string[]): Partial<ColumnMapping> {
  const find = (...cands: RegExp[]) => headers.find((h) => cands.some((re) => re.test(h.toLowerCase())));
  const m: Partial<ColumnMapping> = {};
  const full = find(/^(nombre completo|full ?name|name|competidor|atleta)$/);
  const first = find(/^(nombre|nombres|first ?name|given)$/);
  const last = find(/^(apellido|apellidos|last ?name|surname|family)$/);
  if (first && last) { m.firstName = first; m.lastName = last; } else if (full) m.fullName = full;
  const bd = find(/fecha.*nac|birth|dob|nacimiento/);
  if (bd) m.birthDate = bd;
  const club = find(/club|team|equipo|delegaci|escuela|academia/);
  if (club) m.club = club;
  const doc = find(/documento|cedula|cédula|dni|id ?number|identificaci/);
  if (doc) m.documentNumber = doc;
  const ext = find(/^(id|sportdata ?id|external|codigo|código)$/);
  if (ext) m.externalId = ext;
  const cat = find(/categor|division|división|class/);
  if (cat) m.category = cat;
  const delegation = find(/^(departamento|region|región|liga|delegacion|delegación)$/);
  if (delegation) m.delegation = delegation;
  const emName = find(/emergencia.*(nombre|contacto)|contacto.*emergencia|emergency.*name/);
  if (emName) m.emergencyName = emName;
  const emPhone = find(/emergencia.*(tel|cel)|tel.*emergencia|emergency.*phone/);
  if (emPhone) m.emergencyPhone = emPhone;
  const eps = find(/^eps$|eps.*nombre|entidad.*salud/);
  if (eps) m.epsName = eps;
  const regime = find(/r[eé]gimen/);
  if (regime) m.epsRegime = regime;
  return m;
}

// ---------- normalización ----------

export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Acepta `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY/MM/DD`. */
export function normalizeBirthDate(s: string): IsoDate | null {
  const t = s.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return isIsoDate(iso) ? iso : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

export function dedupeKey(p: { firstName: string; lastName: string; birthDate: string; club?: string }): string {
  return `${normalizeName(p.firstName + ' ' + p.lastName)}|${p.birthDate}|${normalizeName(p.club ?? '')}`;
}

/** Separa "Apellido, Nombre" o "Nombre Apellido" en dos partes. */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const t = full.trim().replace(/\s+/g, ' ');
  if (t.includes(',')) {
    const [last, first] = t.split(',').map((s) => s.trim());
    return { firstName: first ?? '', lastName: last ?? '' };
  }
  const parts = t.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const half = Math.ceil(parts.length / 2);
  return { firstName: parts.slice(0, half).join(' '), lastName: parts.slice(half).join(' ') };
}

// ---------- importación ----------

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  created: Person[];
  updated: Person[];
  unchanged: Person[];
  errors: ImportRowError[];
  /** Filas que eran duplicados dentro del mismo archivo. */
  duplicatesInFile: number;
  /** Estado final: todas las personas (existentes + nuevas). */
  persons: Person[];
}

export interface ImportOptions {
  mapping: ColumnMapping;
  existing: Person[];
  /** Genera IDs para personas nuevas (determinista en tests). */
  idFactory?: (index: number) => string;
}

/**
 * Importa filas ya parseadas. Idempotente: reimportar el mismo CSV deja todo
 * en `unchanged`; cambios en club/documento actualizan sin duplicar.
 */
export function importSportData(table: CsvTable, opts: ImportOptions): ImportResult {
  const { mapping } = opts;
  const idFactory = opts.idFactory ?? ((i: number) => `p_${Date.now().toString(36)}_${i}`);
  const byKey = new Map<string, Person>();
  for (const p of opts.existing) byKey.set(dedupeKey(p), p);

  const result: ImportResult = { created: [], updated: [], unchanged: [], errors: [], duplicatesInFile: 0, persons: [] };
  const seenInFile = new Set<string>();
  let newIndex = 0;

  table.rows.forEach((row, idx) => {
    const rowNo = idx + 2; // 1 = encabezado
    let firstName = '';
    let lastName = '';
    if (mapping.firstName && mapping.lastName) {
      firstName = row[mapping.firstName] ?? '';
      lastName = row[mapping.lastName] ?? '';
    } else if (mapping.fullName) {
      ({ firstName, lastName } = splitFullName(row[mapping.fullName] ?? ''));
    }
    firstName = firstName.trim(); lastName = lastName.trim();
    if (!firstName) { result.errors.push({ row: rowNo, message: 'Falta el nombre.' }); return; }
    const birthDate = normalizeBirthDate(row[mapping.birthDate] ?? '');
    if (!birthDate) { result.errors.push({ row: rowNo, message: `Fecha de nacimiento inválida: "${row[mapping.birthDate] ?? ''}".` }); return; }
    const club = mapping.club ? (row[mapping.club] ?? '').trim() || undefined : undefined;
    const documentNumber = mapping.documentNumber ? (row[mapping.documentNumber] ?? '').trim() || undefined : undefined;
    const externalId = mapping.externalId ? (row[mapping.externalId] ?? '').trim() || undefined : undefined;
    const col = (k?: string) => (k ? (row[k] ?? '').trim() || undefined : undefined);
    const delegation = col(mapping.delegation);
    const emName = col(mapping.emergencyName), emPhone = col(mapping.emergencyPhone);
    const emergencyContact = emName && emPhone ? { name: emName, phone: emPhone } : undefined;
    const epsName = col(mapping.epsName);
    const eps = epsName ? { name: epsName, regime: col(mapping.epsRegime) } : undefined;

    const key = dedupeKey({ firstName, lastName, birthDate, club });
    if (seenInFile.has(key)) { result.duplicatesInFile++; return; }
    seenInFile.add(key);

    const existing = byKey.get(key);
    if (existing) {
      const changed = (documentNumber !== undefined && documentNumber !== existing.documentNumber) || (externalId !== undefined && externalId !== existing.externalId)
        || (delegation !== undefined && delegation !== existing.delegation)
        || (emergencyContact !== undefined && JSON.stringify(emergencyContact) !== JSON.stringify(existing.emergencyContact))
        || (eps !== undefined && JSON.stringify(eps) !== JSON.stringify(existing.eps));
      if (changed) {
        const upd: Person = {
          ...existing, documentNumber: documentNumber ?? existing.documentNumber, externalId: externalId ?? existing.externalId,
          delegation: delegation ?? existing.delegation, emergencyContact: emergencyContact ?? existing.emergencyContact, eps: eps ?? existing.eps
        };
        byKey.set(key, upd);
        result.updated.push(upd);
      } else {
        result.unchanged.push(existing);
      }
      return;
    }
    const person: Person = { id: idFactory(newIndex++), firstName, lastName, birthDate, club, documentNumber, externalId, source: 'sportdata', delegation, emergencyContact, eps };
    byKey.set(key, person);
    result.created.push(person);
  });

  result.persons = [...byKey.values()];
  return result;
}
