#!/usr/bin/env bash
# Comprobación previa a la suite e2e y al simulacro: Node/npm, dependencias, puertos libres,
# Chromium de Playwright, builds necesarios y espacio en disco. No cambia nada; sale con 1 si
# algo bloquea. Uso: npm run preflight   (o bash scripts/preflight.sh [--fix] para instalar Chromium)
set -u
cd "$(dirname "$0")/.."

ok=0; warn=0; bad=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok + 1)); }
note() { printf '  \033[33m!\033[0m %s\n' "$1"; warn=$((warn + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; bad=$((bad + 1)); }
FIX=0; [ "${1:-}" = "--fix" ] && FIX=1

echo "Tatami Pass · preflight"

# ---- Node y npm ----
if command -v node >/dev/null; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$NODE_MAJOR" -ge 20 ]; then pass "Node $(node -v) (≥ 20)"; else fail "Node $(node -v): se necesita ≥ 20"; fi
else fail "Node no está instalado"; fi
if command -v npm >/dev/null; then pass "npm $(npm -v)"; else fail "npm no está instalado"; fi

# ---- dependencias y core compilado ----
if [ -d node_modules/@playwright/test ]; then pass "dependencias instaladas (node_modules)"; else fail "faltan dependencias: npm install"; fi
if [ -f packages/core/dist/index.js ]; then pass "packages/core compilado"; else fail "packages/core sin compilar: npm run build -w packages/core"; fi
if [ -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then pass "better-sqlite3 (binario nativo) presente"; else note "better-sqlite3 sin binario: npm rebuild better-sqlite3"; fi

# ---- Chromium de Playwright ----
if node -e "require('playwright-core')" 2>/dev/null; then
  if node -e "const {chromium}=require('playwright-core'); const fs=require('fs'); process.exit(fs.existsSync(chromium.executablePath())?0:1)" 2>/dev/null; then
    pass "Chromium de Playwright: $(node -p "require('playwright-core').chromium.executablePath()")"
  else
    if [ "$FIX" = 1 ]; then
      echo "  … instalando Chromium (npx playwright install chromium)"; npx playwright install chromium && pass "Chromium instalado" || fail "no se pudo instalar Chromium"
    else
      fail "Chromium de Playwright no está instalado: npx playwright install chromium (o PLAYWRIGHT_BROWSERS_PATH=/ruta; --fix lo instala)"
    fi
  fi
else fail "playwright-core no está en node_modules: npm install"; fi

# ---- puertos de la suite (deben estar libres) ----
PORTS="${E2E_HOST_PORT:-8790} ${E2E_PROXY_PORT:-8797} ${E2E_CONTROL_PORT:-8798} ${E2E_SCANNER_PORT:-5174} ${E2E_REGISTRATION_PORT:-3100}"
for p in $PORTS; do
  if node -e "const n=require('net');const s=n.createServer();s.once('error',()=>process.exit(1));s.listen($p,'127.0.0.1',()=>s.close(()=>process.exit(0)))" 2>/dev/null; then
    pass "puerto $p libre"
  else
    fail "puerto $p ocupado (¿otro host/scanner/nube corriendo? mata el proceso o usa E2E_*_PORT)"
  fi
done

# ---- builds que usa la suite (se hacen solos con npm run e2e; aquí solo se informa) ----
[ -f apps/host/public/admin/index.html ] && pass "panel del host compilado (apps/host/public/admin)" || note "panel del host sin compilar (npm run e2e lo compila; a mano: npm run build -w apps/host-admin)"
[ -f apps/scanner/dist-e2e/index.html ] && pass "scanner en modo prueba compilado (dist-e2e)" || note "scanner e2e sin compilar (npm run build:e2e -w apps/scanner)"
[ -f apps/registration/.next/BUILD_ID ] && pass "nube compilada (.next)" || note "nube sin compilar (npm run build -w apps/registration; ~45 s)"
[ -f apps/print/dist/pdf.js ] && pass "apps/print compilado (PDF de credenciales)" || fail "apps/print sin compilar: npm run build -w apps/print (el host lo necesita para imprimir)"

# ---- disco y temporales ----
FREE_MB=$(df -Pm . | awk 'NR==2 {print $4}')
if [ "${FREE_MB:-0}" -ge 1024 ]; then pass "espacio libre: ${FREE_MB} MB"; else fail "menos de 1 GB libre (${FREE_MB} MB): la suite escribe bases, vídeos y trazas en e2e/.tmp y e2e/test-results"; fi
if [ -w . ]; then pass "carpeta del repo escribible"; else fail "la carpeta del repo no es escribible"; fi

# ---- simulacro: lo que hace falta además de la suite ----
if [ -n "${TP_KEY_PASSPHRASE:-}" ]; then pass "TP_KEY_PASSPHRASE definida (host en producción)"; else note "TP_KEY_PASSPHRASE no definida: vale para pruebas; en el evento es obligatoria (apps/host/.env.example)"; fi
if [ -n "${E2E_BASE_HOST:-}${E2E_BASE_SCANNER:-}${E2E_BASE_REGISTRATION:-}" ]; then
  note "la suite apuntará a un ecosistema externo (E2E_BASE_*): no levanta servidores y salta las specs con proxy/hosts extra"
  for u in "${E2E_BASE_HOST:-}" "${E2E_BASE_REGISTRATION:-}"; do
    [ -z "$u" ] && continue
    if curl -fsS -m 5 "$u/health" >/dev/null 2>&1 || curl -fsS -m 5 "$u/api/status" >/dev/null 2>&1; then pass "responde: $u"; else fail "no responde: $u"; fi
  done
fi
command -v docker >/dev/null && pass "docker disponible (host con Caddy/HTTPS, opcional)" || note "docker no disponible (solo hace falta para el host con HTTPS en LAN)"

echo
echo "  $ok ok · $warn avisos · $bad bloqueantes"
[ "$bad" -eq 0 ] && { echo "  Listo: npm run e2e:smoke (≈ 2 min) · npm run e2e (≈ 4 min) · npm run e2e:perf"; exit 0; }
echo "  Corrige los puntos marcados con ✗ antes de correr la suite."; exit 1
