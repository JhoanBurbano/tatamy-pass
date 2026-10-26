#!/usr/bin/env bash
# Verificación completa antes de dar por terminado un cambio (lo que corre la
# plantilla de PR y lo que un agente debe correr antes de decir "listo"):
#   1. npm test        (core con cobertura, host, scanner, registration)
#   2. npm run build   (todos los workspaces)
#   3. npm run typecheck
#   4. npm run docs:gen y diff limpio en docs/31 y docs/32
#   5. enlaces entre documentos sin romper
# Opciones: --skip-build  --skip-test  --e2e (añade npm run e2e:smoke)
# Sale con 1 al primer paso que falle y resume al final.
set -u
cd "$(dirname "$0")/../.." || exit 1
SKIP_BUILD=0; SKIP_TEST=0; E2E=0
for a in "$@"; do case "$a" in --skip-build) SKIP_BUILD=1;; --skip-test) SKIP_TEST=1;; --e2e) E2E=1;; esac; done
RESULTS=()
step() { # nombre, comando...
  local name="$1"; shift
  echo ""; echo "=== $name"
  if "$@"; then RESULTS+=("✔ $name"); else RESULTS+=("✘ $name"); echo "--- $name FALLÓ"; summary; exit 1; fi
}
summary() { echo ""; echo "Resumen:"; for r in "${RESULTS[@]}"; do echo "  $r"; done; }

[ $SKIP_TEST -eq 1 ] || step "npm test" npm test
[ $SKIP_BUILD -eq 1 ] || step "npm run build" npm run build
step "npm run typecheck" npm run typecheck
step "docs:gen" npm run docs:gen --silent
check_docs_diff() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if ! git diff --quiet -- docs/31-API-REFERENCIA.md docs/32-CONFIG-EVENTO.md; then
      echo "docs/31 o docs/32 cambiaron al regenerar: revisa y añade el diff al PR."
      git --no-pager diff --stat -- docs/31-API-REFERENCIA.md docs/32-CONFIG-EVENTO.md
      return 1
    fi
  fi
  return 0
}
step "docs generados sin diff" check_docs_diff
step "enlaces entre docs" npx tsx scripts/agent/verify-docs-links.ts
[ $E2E -eq 0 ] || step "e2e smoke" npm run e2e:smoke
summary
echo ""; echo "Todo en verde."
