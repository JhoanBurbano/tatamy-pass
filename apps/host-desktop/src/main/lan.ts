/**
 * Direcciones IPv4 de la LAN de este equipo, ordenadas por utilidad (primero
 * las privadas 10/8, 192.168/16, 172.16/12; nunca loopback ni link-local).
 */
import { networkInterfaces } from 'node:os';

export type Ifaces = Record<string, Array<{ family: string | number; address: string; internal: boolean }> | undefined>;

export function lanAddresses(ifaces: Ifaces = networkInterfaces() as Ifaces): string[] {
  const all: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4;
      if (!v4 || i.internal || i.address.startsWith('169.254.')) continue;
      if (!all.includes(i.address)) all.push(i.address);
    }
  }
  const rank = (ip: string): number => (ip.startsWith('10.') ? 0 : ip.startsWith('192.168.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** URLs del host para mostrar y para el QR: la primera es la recomendada. */
export function hostUrls(ips: string[], opts: { httpsRunning: boolean; httpsPort: number; port: number }): string[] {
  const list = ips.length ? ips : ['localhost'];
  return list.map((ip) => (opts.httpsRunning ? `https://${ip}:${opts.httpsPort}` : `http://${ip}:${opts.port}`));
}
