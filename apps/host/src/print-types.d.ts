/**
 * Tipos mínimos de `@tatami/print` (apps/print no emite .d.ts). El host usa su
 * build (`dist/pdf.js`); `npm run build` del repo compila print antes de usarlo.
 */
declare module '@tatami/print/dist/pdf.js' {
  import type { BadgePersonData, BadgeTemplate, Credential, EventConfig } from '@tatami/core';
  export interface PrintableCredential extends Credential { token: string; person?: BadgePersonData }
  export type BadgeLayout = 'two-pages' | 'duplex';
  export function buildCredentialsPdf(creds: PrintableCredential[], config: EventConfig, opts?: { template?: BadgeTemplate; layout?: BadgeLayout }): Promise<Uint8Array>;
  export const CARD_W: number;
  export const CARD_H: number;
}
