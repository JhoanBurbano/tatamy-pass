/**
 * Plantilla de credencial del host (ADR-0009): vive en `data/badge-template.json`
 * (junto a la base, o donde apunte `TP_BADGE_TEMPLATE`). Si no existe se crea con
 * la plantilla por defecto del piloto. Se valida al cargar y al guardar; una
 * plantilla corrupta en disco no tumba el host: se avisa y se usa la por defecto.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultBadgeTemplate, validateBadgeTemplate, type BadgeTemplate, type TemplateError } from '@tatami/core';

export class BadgeTemplateStore {
  private current: BadgeTemplate;

  /** `path = null` → solo en memoria (tests). */
  constructor(readonly path: string | null, private log: (msg: string) => void = (m) => console.warn(`[plantilla] ${m}`)) {
    this.current = this.load();
  }

  private load(): BadgeTemplate {
    if (!this.path) return defaultBadgeTemplate();
    if (!existsSync(this.path)) {
      const t = defaultBadgeTemplate();
      this.write(t);
      return t;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      const errors = validateBadgeTemplate(parsed);
      if (errors.length) { this.log(`${this.path} tiene errores (${errors[0].path}: ${errors[0].message}); uso la plantilla por defecto hasta que la corrijas desde el panel.`); return defaultBadgeTemplate(); }
      return parsed as BadgeTemplate;
    } catch (e) {
      this.log(`No pude leer ${this.path} (${(e as Error).message}); uso la plantilla por defecto.`);
      return defaultBadgeTemplate();
    }
  }

  private write(t: BadgeTemplate): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(t, null, 2) + '\n');
  }

  get(): BadgeTemplate { return this.current; }

  /** Valida y guarda. Devuelve los errores (vacío = guardada). */
  save(next: unknown): TemplateError[] {
    const errors = validateBadgeTemplate(next);
    if (errors.length) return errors;
    this.current = next as BadgeTemplate;
    this.write(this.current);
    return [];
  }

  reset(): BadgeTemplate {
    this.current = defaultBadgeTemplate();
    this.write(this.current);
    return this.current;
  }

  /** Tamaño aproximado en bytes de la plantilla serializada (para avisar si crece demasiado). */
  bytes(): number { return Buffer.byteLength(JSON.stringify(this.current)); }
}
