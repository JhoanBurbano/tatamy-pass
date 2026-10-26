/**
 * HTTPS en la LAN con Caddy como proceso auxiliar (`tls internal`, ADR-0005).
 * La app escribe un Caddyfile con las IPs actuales, lanza `caddy run` con su
 * carpeta de datos dentro de `<datos>/caddy/home` y expone el certificado raíz
 * para instalarlo en los celulares. Si el binario no está, el host sigue en HTTP.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CaddyfileOptions {
  httpsPort: number;
  /** Puerto HTTP del host (Fastify) al que Caddy reenvía. */
  port: number;
  /** IPs y nombres que irán como SAN del certificado. */
  hosts: string[];
}

export function renderCaddyfile(o: CaddyfileOptions): string {
  const names = Array.from(new Set(['localhost', 'tatami-host.local', ...o.hosts.map((h) => h.trim()).filter(Boolean)]));
  const sites = names.map((h) => `https://${h}:${o.httpsPort}`).join(', ');
  return [
    '# Generado por Tatami Pass Host. No lo edites: se reescribe al arrancar.',
    '{',
    '\tadmin off',
    '\tauto_https disable_redirects',
    '\tskip_install_trust',
    '}',
    '',
    `${sites} {`,
    '\ttls internal',
    '\tencode gzip',
    `\treverse_proxy 127.0.0.1:${o.port}`,
    '}',
    ''
  ].join('\n');
}

export interface CaddyStatus { running: boolean; error: string | null; binaryFound: boolean; rootCertAvailable: boolean; port: number }

export class CaddyRunner {
  private child: ChildProcess | null = null;
  private error: string | null = null;

  constructor(
    private readonly binary: string,
    private readonly caddyfile: string,
    private readonly home: string,
    private readonly rootCert: string,
    private readonly log: (level: 'info' | 'warn' | 'error', m: string) => void
  ) {}

  get binaryFound(): boolean { return existsSync(this.binary); }

  private get pidFile(): string { return join(dirname(this.caddyfile), 'caddy.pid'); }

  /** Si quedó un Caddy huérfano de una sesión anterior (la app se cerró a la fuerza), lo termina: en Linux dos Caddy pueden compartir el puerto (SO_REUSEPORT) y servir certificados distintos. */
  killOrphan(): void {
    try {
      if (!existsSync(this.pidFile)) return;
      const pid = Number(readFileSync(this.pidFile, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 1) { process.kill(pid); this.log('warn', `Cerré un Caddy de una sesión anterior (pid ${pid}).`); }
    } catch { /* ya no existe */ } finally { try { rmSync(this.pidFile, { force: true }); } catch { /* */ } }
  }

  status(port: number): CaddyStatus {
    return { running: this.child !== null && this.child.exitCode === null, error: this.error, binaryFound: this.binaryFound, rootCertAvailable: existsSync(this.rootCert), port };
  }

  rootCertPath(): string | null { return existsSync(this.rootCert) ? this.rootCert : null; }

  start(o: CaddyfileOptions): boolean {
    this.stop();
    this.killOrphan();
    this.error = null;
    if (!this.binaryFound) {
      this.error = 'No encuentro Caddy en esta instalación; el host sigue en HTTP. Ver docs/86 §5.';
      this.log('warn', this.error);
      return false;
    }
    mkdirSync(dirname(this.caddyfile), { recursive: true });
    mkdirSync(this.home, { recursive: true });
    writeFileSync(this.caddyfile, renderCaddyfile(o));
    const env = { ...process.env, XDG_DATA_HOME: this.home, XDG_CONFIG_HOME: this.home, HOME: process.env.HOME ?? this.home };
    try {
      this.child = spawn(this.binary, ['run', '--config', this.caddyfile, '--adapter', 'caddyfile', '--pidfile', this.pidFile], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      this.error = `No pude iniciar Caddy: ${(e as Error).message}`;
      this.log('error', this.error);
      this.child = null;
      return false;
    }
    const child = this.child;
    child.stdout?.on('data', (d: Buffer) => this.log('info', `[caddy] ${String(d).trim()}`));
    child.stderr?.on('data', (d: Buffer) => {
      const t = String(d).trim();
      if (/"level":"error"/.test(t) || /error/i.test(t)) this.log('warn', `[caddy] ${t.slice(0, 300)}`);
    });
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = null;
        if (code !== 0 && code !== null) { this.error = `Caddy se cerró (código ${code}). El host sigue en HTTP; revisa que el puerto ${o.httpsPort} esté libre.`; this.log('warn', this.error); }
      }
    });
    child.on('error', (e) => { this.error = `Caddy falló: ${e.message}`; this.log('error', this.error); this.child = null; });
    this.log('info', `HTTPS en el puerto ${o.httpsPort} (Caddy, certificado interno).`);
    return true;
  }

  stop(): void {
    const c = this.child;
    this.child = null;
    if (!c) return;
    try { c.kill(); } catch { /* ya salió */ }
    try { rmSync(this.pidFile, { force: true }); } catch { /* */ }
  }
}
