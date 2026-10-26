/**
 * Logs en vivo: anillo de las últimas N líneas + archivo `logs/host.log` +
 * suscriptores (la ventana). Captura `console.*` del proceso principal porque
 * los módulos del host (copias, nube, respaldo) escriben por consola.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class LogBuffer {
  private lines: string[] = [];
  private listeners = new Set<(line: string) => void>();
  private file: string | null = null;

  constructor(readonly max = 200) {}

  attachFile(file: string): void {
    try { mkdirSync(dirname(file), { recursive: true }); this.file = file; } catch { this.file = null; }
  }

  push(level: 'info' | 'warn' | 'error', ...parts: unknown[]): string {
    const text = parts.map((p) => (typeof p === 'string' ? p : p instanceof Error ? p.message : safeJson(p))).join(' ').replace(/\s+$/, '');
    const line = `${new Date().toISOString().slice(11, 19)} ${level === 'info' ? '·' : level === 'warn' ? '!' : '×'} ${text}`;
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    if (this.file) { try { appendFileSync(this.file, `${new Date().toISOString()} ${level} ${text}\n`); } catch { /* disco lleno o sin permisos: no bloquea */ } }
    for (const l of this.listeners) l(line);
    return line;
  }

  all(): string[] { return [...this.lines]; }

  subscribe(cb: (line: string) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** Reenvía console.log/warn/error al buffer (y a la consola original). */
  captureConsole(): void {
    const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    console.log = (...a: unknown[]) => { orig.log(...a); this.push('info', ...a); };
    console.info = (...a: unknown[]) => { orig.info(...a); this.push('info', ...a); };
    console.warn = (...a: unknown[]) => { orig.warn(...a); this.push('warn', ...a); };
    console.error = (...a: unknown[]) => { orig.error(...a); this.push('error', ...a); };
  }
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}
