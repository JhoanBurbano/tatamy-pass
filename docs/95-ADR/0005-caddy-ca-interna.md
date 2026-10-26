# ADR-0005 · HTTPS en LAN con Caddy y CA interna

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-09 |
| **Decide** | Claude por encargo de Jhoan Burbano (contrato 00-DECISIONES v1.0) |
| **Afecta a** | `apps/host` (`docker-compose.yml`, `Caddyfile`), docs 30 §8, 50 §3–4, 60 §6, 90 §5 |

## Contexto

La PWA del scanner necesita contexto seguro (HTTPS) para abrir la cámara y registrar el service worker. La LAN de staff no tiene internet garantizado ni DNS público, y el host puede cambiar de IP si se promueve el respaldo.

## Decisión

El host corre detrás de **Caddy con `tls internal`** (CA propia generada por Caddy). El certificado raíz se exporta una vez (`root.crt`) y se instala en cada teléfono con una guía por sistema (Android: certificado de CA; iOS: perfil + confianza total). El respaldo comparte la misma CA (se copia el volumen `caddy-data`) para que los scanners confíen en ambos hosts.

Alternativa aceptada y documentada: dominio real (`host.tatamipass.co`) apuntando a la IP LAN con certificado Let's Encrypt emitido antes del evento por DNS-01.

## Alternativas consideradas

| Alternativa | Por qué no es la principal |
|---|---|
| Let's Encrypt DNS-01 | Depende de internet y DNS antes del evento y de la fecha de renovación; no funciona si el dominio o la IP cambian a última hora. Queda como alternativa. |
| Certificado autofirmado sin CA | Los navegadores móviles no permiten excepciones persistentes para la cámara. |
| HTTP plano | Sin cámara ni service worker. |

## Consecuencias

**Positivas**: funciona sin internet, sin DNS y sin fechas de vencimiento que vigilar; mismo Caddy sirve API, panel y PWA.

**Negativas / costos**: instalar el certificado en cada teléfono (una vez; 2 min con la guía). En iOS hay que activar la "confianza total" o la cámara no abre. Si se regenera la CA, hay que reinstalarla en todos los dispositivos: por eso se respalda el volumen.

**Qué vigilar**: cambios de Android/iOS en la instalación de CAs de usuario; si dejan de aceptarlas, pasar a la alternativa DNS-01.

## Referencias

- `docs/00-DECISIONES.md` §8 · `docs/30-ARQUITECTURA.md` §8 · `docs/80-COMO-PROBAR.md` §11 · `docs/90-MONTAJE-ECOSISTEMA.md` §5
- Código: `apps/host/Caddyfile`, `apps/host/docker-compose.yml`
