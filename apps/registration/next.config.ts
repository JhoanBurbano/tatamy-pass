import type { NextConfig } from 'next';

/** Cabeceras de seguridad (ver docs/85-DESPLIEGUE-NUBE.md, checklist). */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' }
];

const nextConfig: NextConfig = {
  // Módulos nativos o con carga dinámica que no deben empaquetarse en el servidor.
  serverExternalPackages: ['better-sqlite3', 'pg', '@node-rs/argon2'],
  // El core se consume ya compilado (packages/core/dist), no hace falta transpilar.
  typescript: { ignoreBuildErrors: false },
  // Las acciones del panel reciben fotos recortadas (≈ 100 KB; tope de la API 2 MB).
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }] },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  }
};

export default nextConfig;
