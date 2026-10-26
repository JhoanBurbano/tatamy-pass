#!/usr/bin/env bash
# Hook PostToolUse (Edit|Write): si el archivo editado está en apps/* o packages/*,
# corre el typecheck de ese workspace. No bloquea (exit 0 siempre); escribe el
# resultado para que el agente lo vea y corrija antes de seguir.
# Entrada: JSON de Claude Code por stdin con tool_input.file_path.
set -u
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.file_path||"")}catch{process.stdout.write("")}})')
[ -z "$FILE" ] && exit 0
case "$FILE" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REL=${FILE#"$ROOT"/}
WS=""
case "$REL" in
  apps/host/*)         WS="apps/host" ;;
  apps/host-admin/*)   WS="apps/host-admin" ;;
  apps/scanner/*)      WS="apps/scanner" ;;
  apps/registration/*) WS="apps/registration" ;;
  apps/print/*)        WS="apps/print" ;;
  packages/core/*)     WS="packages/core" ;;
  *) exit 0 ;;
esac
cd "$ROOT" || exit 0
# core se compila primero para que las apps vean los tipos nuevos.
if [ "$WS" != "packages/core" ] && [ ! -d packages/core/dist ]; then npm run build -w packages/core >/dev/null 2>&1; fi
OUT=$(npm run typecheck -w "$WS" 2>&1)
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo "[hook typecheck] $WS tiene errores de tipos tras editar $REL:"
  echo "$OUT" | grep -E "error TS|\.tsx?\(" | head -20
  echo "[hook typecheck] Corrígelos antes de seguir (npm run typecheck -w $WS)."
else
  echo "[hook typecheck] $WS ok."
fi
exit 0
